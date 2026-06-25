import { expect, test } from '@playwright/test';

test('opens the web app homepage in Chromium', async ({ page }) => {
  await page.goto('/?lang=en');

  // Page metadata title (set in app metadata).
  await expect(page).toHaveTitle('kInorA — Personalized Training');

  // Brand wordmark in the nav (appears in nav + footer, take the first).
  await expect(page.getByText('kInorA').first()).toBeVisible();

  // Primary hero CTA renders ("Start free" appears in nav, hero, and CTA band).
  await expect(page.getByText('Start free').first()).toBeVisible();

  // Hero headline is present.
  await expect(
    page.getByRole('heading', { name: /Your personal trainer/i }),
  ).toBeVisible();
});
