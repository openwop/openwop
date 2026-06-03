/**
 * Client-side resolved brand config.
 *
 * Vite statically inlines `import.meta.env.VITE_*` at build time, so we
 * read each override explicitly (a dynamic `env[key]` lookup would not be
 * inlined and would resolve to `undefined` in the bundle). Anything unset
 * falls back to `BRAND_DEFAULTS`.
 *
 * Import the singleton `brand` anywhere in the app:
 *
 *   import { brand } from '../brand/brand.js';
 *   <h1>{brand.productName}</h1>
 *
 * Brand is fixed at build time, so a plain module singleton is correct —
 * no React context / provider is needed.
 */
import { BRAND_DEFAULTS, coalesce, optional, type BrandConfig } from './defaults.js';

const env = import.meta.env;
const markSrc =
  optional(env.VITE_BRAND_MARK_SRC as string | undefined) ??
  optional(env.VITE_BRAND_LOGO_SRC as string | undefined) ??
  BRAND_DEFAULTS.markSrc;

function coalesceTheme(value: string | undefined): BrandConfig['defaultTheme'] {
  return value === 'system' || value === 'light' || value === 'dark'
    ? value
    : BRAND_DEFAULTS.defaultTheme;
}

function coalesceGateMode(value: string | undefined): BrandConfig['appGate']['mode'] {
  return value === 'none' || value === 'password' || value === 'sign-in'
    ? value
    : BRAND_DEFAULTS.appGate.mode;
}

export const brand: BrandConfig = {
  productName: coalesce(
    env.VITE_BRAND_PRODUCT_NAME as string | undefined,
    BRAND_DEFAULTS.productName,
  ),
  brandMark: {
    pre: coalesce(env.VITE_BRAND_MARK_PRE as string | undefined, BRAND_DEFAULTS.brandMark.pre),
    emphasis: coalesce(
      env.VITE_BRAND_MARK_EMPHASIS as string | undefined,
      BRAND_DEFAULTS.brandMark.emphasis,
    ),
    sub: coalesce(env.VITE_BRAND_MARK_SUB as string | undefined, BRAND_DEFAULTS.brandMark.sub),
  },
  tagline: coalesce(env.VITE_BRAND_TAGLINE as string | undefined, BRAND_DEFAULTS.tagline),
  footerText: coalesce(
    env.VITE_BRAND_FOOTER_TEXT as string | undefined,
    BRAND_DEFAULTS.footerText,
  ),
  assistantName: coalesce(
    env.VITE_BRAND_ASSISTANT_NAME as string | undefined,
    BRAND_DEFAULTS.assistantName,
  ),
  markSrc,
  lockupSrc: coalesce(
    env.VITE_BRAND_LOCKUP_SRC as string | undefined,
    BRAND_DEFAULTS.lockupSrc,
  ),
  logoSrc: markSrc,
  // faviconSrc / documentTitle / fontsHref are stamped into index.html by
  // the Vite plugin at build time; they are not consumed from the client
  // bundle. Kept on the object for a single complete shape.
  faviconSrc: coalesce(
    env.VITE_BRAND_FAVICON_SRC as string | undefined,
    BRAND_DEFAULTS.faviconSrc,
  ),
  documentTitle: coalesce(
    env.VITE_BRAND_DOCUMENT_TITLE as string | undefined,
    BRAND_DEFAULTS.documentTitle,
  ),
  fontsHref: coalesce(
    env.VITE_BRAND_FONTS_HREF as string | undefined,
    BRAND_DEFAULTS.fontsHref,
  ),
  primaryDomain: coalesce(
    env.VITE_BRAND_PRIMARY_DOMAIN as string | undefined,
    BRAND_DEFAULTS.primaryDomain,
  ),
  instanceName: coalesce(
    env.VITE_BRAND_INSTANCE_NAME as string | undefined,
    BRAND_DEFAULTS.instanceName,
  ),
  homeUrl: coalesce(env.VITE_BRAND_HOME_URL as string | undefined, BRAND_DEFAULTS.homeUrl),
  repoUrl: coalesce(env.VITE_BRAND_REPO_URL as string | undefined, BRAND_DEFAULTS.repoUrl),
  // Stamped into the PWA manifest + theme-color meta by the Vite plugin at
  // build time (like faviconSrc); kept here for a single complete shape.
  themeColor: coalesce(env.VITE_BRAND_THEME_COLOR as string | undefined, BRAND_DEFAULTS.themeColor),
  defaultTheme: coalesceTheme(env.VITE_BRAND_DEFAULT_THEME as string | undefined),
  appGate: {
    mode: coalesceGateMode(env.VITE_BRAND_APP_GATE_MODE as string | undefined),
    password: coalesce(
      env.VITE_BRAND_APP_GATE_PASSWORD as string | undefined,
      BRAND_DEFAULTS.appGate.password,
    ),
  },
};
