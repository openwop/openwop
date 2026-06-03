/**
 * White-label brand defaults — the single source of truth for every
 * brand/identity *string and asset path* in the reference app.
 *
 * This module is intentionally PURE DATA: no `import.meta.env`, no
 * `process.env`, no React. That keeps it importable from two very
 * different contexts:
 *   - the client (`brand.ts`), which layers `VITE_BRAND_*` env
 *     overrides on top of these defaults at build time, and
 *   - the Vite config (`vite.config.ts` → `brandHtmlPlugin`), which runs
 *     in Node at build time to stamp the document title / favicon /
 *     fonts link into `index.html`.
 *
 * To re-brand WITHOUT editing TypeScript, set the matching `VITE_BRAND_*`
 * environment variable (see `WHITE-LABEL.md`). Editing the values here is
 * only for forks that want to change the *shipped* default identity.
 *
 * Colors and typography are NOT configured here — they live in CSS
 * custom properties. Override them in `src/brand/brand.css`, which loads
 * after `global.css` and wins the cascade. (The editorial palette in
 * `global.css :root` is under a lockstep sync rule with the marketing
 * site's `public/styles.css` per DESIGN.app.md §2 and MUST NOT be edited
 * for a re-skin — override in `brand.css` instead.)
 */

export interface BrandConfig {
  /** Plain-text product name. Used in prose, the assistant persona, etc. */
  productName: string;
  /**
   * The three-part wordmark rendered in the header. The default
   * "Open<em>WOP</em> workflow engine" splits into pre/emphasis/sub so a
   * re-brand can emphasize a different syllable (or set `emphasis` empty).
   */
  brandMark: { pre: string; emphasis: string; sub: string };
  /** Short descriptor; rendered as the header sub-label by default. */
  tagline: string;
  /** Footer disclaimer line. */
  footerText: string;
  /** Name the in-app AI assistant refers to itself / the product by. */
  assistantName: string;
  /** Square icon mark used in the sidebar header and PWA manifest. */
  markSrc: string;
  /** Optional full lockup asset for marketing/brand surfaces. */
  lockupSrc: string;
  /** @deprecated Use `markSrc`; retained as a compatibility alias. */
  logoSrc: string;
  /** Favicon — a URL or `data:` URI. Build-time only (stamped into HTML). */
  faviconSrc: string;
  /** `<title>` of the document shell. Build-time only. */
  documentTitle: string;
  /** Web-font stylesheet `<link href>`. Build-time only. */
  fontsHref: string;
  /** Primary deployment domain — surfaced in the privacy disclosure. */
  primaryDomain: string;
  /** User-facing deployment/workspace name, shown in the app chrome. */
  instanceName: string;
  /** "Learn more" home URL (privacy footer). */
  homeUrl: string;
  /** Source-repository URL (privacy footer). */
  repoUrl: string;
  /** PWA manifest + mobile-chrome `theme-color`. Build-time only. */
  themeColor: string;
  /** Initial theme when the user has not chosen a local override. */
  defaultTheme: 'system' | 'light' | 'dark';
  /** Reserved for the AppGate primitive; default keeps the app ungated. */
  appGate: { mode: 'none' | 'password' | 'sign-in'; password: string };
}

export const BRAND_DEFAULTS: BrandConfig = {
  productName: 'OpenWOP',
  brandMark: { pre: 'Open', emphasis: 'WOP', sub: 'workflow engine' },
  tagline: 'workflow engine',
  footerText: 'Sample / template code. Not production-hardened.',
  assistantName: 'OpenWOP',
  markSrc: '/OpenWOP.svg',
  lockupSrc: '',
  logoSrc: '/OpenWOP.svg',
  faviconSrc:
    "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>" +
    "<rect width='32' height='32' rx='6' fill='%23a35a30'/>" +
    "<text x='16' y='22' font-family='Instrument Serif,Times New Roman,serif' " +
    "font-style='italic' font-size='20' fill='%23f4f1ea' text-anchor='middle'>O</text></svg>",
  documentTitle: 'workflow-engine — OpenWOP Reference UI',
  fontsHref:
    'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1' +
    '&family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500&display=swap',
  primaryDomain: 'app.openwop.dev',
  instanceName: 'Demo host',
  homeUrl: 'https://openwop.dev/',
  repoUrl: 'https://github.com/openwop/openwop',
  themeColor: '#1a1a17',
  defaultTheme: 'system',
  appGate: { mode: 'none', password: '' },
};

/**
 * The `VITE_BRAND_*` env-var name for each overridable field. Shared by
 * the client config and the Vite HTML plugin so the two never drift on
 * which variable feeds which field.
 */
