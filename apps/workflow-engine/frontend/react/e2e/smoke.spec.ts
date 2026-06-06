import { test, expect } from '@playwright/test';

/**
 * App shell smoke (GAP-ANALYSIS E16). Confirms the SPA boots, the persistent
 * sidebar + main land, the skip-to-content a11y link (E6) is present, and a
 * lazy route chunk (E13) navigates without a white screen — the error boundary
 * (E1) would otherwise swallow a crash into a fallback we can assert against.
 */
test.describe('app shell', () => {
  test('boots to the chat surface with sidebar + main', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('main#main-content')).toBeVisible();
    // The persistent left-rail sidebar nav (labelled "Sections").
    await expect(page.getByRole('navigation', { name: 'Sections' })).toBeVisible();
  });

  test('exposes the skip-to-content link (a11y)', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: /skip to content/i })).toHaveCount(1);
  });

  test('navigates to a lazy route without a fatal error', async ({ page }) => {
    await page.goto('/boards');
    // The error-boundary fallback would show this copy; assert it is absent.
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    await expect(page.locator('main#main-content')).toBeVisible();
  });
});
