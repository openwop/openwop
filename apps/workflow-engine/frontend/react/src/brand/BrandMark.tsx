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

export function BrandMark() {
  const { pre, emphasis, sub } = brand.brandMark;
  return (
    <h1 className="brand-mark">
      <img src={brand.logoSrc} alt="" aria-hidden="true" />
      <span>
        {pre}
        {emphasis ? <em>{emphasis}</em> : null}{' '}
        {sub ? <span className="app-header-sub">{sub}</span> : null}
      </span>
    </h1>
  );
}
