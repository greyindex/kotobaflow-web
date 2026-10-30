const { defineConfig } = require('@playwright/test');

// One server per run. Parallel shards (tools/run_test_shards.cjs) each pass
// their own port so their temporary progress files never meet.
const PORT = Number(process.env.PLAYWRIGHT_PORT) || 18080;
const ORIGIN = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: ORIGIN,
    viewport: { width: 1600, height: 900 },
    locale: 'zh-CN',
    colorScheme: 'light',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Page-turn reading is the default layout since 2026-10-06. Suites written
    // for the legacy scrolling layout keep covering it by pinning that choice;
    // the page-turn specs reset storage to the default (see tests/book-view.spec.js).
    storageState: {
      cookies: [],
      origins: [
        {
          origin: ORIGIN,
          localStorage: [{ name: 'jp_learning_reading_layout_v1', value: 'scroll' }],
        },
      ],
    },
  },
  webServer: {
    command: `python serve.py --no-browser --port ${PORT} --temporary-progress`,
    url: ORIGIN,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
