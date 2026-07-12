import { expect, test } from '@playwright/test';

/**
 * Full-stack flow: browser → Next.js → NestJS API → MongoDB Atlas.
 * Signs in as a real user, so it only runs when credentials are provided:
 *
 *   E2E_EMAIL=you@example.com E2E_PASSWORD=... pnpm test:e2e
 *
 * The test cleans up the note it creates; content is timestamped so a
 * crashed run never collides with a later one.
 */
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe('braindump (authenticated)', () => {
  test.skip(!email || !password, 'Set E2E_EMAIL and E2E_PASSWORD to run authenticated e2e tests');

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email ?? '');
    await page.getByLabel('Password').fill(password ?? '');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/$/);
  });

  test('captures and deletes a thought end-to-end', async ({ page }) => {
    const widget = page.getByRole('region', { name: 'Braindump' });
    await expect(widget).toBeVisible();

    const content = `e2e thought ${Date.now()}`;
    await widget.getByLabel(/dump a thought/i).fill(content);
    await widget.getByRole('button', { name: 'Add' }).click();

    const item = widget.getByText(content);
    await expect(item).toBeVisible();

    // Survives a reload — it actually hit the database.
    await page.reload();
    await expect(widget.getByText(content)).toBeVisible();

    await widget
      .locator('li', { hasText: content })
      .getByRole('button', { name: /delete note/i })
      .click();
    await expect(widget.getByText(content)).toHaveCount(0);

    await page.reload();
    await expect(widget.getByText(content)).toHaveCount(0);
  });
});
