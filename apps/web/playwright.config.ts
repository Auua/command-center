import { defineConfig, devices } from '@playwright/test';

/**
 * Web e2e (Playwright).
 *
 * Two tiers of tests live in e2e/:
 * - Unauthenticated flows (auth redirects, login page) — always run; they
 *   need only the Next.js dev server and work with placeholder Supabase env.
 * - Authenticated flows (dashboard + braindump) — run only when
 *   E2E_EMAIL/E2E_PASSWORD are set; they sign in against the real Supabase
 *   project and exercise the real API, so the API must also be running
 *   (started automatically below when credentials are provided).
 */
const hasCredentials = Boolean(process.env.E2E_EMAIL && process.env.E2E_PASSWORD);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // authed tests mutate one user's real data
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm dev',
      url: 'http://localhost:3000/login',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    // The NestJS API — only needed (and only startable) with real env.
    ...(hasCredentials
      ? [
          {
            command: 'pnpm --filter @command-center/api dev',
            cwd: '../..',
            url: 'http://localhost:3001/health',
            reuseExistingServer: true,
            timeout: 120_000,
          },
        ]
      : []),
  ],
});
