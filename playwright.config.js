// Playwright: real-browser tests of the web app (tests/e2e).
// BASE_URL picks the site: localhost by default, or a deployed URL
// (BASE_URL=https://whtracker.vercel.app npx playwright test).
// Only pages that work without signing in are covered: tests never sign in.
import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3000';
const local = BASE_URL.includes('127.0.0.1') || BASE_URL.includes('localhost');

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: BASE_URL, trace: 'retain-on-failure' },
  // All three engines on CI (Linux). On this Windows PC Firefox won't launch and
  // WebKit lacks a system library, so local runs use Chromium unless ALL_BROWSERS=1.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(process.env.CI || process.env.ALL_BROWSERS
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } }
        ]
      : [])
  ],
  // Starts the local preview (the same one `npm run play` opens) unless it's already running.
  webServer: local
    ? {
        command: 'node scripts/play.js --no-open',
        url: BASE_URL + '/login.html',
        reuseExistingServer: true,
        timeout: 30_000
      }
    : undefined
});
