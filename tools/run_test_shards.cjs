#!/usr/bin/env node
// Run the Playwright suites as parallel shards. Each shard is its own
// Playwright process with its own serve.py port and temporary progress file,
// so the suites keep running one test at a time against a server nobody else
// touches. Usage:
//   node tools/run_test_shards.cjs [--shards 4] [--port-base 18100] [spec files…]
// Without spec files it runs the test:core, test:smoke and test:srs-visual lists.
//
// Whole spec files go to shards by their last measured duration (longest
// first onto the least loaded shard). Durations are kept in
// test-results/shards/timings.json; a file without one counts 3 s per test.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
let shards = 4;
let portBase = 18100;
let files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--shards') shards = Number(args[++i]);
  else if (args[i] === '--port-base') portBase = Number(args[++i]);
  else files.push(args[i]);
}
if (!Number.isInteger(shards) || shards < 1) throw new Error('--shards needs a positive integer');
if (!Number.isInteger(portBase) || portBase < 1024) throw new Error('--port-base needs a port number');

const normalize = (file) => path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
if (!files.length) {
  const scripts = require(path.join(root, 'package.json')).scripts;
  for (const group of ['test:core', 'test:smoke', 'test:srs-visual']) {
    files.push(
      ...scripts[group]
        .replace(/^playwright test /, '')
        .split(/\s+/)
        .filter(Boolean),
    );
  }
}
files = [...new Set(files.map(normalize))];

const cli = path.join(path.dirname(require.resolve('@playwright/test/package.json')), 'cli.js');
const outputRoot = path.join(root, 'test-results', 'shards');
const timingsPath = path.join(outputRoot, 'timings.json');
fs.mkdirSync(outputRoot, { recursive: true });

let timings = {};
try {
  timings = JSON.parse(fs.readFileSync(timingsPath, 'utf8'));
} catch {
  timings = {};
}

function testCounts() {
  const listed = spawnSync(process.execPath, [cli, 'test', ...files, '--list'], {
    cwd: root,
    encoding: 'utf8',
  });
  const counts = {};
  for (const match of (listed.stdout || '').matchAll(/^\s+(?:\[[^\]]+\] › )?([^\s:]+\.spec\.js):\d+:\d+/gm)) {
    const file = normalize(path.join('tests', match[1]));
    counts[file] = (counts[file] || 0) + 1;
  }
  return counts;
}

const counts = files.some((file) => !(file in timings)) ? testCounts() : {};
const weight = (file) => timings[file] || (counts[file] || 1) * 3;
const plan = Array.from({ length: shards }, () => ({ files: [], seconds: 0 }));
for (const file of [...files].sort((a, b) => weight(b) - weight(a))) {
  const target = plan.reduce((least, shard) => (shard.seconds < least.seconds ? shard : least));
  target.files.push(file);
  target.seconds += weight(file);
}

const started = Date.now();
const minutes = (ms) => (ms / 60000).toFixed(1) + 'm';

// Sum the measured test durations per spec file from a JSON report.
function fileDurations(report) {
  const result = {};
  const visit = (suite, file) => {
    const owner = suite.file ? normalize(path.join('tests', suite.file)) : file;
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        for (const run of test.results || []) result[owner] = (result[owner] || 0) + run.duration / 1000;
      }
    }
    for (const child of suite.suites || []) visit(child, owner);
  };
  for (const suite of report.suites || []) visit(suite, '');
  return result;
}

function runShard(index, shard) {
  const port = portBase + index;
  const log = path.join(outputRoot, `shard-${index}.log`);
  const json = path.join(outputRoot, `shard-${index}.json`);
  const out = fs.createWriteStream(log);
  const child = spawn(
    process.execPath,
    [
      cli,
      'test',
      ...shard.files,
      '--reporter=line,json',
      '--output',
      path.join(outputRoot, `shard-${index}`),
    ],
    {
      cwd: root,
      env: { ...process.env, PLAYWRIGHT_PORT: String(port), PLAYWRIGHT_JSON_OUTPUT_NAME: json },
    },
  );
  child.stdout.pipe(out);
  child.stderr.pipe(out);
  return new Promise((resolve) => {
    child.on('close', (code) => {
      out.end();
      const text = fs.readFileSync(log, 'utf8');
      const summary = text.match(/^\s+\d+ (passed|failed|flaky|skipped|did not run|interrupted).*$/gm) || [];
      try {
        Object.assign(timings, fileDurations(JSON.parse(fs.readFileSync(json, 'utf8'))));
      } catch {
        // A shard that crashed before reporting keeps the old estimates.
      }
      console.log(
        `shard ${index}/${shards} (port ${port}, ${shard.files.length} files, planned ${minutes(shard.seconds * 1000)}) ` +
          `exit ${code} after ${minutes(Date.now() - started)}: ` +
          (summary.map((line) => line.trim()).join('; ') || 'no summary, see ' + path.relative(root, log)),
      );
      resolve(code);
    });
  });
}

console.log(`${files.length} spec files in ${shards} shards, ports ${portBase + 1}-${portBase + shards}`);
Promise.all(plan.map((shard, i) => (shard.files.length ? runShard(i + 1, shard) : 0))).then((codes) => {
  fs.writeFileSync(timingsPath, JSON.stringify(timings, null, 2) + '\n');
  const failed = codes.filter((code) => code !== 0).length;
  console.log(
    `${failed ? failed + ' shard(s) failed' : 'all shards passed'} in ${minutes(Date.now() - started)}`,
  );
  process.exit(failed ? 1 : 0);
});
