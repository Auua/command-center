import { expect, test } from '@playwright/test';

/**
 * Auth policy from ADR §5.1 / lib/supabase/middleware.ts: everything except
 * /login and /auth/* requires a session. These tests need no credentials.
 */

test.describe('unauthenticated access', () => {
  test('redirects the dashboard to /login', async ({ page }) => {
    await page.goto('/');
    await page.waitForURL('**/login');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('redirects arbitrary protected paths to /login', async ({ page }) => {
    await page.goto('/settings/anything');
    await page.waitForURL('**/login');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('renders the sign-in form', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: 'Command Center' })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    // No sign-up affordance: single-user app, accounts are provisioned in
    // Supabase directly (ADR §1.3).
    await expect(page.getByRole('button', { name: 'Sign up' })).toHaveCount(0);
  });
});
