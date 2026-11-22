// Pages anyone can open without signing in. Real browsers (Chromium, Firefox, WebKit).
import { test, expect } from '@playwright/test';

test('sign-in page offers Google, GitHub and email', async ({ page }) => {
  await page.goto('/login.html');
  await expect(page).toHaveTitle(/Sign In/);
  await expect(page.getByRole('button', { name: /Continue with Google/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Continue with GitHub/ })).toBeVisible();
  await expect(page.getByLabel(/Email/).first()).toBeVisible();
});

test('the app sends a signed-out visitor to sign in', async ({ page }) => {
  await page.goto('/index.html');
  await page.waitForURL(/\/login\.html/, { timeout: 15_000 });
});

test('unknown pages show the 404 page with a way back', async ({ page }) => {
  await page.goto('/404.html');
  await expect(page).toHaveTitle(/Page not found/);
  await expect(page.getByRole('link', { name: 'Go to 5pm' })).toBeVisible();
});

test('privacy and about pages load', async ({ page }) => {
  for (const path of ['/privacy.html', '/about.html']) {
    const res = await page.goto(path);
    expect(res.ok()).toBe(true);
    await expect(page.locator('h1').first()).toBeVisible();
  }
});
