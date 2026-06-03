/**
 * The header wordmark + icon mark. Renders the configured brand identity
 * (`brand.markSrc`, `brand.brandMark`) so App.tsx carries no literal
 * product name. The markup + `.brand-mark` / `.app-header-sub` classes
 * are preserved exactly from the previous inline header so styling is
 * unchanged.
 *
 * The mark `alt` is empty + `aria-hidden` on purpose: the adjacent
 * wordmark text already names the product to assistive tech, so the image
 * is decorative and must not be announced twice.
 */
import { brand } from './brand.js';
import { BRAND_DEFAULTS } from './defaults.js';
import { OpenwopLogo } from './OpenwopLogo.js';

export function BrandMark() {
  const { pre, emphasis, sub } = brand.brandMark;
  // Default OpenWOP mark → inline `currentColor` SVG so it follows the in-app
  // theme toggle (manual `html.theme-dark` AND system), not just the OS. A
  // white-label custom mark (`VITE_BRAND_MARK_SRC`) stays an <img> — adopters
  // make their own asset theme-aware (e.g. an `@media` in their SVG). The old
  // `VITE_BRAND_LOGO_SRC` remains a compatibility alias for this same square slot.
  const isDefaultMark = brand.markSrc === BRAND_DEFAULTS.markSrc;
  return (
    <h1 className="brand-mark">
      {isDefaultMark
        ? <OpenwopLogo />
        : <img src={brand.markSrc} alt="" aria-hidden="true" />}
      <span>
        {pre}
        {emphasis ? <em>{emphasis}</em> : null}{' '}
        {sub ? <span className="app-header-sub">{sub}</span> : null}
      </span>
    </h1>
  );
}
