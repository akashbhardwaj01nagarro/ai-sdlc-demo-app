import { defineConfig, devices } from '@playwright/test';

// PW_SLOWMO=400 pauses 400 ms before every browser action, for demos (with --headed). Default 0.
const slowMo = Number(process.env.PW_SLOWMO) || 0;

export default defineConfig({
  testDir: './tests',
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5000',
    trace: 'on-first-retry',
    launchOptions: { slowMo },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'dotnet run --project ../backend/src/InvoiceApp.Api',
    url: 'http://localhost:5000',
    // An app that is already running may be built from older code, so Playwright starts its own and
    // fails if port 5000 is taken. Set PW_REUSE_SERVER=1 to reuse a running app on purpose.
    reuseExistingServer: process.env.PW_REUSE_SERVER === '1',
    timeout: 120_000,
  },
});
