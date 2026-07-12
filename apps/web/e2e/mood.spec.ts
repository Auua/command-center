import { expect, test } from "@playwright/test";

/**
 * Full-stack flow: browser → Next.js → NestJS API → Postgres.
 * Signs in as a real user, so it only runs when credentials are provided:
 *
 *   E2E_EMAIL=you@example.com E2E_PASSWORD=... pnpm test:e2e
 *
 * The test undoes the check-in it logs, so a run leaves no trace in the
 * user's mood history.
 */
const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;

test.describe("mood (authenticated)", () => {
  test.skip(
    !email || !password,
    "Set E2E_EMAIL and E2E_PASSWORD to run authenticated e2e tests",
  );

  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email ?? "");
    await page.getByLabel("Password").fill(password ?? "");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/$/);
  });

  test("logs and undoes a check-in end-to-end", async ({ page }) => {
    const widget = page.getByRole("region", { name: "Mood check-in" });
    await expect(widget).toBeVisible();

    await widget.getByRole("button", { name: "stressed" }).click();
    await widget.getByRole("button", { name: "Good" }).click();

    await expect(widget.getByText(/logged good/i)).toBeVisible();
    await expect(widget.getByRole("button", { name: "Good" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Undo removes it again — the run leaves no data behind.
    await widget.getByRole("button", { name: "Undo" }).click();
    await expect(widget.getByText(/logged good/i)).toHaveCount(0);
  });
});
