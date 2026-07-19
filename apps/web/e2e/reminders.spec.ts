import { expect, test, type Page } from '@playwright/test';

/**
 * Full-stack reminders flow (ADR-015): browser → Next.js → NestJS API →
 * Postgres. Requires credentials + the API running, like tasks.spec.ts:
 *
 *   E2E_EMAIL=you@example.com E2E_PASSWORD=... pnpm test:e2e
 *
 * Created reminders are timestamped and deleted at the end of each test.
 */
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

const WIDGET_NAME = /Today.s reminders/;

async function signIn(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email ?? '');
  await page.getByLabel('Password').fill(password ?? '');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/$/);
}

async function createReminder(page: Page, name: string): Promise<void> {
  const widget = page.getByRole('region', { name: WIDGET_NAME });
  await expect(widget).toBeVisible();
  await widget.getByRole('button', { name: 'Add reminder' }).click();

  const dialog = page.getByRole('dialog', { name: 'New reminder' });
  await dialog.getByLabel('Name').fill(name);
  await dialog.getByLabel('Time').fill('23:45');
  await dialog.getByRole('button', { name: 'Create reminder' }).click();
  await expect(dialog).toBeHidden();
  await expect(widget.locator('li', { hasText: name })).toBeVisible();
}

async function deleteReminder(page: Page, name: string): Promise<void> {
  const widget = page.getByRole('region', { name: WIDGET_NAME });
  await widget
    .locator('li', { hasText: name })
    .getByRole('button', { name: `Edit ${name}` })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Edit reminder' });
  page.once('dialog', (confirm) => void confirm.accept());
  await dialog.getByRole('button', { name: 'Delete reminder' }).click();
  await expect(widget.locator('li', { hasText: name })).toHaveCount(0);
}

test.describe('reminders (authenticated)', () => {
  test.skip(!email || !password, 'Set E2E_EMAIL and E2E_PASSWORD to run authenticated e2e tests');

  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('creates, pauses, edits and deletes a reminder end-to-end', async ({ page }) => {
    const widget = page.getByRole('region', { name: WIDGET_NAME });
    const name = `e2e reminder ${Date.now()}`;
    await createReminder(page, name);

    // Survives a reload — it actually hit the database.
    await page.reload();
    const row = widget.locator('li', { hasText: name });
    await expect(row).toBeVisible();

    // With an enabled timed reminder and permission still 'default', the
    // enable-push banner earns its space (ADR-015 permission UX).
    await expect(widget.getByRole('button', { name: 'Enable notifications' })).toBeVisible();

    // Pause: optimistic flip + visible "Paused" token; persists.
    await row.getByRole('switch', { name: `${name} reminder` }).click();
    await expect(row.getByText('Paused')).toBeVisible();
    await page.reload();
    await expect(widget.locator('li', { hasText: name }).getByText('Paused')).toBeVisible();

    // Edit: rename via the builder (row name button opens it pre-filled).
    const renamed = `${name} renamed`;
    await widget
      .locator('li', { hasText: name })
      .getByRole('button', { name: `Edit ${name}` })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Edit reminder' });
    await expect(dialog.getByLabel('Name')).toHaveValue(name);
    await dialog.getByLabel('Name').fill(renamed);
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden();
    await expect(widget.locator('li', { hasText: renamed })).toBeVisible();

    await deleteReminder(page, renamed);
    await page.reload();
    await expect(widget.locator('li', { hasText: renamed })).toHaveCount(0);
  });

  test.describe('granted notification permission', () => {
    test.use({ permissions: ['notifications'] });

    test('shows no permission banner when push permission is already granted', async ({ page }) => {
      const widget = page.getByRole('region', { name: WIDGET_NAME });
      const name = `e2e granted ${Date.now()}`;
      await createReminder(page, name);

      await expect(widget.getByRole('button', { name: 'Enable notifications' })).toHaveCount(0);

      await deleteReminder(page, name);
    });
  });

  test('deep link /?notification=<id> opens the notification panel', async ({ page }) => {
    await page.goto('/?notification=e2e-deep-link');
    await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
    // The param is consumed and stripped from the URL.
    await expect(page).toHaveURL(/\/$/);
  });
});
