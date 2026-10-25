import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.js',
  timeout: 90000,
  expect: {timeout: 30000},
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: '../test-results',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4181',
    channel: 'chrome',
    viewport: {width: 1440, height: 1100},
    launchOptions: {args: ['--enable-unsafe-swiftshader']},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && node server.mjs --production',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {PORT: '4181'},
    url: 'http://127.0.0.1:4181',
    timeout: 120000,
    reuseExistingServer: false,
  },
});
