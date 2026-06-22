import { expect, test } from '@playwright/test';

test('opens the web app homepage in Chromium', async ({ page }) => {
  await page.goto('/?lang=en');

  await expect(page).toHaveTitle('kInorA — Personalized Training');
  await expect(page.getByRole('heading', { name: 'kInorA' })).toBeVisible();
  await expect(page.getByText('Personalized training powered by AI')).toBeVisible();
});
