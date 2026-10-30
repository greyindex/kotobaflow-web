'use strict';

/**
 * Keep the runtime icon registry mechanically derived from one SVG source per icon.
 *
 * Commands:
 *   node tools/generate_icons.js extract  # one-time migration from current js/icons.js
 *   node tools/generate_icons.js build    # rebuild js/icons.js from SVG sources
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const ICON_ROOT = path.join(ROOT, 'resources', 'brand', 'icons');
const ICON_MANIFEST = path.join(ICON_ROOT, 'manifest.json');
const RUNTIME_FILE = path.join(ROOT, 'js', 'icons.js');
const PRETTIER_BIN = path.join(ROOT, 'node_modules', 'prettier', 'bin', 'prettier.cjs');

const CATEGORY_BY_ICON = {
  book: '模块导航 / 教材',
  grammar: '模块导航 / 语法',
  library: '模块导航 / 词汇',
  target: '模块导航 / 今日学习',
  calendar: '进度 / 日历',
  'arrow-left': '导航 / 返回',
  'chevron-left': '导航 / 上一项或收起',
  'chevron-right': '导航 / 下一项或展开',
  'chevron-down': '导航 / 展开菜单',
  'chevron-up': '导航 / 收起菜单',
  play: '音频 / 播放',
  pause: '音频 / 暂停',
  stop: '音频 / 停止',
  volume: '音频 / 音量',
  shuffle: '学习 / 随机',
  repeat: '学习 / 重复',
  brain: '学习 / 记忆',
  check: '状态 / 完成',
  x: '状态 / 关闭',
  'x-circle': '状态 / 错误或清除',
  info: '状态 / 信息',
  sparkles: '状态 / 新内容',
  star: '词汇或语法 / 收藏',
  search: '工具 / 搜索',
  filter: '工具 / 筛选',
  settings: '工具 / 设置',
  wand: '工具 / 应用或生成',
  rotate: '工具 / 重置',
  'rotate-ccw': '工具 / 撤销或重置',
  maximize: '工具 / 全屏',
  minimize: '工具 / 收起全屏',
  eye: '工具 / 显示',
  'eye-off': '工具 / 隐藏',
  list: '视图 / 列表',
  network: '视图 / 图谱',
  layers: '视图 / 层级',
  folder: '内容 / 文件夹',
  tag: '内容 / 标签',
  text: '内容 / 文本',
  clipboard: '内容 / 记录',
  scale: '内容 / 对比',
  pencil: '内容 / 编辑',
  link: '内容 / 链接',
  ruler: '内容 / 尺度',
  diamond: '通用 fallback',
  skip: '学习 / 跳过',
  trash: '内容 / 删除',
};

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function readCurrentIconMap() {
  const source = fs.readFileSync(RUNTIME_FILE, 'utf8');
  const match = source.match(/var icons = (\{[\s\S]*?\n\s{2}\};)/);
  if (!match) throw new Error(`Could not locate icon registry in ${RUNTIME_FILE}`);
  const objectSource = match[1].replace(/;\s*$/, '');
  return vm.runInNewContext(`(${objectSource})`, Object.create(null));
}

function iconSvg(body) {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">',
    `  ${body}`,
    '</svg>',
    '',
  ].join('\n');
}

function readIconNames() {
  if (!fs.existsSync(ICON_MANIFEST)) throw new Error(`Missing ${ICON_MANIFEST}; run extract first.`);
  const manifest = JSON.parse(fs.readFileSync(ICON_MANIFEST, 'utf8'));
  if (!Array.isArray(manifest.icons) || !manifest.icons.length)
    throw new Error('Icon manifest has no icons.');
  return manifest.icons.map((icon) => icon.name);
}

function extract() {
  const icons = readCurrentIconMap();
  const names = Object.keys(icons).sort((a, b) => a.localeCompare(b));
  ensureDirectory(ICON_ROOT);
  for (const name of names)
    fs.writeFileSync(path.join(ICON_ROOT, `${name}.svg`), iconSvg(icons[name]), 'utf8');
  const manifest = {
    schemaVersion: 1,
    source: 'project-authored; extracted from the pre-source js/icons.js registry',
    license: 'project-authored',
    viewBox: '0 0 24 24',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    linecap: 'round',
    linejoin: 'round',
    icons: names.map((name) => ({
      name,
      semantic: name,
      usage: CATEGORY_BY_ICON[name] || '界面操作 / 待补充具体入口',
      source: `${name}.svg`,
    })),
  };
  fs.writeFileSync(ICON_MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Extracted ${names.length} SVG icon sources to resources/brand/icons.`);
}

function extractBody(svg, fileName) {
  const match = svg.match(/<svg\b[^>]*>([\s\S]*?)<\/svg>/i);
  if (!match) throw new Error(`Invalid SVG source: ${fileName}`);
  return match[1].trim().replace(/\s+/g, ' ');
}

function build() {
  const names = readIconNames();
  const icons = {};
  for (const name of names) {
    const fileName = `${name}.svg`;
    const filePath = path.join(ICON_ROOT, fileName);
    if (!fs.existsSync(filePath)) throw new Error(`Missing icon source: ${filePath}`);
    icons[name] = extractBody(fs.readFileSync(filePath, 'utf8'), fileName);
  }
  const iconObject = JSON.stringify(icons, null, 2)
    .split('\n')
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join('\n');
  const source = `(function () {
  'use strict';

  var icons = ${iconObject};

  function render(el) {
    var name = el.getAttribute('name');
    var body = icons[name] || icons['diamond'];
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" focusable="false">' +
      body +
      '</svg>';
  }

  function UiIcon() {
    return Reflect.construct(HTMLElement, [], UiIcon);
  }
  UiIcon.prototype = Object.create(HTMLElement.prototype);
  UiIcon.prototype.constructor = UiIcon;
  UiIcon.prototype.connectedCallback = function () {
    render(this);
  };
  UiIcon.prototype.attributeChangedCallback = function () {
    if (this.isConnected) render(this);
  };
  UiIcon.observedAttributes = ['name'];
  Object.setPrototypeOf(UiIcon, HTMLElement);

  if (!customElements.get('ui-icon')) customElements.define('ui-icon', UiIcon);
  window.uiIcon = function (name) {
    return '<ui-icon name="' + name + '"></ui-icon>';
  };
})();
`;
  fs.writeFileSync(RUNTIME_FILE, source, 'utf8');
  if (fs.existsSync(PRETTIER_BIN)) {
    execFileSync(process.execPath, [PRETTIER_BIN, '--write', RUNTIME_FILE], {
      cwd: ROOT,
      stdio: 'ignore',
    });
  }
  console.log(`Built ${RUNTIME_FILE} from ${names.length} SVG icon sources.`);
}

const command = process.argv[2] || 'build';
if (command === 'extract') extract();
else if (command === 'build') build();
else {
  console.error(`Unknown command: ${command}`);
  process.exitCode = 1;
}
