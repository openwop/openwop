/**
 * Empty-module shim for vite's resolve.alias.
 *
 * Replaces `@openwop/openwop/dist/webhook-helpers.js` in the SPA bundle.
 * Webhook signature verification is server-side only — the host computes
 * HMACs with `node:crypto` when delivering a webhook; the browser never
 * runs that code path. Bundling it pulls `node:crypto` into the SPA,
 * which vite externalizes for browser compat, leaving the named exports
 * (`createHmac`, `timingSafeEqual`) unresolved and the build broken.
 *
 * The SDK barrel re-exports webhook-helpers; this shim short-circuits
 * the import. All current frontend consumers of `@openwop/openwop` use
 * `import type { … }` only (RunSnapshot / RunEventDoc / StreamMode /
 * etc.), so no runtime symbols are needed from webhook-helpers either.
 */
export {};
