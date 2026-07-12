import { expect, test } from '@playwright/test';

/**
 * Full-stack flow: browser → Next.js → NestJS API → Postgres.
 * Signs in as a real user, so it only runs when credentials are provided:
 *
 *   E2E_EMAIL=you@example.com E2E_PASSWORD=... pnpm test:e2e
 *
 * The test cleans up the task it creates; the title is timestamped so a
 * crashed run never collides with a later one.
 */
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe('tasks (authenticated)', () => {
  test.skip(!email || !password, 'Set E2E_EMAIL and E2E_PASSWORD to run authenticated e2e tests');

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email ?? '');
    await page.getByLabel('Password').fill(password ?? '');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/$/);
  });

  test('quick-adds, completes, and deletes a task end-to-end', async ({ page }) => {
    const widget = page.getByRole('region', { name: 'Tasks' });
    await expect(widget).toBeVisible();

    const title = `e2e task ${Date.now()}`;
    await widget.getByLabel(/quick add task/i).fill(`${title} p2`);
    await widget.getByLabel(/quick add task/i).press('Enter');

    const row = widget.locator('li', { hasText: title });
    await expect(row).toBeVisible();
    await expect(row.getByText('P2')).toBeVisible();

    // Survives a reload — it actually hit the database.
    await page.reload();
    await expect(widget.locator('li', { hasText: title })).toBeVisible();

    // Complete it: the toggle flips to checked and the row reads "done".
    await widget
      .locator('li', { hasText: title })
      .getByRole('checkbox', { name: `Mark "${title}" complete` })
      .click();
    await expect(
      widget
        .locator('li', { hasText: title })
        .getByRole('checkbox', { name: `Mark "${title}" incomplete` }),
    ).toBeChecked();
    await expect(widget.locator('li', { hasText: title }).getByText('done')).toBeVisible();

    await widget
      .locator('li', { hasText: title })
      .getByRole('button', { name: `Delete task: ${title}` })
      .click();
    await expect(widget.getByText(title)).toHaveCount(0);

    await page.reload();
    await expect(widget.getByText(title)).toHaveCount(0);
  });
});
