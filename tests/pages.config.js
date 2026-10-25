import {defineConfig} from '@playwright/test';
import {fileURLToPath} from 'node:url';

const segments = (process.env.BASE_PATH || '/anatomy-atlas/').split('/').filter(Boolean);
const basePath = segments.length ? `/${segments.join('/')}/` : '/';
const baseURL = `http://127.0.0.1:4182${basePath}`;

export default defineConfig({
  testDir: '.',
  testMatch: '**/pages.smoke.js',
  timeout: 120000,
  expect: {timeout: 45000},
  workers: 1,
  retries: 0,
  outputDir: '../test-results/pages',
  reporter: 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    ...(process.env.PLAYWRIGHT_CHANNEL ? {channel: process.env.PLAYWRIGHT_CHANNEL} : {}),
    viewport: {width: 1280, height: 960},
    reducedMotion: 'reduce',
    launchOptions: {args: ['--enable-unsafe-swiftshader']},
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4182 --strictPort',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: {BASE_PATH: basePath},
    url: baseURL,
    timeout: 120000,
    reuseExistingServer: false,
  },
});