export const BRAND_ENV_KEYS = {
  productName: 'VITE_BRAND_PRODUCT_NAME',
  markPre: 'VITE_BRAND_MARK_PRE',
  markEmphasis: 'VITE_BRAND_MARK_EMPHASIS',
  markSub: 'VITE_BRAND_MARK_SUB',
  tagline: 'VITE_BRAND_TAGLINE',
  footerText: 'VITE_BRAND_FOOTER_TEXT',
  assistantName: 'VITE_BRAND_ASSISTANT_NAME',
  markSrc: 'VITE_BRAND_MARK_SRC',
  lockupSrc: 'VITE_BRAND_LOCKUP_SRC',
  logoSrc: 'VITE_BRAND_LOGO_SRC',
  faviconSrc: 'VITE_BRAND_FAVICON_SRC',
  documentTitle: 'VITE_BRAND_DOCUMENT_TITLE',
  fontsHref: 'VITE_BRAND_FONTS_HREF',
  primaryDomain: 'VITE_BRAND_PRIMARY_DOMAIN',
  instanceName: 'VITE_BRAND_INSTANCE_NAME',
  homeUrl: 'VITE_BRAND_HOME_URL',
  repoUrl: 'VITE_BRAND_REPO_URL',
  themeColor: 'VITE_BRAND_THEME_COLOR',
  defaultTheme: 'VITE_BRAND_DEFAULT_THEME',
  appGateMode: 'VITE_BRAND_APP_GATE_MODE',
  appGatePassword: 'VITE_BRAND_APP_GATE_PASSWORD',
} as const;

/** A non-empty string, or the fallback when unset/blank. */
export function coalesce(value: string | undefined, fallback: string): string {
  return value != null && value.trim() !== '' ? value : fallback;
}

/** A non-empty string, or `undefined` when unset/blank. */
export function optional(value: string | undefined): string | undefined {
  return value != null && value.trim() !== '' ? value : undefined;
}

function coalesceTheme(
  value: string | undefined,
  fallback: BrandConfig['defaultTheme'],
): BrandConfig['defaultTheme'] {
  return value === 'system' || value === 'light' || value === 'dark' ? value : fallback;
}

function coalesceGateMode(
  value: string | undefined,
  fallback: BrandConfig['appGate']['mode'],
): BrandConfig['appGate']['mode'] {
  return value === 'none' || value === 'password' || value === 'sign-in' ? value : fallback;
}

/**
 * Resolve a full `BrandConfig` from a flat env bag (Node `process.env`
 * shape: `Record<string, string | undefined>`). Used by the Vite plugin.
 * The client uses `brand.ts`, which reads the statically-inlined
 * `import.meta.env` instead so Vite can tree-shake per build.
 */
export function resolveBrandFromEnv(
  env: Record<string, string | undefined>,
): BrandConfig {
  const k = BRAND_ENV_KEYS;
  const markSrc = optional(env[k.markSrc]) ?? optional(env[k.logoSrc]) ?? BRAND_DEFAULTS.markSrc;
  const lockupSrc = optional(env[k.lockupSrc]) ?? BRAND_DEFAULTS.lockupSrc;
  return {
    productName: coalesce(env[k.productName], BRAND_DEFAULTS.productName),
    brandMark: {
      pre: coalesce(env[k.markPre], BRAND_DEFAULTS.brandMark.pre),
      emphasis: coalesce(env[k.markEmphasis], BRAND_DEFAULTS.brandMark.emphasis),
      sub: coalesce(env[k.markSub], BRAND_DEFAULTS.brandMark.sub),
    },
    tagline: coalesce(env[k.tagline], BRAND_DEFAULTS.tagline),
    footerText: coalesce(env[k.footerText], BRAND_DEFAULTS.footerText),
    assistantName: coalesce(env[k.assistantName], BRAND_DEFAULTS.assistantName),
    markSrc,
    lockupSrc,
    logoSrc: markSrc,
    faviconSrc: coalesce(env[k.faviconSrc], BRAND_DEFAULTS.faviconSrc),
    documentTitle: coalesce(env[k.documentTitle], BRAND_DEFAULTS.documentTitle),
    fontsHref: coalesce(env[k.fontsHref], BRAND_DEFAULTS.fontsHref),
    primaryDomain: coalesce(env[k.primaryDomain], BRAND_DEFAULTS.primaryDomain),
    instanceName: coalesce(env[k.instanceName], BRAND_DEFAULTS.instanceName),
    homeUrl: coalesce(env[k.homeUrl], BRAND_DEFAULTS.homeUrl),
    repoUrl: coalesce(env[k.repoUrl], BRAND_DEFAULTS.repoUrl),
    themeColor: coalesce(env[k.themeColor], BRAND_DEFAULTS.themeColor),
    defaultTheme: coalesceTheme(env[k.defaultTheme], BRAND_DEFAULTS.defaultTheme),
    appGate: {
      mode: coalesceGateMode(env[k.appGateMode], BRAND_DEFAULTS.appGate.mode),
      password: coalesce(env[k.appGatePassword], BRAND_DEFAULTS.appGate.password),
    },
  };
}
