import { test, expect } from '@playwright/test';

/**
 * Interaction tests for the shared ui/Modal primitive (GAP-ANALYSIS E7),
 * exercised through CreateBoardModal — the modal opens client-side from the
 * "+ New board" control, so this needs no backend. Verifies the focus-trap +
 * restore (useFocusTrap), Escape-to-close, and backdrop-click-to-close that the
 * primitive owns, in a real browser.
 */
test.describe('ui/Modal (via Create-board)', () => {
  test('opens a labelled dialog and moves focus inside (focus-trap)', async ({ page }) => {
    await page.goto('/boards');
    await page.waitForSelector('main#main-content');
    await page.getByRole('button', { name: '+ New board' }).first().click();

    const dialog = page.getByRole('dialog', { name: 'Create a board' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    // useFocusTrap moved focus into the dialog (the name input autofocuses).
    const focusInside = await page.evaluate(
      () => document.querySelector('[role="dialog"]')?.contains(document.activeElement) ?? false,
    );
    expect(focusInside).toBe(true);
  });

  test('traps Tab within the dialog', async ({ page }) => {
    await page.goto('/boards');
    await page.waitForSelector('main#main-content');
    await page.getByRole('button', { name: '+ New board' }).first().click();
    await expect(page.getByRole('dialog', { name: 'Create a board' })).toBeVisible();

    // Tab through more controls than the dialog has — focus must never escape it.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(
        () => document.querySelector('[role="dialog"]')?.contains(document.activeElement) ?? false,
      );
      expect(inside, `focus left the dialog after ${i + 1} Tab(s)`).toBe(true);
    }
  });

  test('Escape closes and restores focus to the opener', async ({ page }) => {
    await page.goto('/boards');
    await page.waitForSelector('main#main-content');
    const opener = page.getByRole('button', { name: '+ New board' }).first();
    await opener.click();
    await expect(page.getByRole('dialog', { name: 'Create a board' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Create a board' })).toHaveCount(0);
    await expect(opener).toBeFocused(); // useFocusTrap restored focus to the trigger
  });

  test('backdrop click closes; dialog-body click does not', async ({ page }) => {
    await page.goto('/boards');
    await page.waitForSelector('main#main-content');
    await page.getByRole('button', { name: '+ New board' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Create a board' });
    await expect(dialog).toBeVisible();

    // Clicking inside the dialog body must NOT close it.
    await dialog.getByText('Create a board').first().click();
    await expect(dialog).toBeVisible();

    // Clicking the scrim (outside the dialog) closes it.
    await page.locator('.hire-scrim').click({ position: { x: 5, y: 5 } });
    await expect(dialog).toHaveCount(0);
  });
});
