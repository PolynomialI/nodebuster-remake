import { defineConfig } from '@playwright/test';

// Runs against the packaged build (dist/), served with the same document
// skeleton the artifact host wraps around the page.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    channel: 'chrome',
    viewport: { width: 1440, height: 810 },
    deviceScaleFactor: 1,
    launchOptions: { args: ['--autoplay-policy=user-gesture-required'] },
  },
  webServer: {
    command: 'node scripts/serve.mjs 4173',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
