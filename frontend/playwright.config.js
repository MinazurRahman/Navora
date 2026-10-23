import { defineConfig, devices } from '@playwright/test';

// Browser tests against the production build. The API is faked per test (e2e/fakeApi.js),
// so no backend is needed. Locally the installed Chrome is used; CI installs Chromium.
const PORT = 4174;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    env: { VITE_API_BASE_URL: 'http://api.test/api/v1' },
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chrome',
      use: { ...devices['Desktop Chrome'], ...(process.env.CI ? {} : { channel: 'chrome' }) },
    },
  ],
});
