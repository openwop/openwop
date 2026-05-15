/**
 * Frontend config. Reads VITE_OPENWOP_BASE_URL + VITE_OPENWOP_API_KEY at
 * build time (Vite inlines these into the bundle). A `.env.local` at the
 * react project root overrides defaults.
 */

export const config = {
  baseUrl: (import.meta.env.VITE_OPENWOP_BASE_URL as string | undefined) ?? 'http://localhost:8080',
  apiKey: (import.meta.env.VITE_OPENWOP_API_KEY as string | undefined) ?? 'sample-token',
};
