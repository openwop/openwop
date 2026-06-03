/**
 * The header wordmark + logo. Renders the configured brand identity
 * (`brand.logoSrc`, `brand.brandMark`) so App.tsx carries no literal
 * product name. The markup + `.brand-mark` / `.app-header-sub` classes
 * are preserved exactly from the previous inline header so styling is
 * unchanged.
 *
 * The logo `alt` is empty + `aria-hidden` on purpose: the adjacent
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
  // white-label custom logo (`VITE_BRAND_LOGO_SRC`) stays an <img> — adopters
  // make their own asset theme-aware (e.g. an `@media` in their SVG).
  const isDefaultLogo = brand.logoSrc === BRAND_DEFAULTS.logoSrc;
  return (
    <h1 className="brand-mark">
      {isDefaultLogo
        ? <OpenwopLogo />
        : <img src={brand.logoSrc} alt="" aria-hidden="true" />}
      <span>
        {pre}
        {emphasis ? <em>{emphasis}</em> : null}{' '}
        {sub ? <span className="app-header-sub">{sub}</span> : null}
      </span>
    </h1>
  );
}
