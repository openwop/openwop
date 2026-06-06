import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Live accessibility audit (GAP-ANALYSIS — live-app pass). Runs axe-core
 * against the app shell + key routes in BOTH themes. Routes that need a
 * backend render their error/empty states (still fully auditable for the
 * shell, nav, headers, notices, and any rendered controls). Serious/critical
 * violations fail the suite; we fix the app until each route is clean.
 */

const ROUTES = [
  '/', '/chat', '/runs', '/boards', '/agents', '/orgs', '/keys', '/prompts',
  '/builder', '/inbox', '/mission', '/memory', '/roster', '/capabilities', '/cli', '/demo-data',
];

async function setTheme(page: import('@playwright/test').Page, theme: 'light' | 'dark') {
  await page.evaluate((t) => {
    document.documentElement.classList.remove('theme-light', 'theme-dark');
    document.documentElement.classList.add(`theme-${t}`);
  }, theme);
}

for (const theme of ['light', 'dark'] as const) {
  for (const route of ROUTES) {
    test(`a11y: ${route} (${theme})`, async ({ page }) => {
      // Audit the SETTLED state: the page-enter animation ramps opacity 0→1,
      // and axe measures real pixels — capturing mid-animation blends fg/bg and
      // reports false contrast failures. The app honors prefers-reduced-motion,
      // so reduced-motion disables the animation and axe sees true colors.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(route);
      await page.waitForSelector('main#main-content');
      await setTheme(page, theme);
      // Let data fetches + AutoSeedDemoData re-renders settle before axe —
      // capturing mid-fetch/mid-seed measures a transient render and reports
      // false contrast failures (e.g. a board column briefly on default colors).
      // NOTE: not networkidle — the live backend's SSE/polling never goes idle.
      await page.waitForTimeout(1200);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      // The accent/semantic palette is now AA-compliant via --clay-text /
      // --clay-strong / --color-ai-text (the prior mid-tone baseline is gone).
      // Only skip axe "can't-determine" contrast nodes (e.g. gradient fills),
      // which aren't actionable.
      const isUnmeasurable = (n: { any?: Array<{ data?: unknown }> }): boolean => {
        const d = n.any?.[0]?.data as { fgColor?: string; bgColor?: string } | undefined;
        return !d || (d.fgColor === undefined && d.bgColor === undefined);
      };
      const serious = results.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => (v.id === 'color-contrast' ? { ...v, nodes: v.nodes.filter((n) => !isUnmeasurable(n)) } : v))
        .filter((v) => v.nodes.length > 0);
      if (serious.length) {
        console.log(`\n[a11y ${route} ${theme}] ${serious.length} serious/critical:`);
        for (const v of serious) {
          console.log(`  - ${v.id} (${v.impact}) ×${v.nodes.length}: ${v.help}`);
          for (const n of v.nodes.slice(0, 8)) {
            const d = n.any?.[0]?.data as { fgColor?: string; bgColor?: string; contrastRatio?: number; expectedContrastRatio?: string } | undefined;
            const detail = d ? `fg=${d.fgColor} bg=${d.bgColor} ratio=${d.contrastRatio} need=${d.expectedContrastRatio}` : '';
            console.log(`      · ${n.target?.join(' ')}  ${detail}`);
          }
        }
      }
      expect(serious, serious.map((v) => `${v.id}: ${v.help}`).join('\n')).toEqual([]);
    });
  }
}
