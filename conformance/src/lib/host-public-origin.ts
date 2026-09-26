/**
 * The origin a USER AGENT reaches the host under test on — for rows whose
 * normative text is about the host's own origin rather than the suite's
 * transport (RFC 0199 §C.2: `connectUrl` "MUST be an `https` URL on the host's
 * own origin").
 *
 * Until 2.39.4 those rows compared against `--base-url`. A certification cut
 * drives the host over loopback (`http://127.0.0.1:…`), which can never be the
 * https origin a user agent is sent to — so a host with a public front could not
 * pass, and the v2 reference host, which implements all of §C, advertised none of
 * it (it needs an https public base to advertise `oauth.credentialInterrupt`).
 *
 * `OPENWOP_HOST_PUBLIC_URL` names that front, validated like every other suite
 * front (`resolvePublicFront`: https, publicly resolvable). A declared front is
 * EVIDENCE only once it is shown to serve THIS host: the discovery document
 * fetched through it must equal the one fetched over `--base-url`. Otherwise the
 * rows that depend on it record `blocked` with that cause — a front pointing at
 * some other host must not let a `connectUrl` on that other origin pass.
 *
 * Unset, this returns `--base-url`'s origin exactly as before: no behaviour
 * changes for a run that does not declare a front.
 */
import { resolvePublicFront } from './webhook-receiver.js';

export const HOST_FRONT_ENV = 'OPENWOP_HOST_PUBLIC_URL';

export type HostOrigin =
  | { readonly ok: true; readonly origin: string; readonly declared: boolean }
  | { readonly ok: false; readonly reason: string };

type Fetcher = (url: string) => Promise<{ status: number; text: string }>;

const defaultFetch: Fetcher = async (url) => {
  const res = await fetch(url, { headers: { accept: 'application/json', 'OpenWOP-Version': '2.0' }, signal: AbortSignal.timeout(15_000) });
  return { status: res.status, text: await res.text() };
};

/** Key-order-independent JSON equality — the two fetches may serialise differently. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/**
 * Resolve the host's own origin. `baseUrl` is the suite's `--base-url`; `fetcher`
 * is injectable so the self-test can run without a host.
 */
export async function hostPublicOrigin(baseUrl: string, fetcher: Fetcher = defaultFetch): Promise<HostOrigin> {
  const base = new URL(baseUrl);
  const front = resolvePublicFront(HOST_FRONT_ENV, base.origin);
  if (!front.tunnelled) return { ok: true, origin: base.origin, declared: false };
  const frontOrigin = new URL(front.url).origin;
  const path = '/.well-known/openwop';
  let viaFront: { status: number; text: string };
  let viaBase: { status: number; text: string };
  try {
    [viaFront, viaBase] = await Promise.all([fetcher(`${frontOrigin}${path}`), fetcher(`${base.origin}${path}`)]);
  } catch (e) {
    return { ok: false, reason: `${HOST_FRONT_ENV}=${frontOrigin} could not be fetched (${(e as Error).message}) — the declared front is not shown to serve the host under test` };
  }
  if (viaFront.status !== 200 || viaBase.status !== 200) {
    return { ok: false, reason: `discovery answered ${viaFront.status} through ${HOST_FRONT_ENV}=${frontOrigin} and ${viaBase.status} over --base-url — the declared front is not shown to serve the host under test` };
  }
  let same = false;
  try { same = canonical(JSON.parse(viaFront.text)) === canonical(JSON.parse(viaBase.text)); } catch { same = false; }
  if (!same) {
    return { ok: false, reason: `the discovery document through ${HOST_FRONT_ENV}=${frontOrigin} differs from the one over --base-url — the front does not serve the host under test, so an origin claim through it would witness some other host` };
  }
  return { ok: true, origin: frontOrigin, declared: true };
}
