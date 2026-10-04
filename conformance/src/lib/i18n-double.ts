/**
 * A scratch double for locale negotiation at major 2 (`i18n.md`): a discovery
 * document carrying an `i18n` record and a run read that answers an error
 * envelope localized by `Accept-Language`. Each self-test in
 * `i18n-negotiation-witness.test.ts` turns on ONE defect to show the witness
 * convicts it; a standalone instance lets the scenario file run against it.
 *
 * A test double, not a host: it executes nothing, and nothing it does is
 * evidence about any implementation.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { unprojectBoundId } from './bound-id.js';

export type I18nDefect =
  | 'none' | 'malformed-400' | 'unsupported-406' | 'content-language-lies' | 'content-language-garbage'
  | 'code-localized' | 'details-keys-localized' | 'details-locale-garbage';

/** The tenant the double treats as the caller's. */
export const OWN_TENANT = 'acme';

const MESSAGES: Record<string, string> = { en: 'No such run', es: 'No existe tal ejecución', 'pt-BR': 'Execução inexistente' };

export class I18nDouble {
  defect: I18nDefect = 'none';
  url = '';
  private server: Server | undefined;
  discovery: Record<string, unknown> = { i18n: { status: 'stable', since: '2.0', witness: 'witnessable-gated', defaultLocale: 'en', supportedLocales: ['en', 'es', 'pt-BR'] } };

  async start(): Promise<string> {
    this.server = createServer((req, res) => { this.handle(req, res); });
    await new Promise<void>((r) => this.server!.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this.url;
  }
  async stop(): Promise<void> { const s = this.server; if (s) { s.closeAllConnections(); await new Promise<void>((r) => s.close(() => r())); } }
  reset(defect: I18nDefect): void { this.defect = defect; }

  private supported(): string[] { return ((this.discovery['i18n'] as { supportedLocales?: string[] } | undefined)?.supportedLocales) ?? ['en']; }

  /** RFC 9110 §12.5.4 best-effort: highest q wins, ties to order, then the language family, else the default. `null` = malformed. */
  private negotiate(header: string | undefined): { used: string; malformed: boolean; firstRaw: string | undefined } {
    if (header === undefined) return { used: 'en', malformed: false, firstRaw: undefined };
    const entries: Array<{ tag: string; q: number; i: number }> = [];
    let malformed = false;
    header.split(',').forEach((part, i) => {
      const [tag, ...params] = part.trim().split(';').map((s) => s.trim());
      if (!tag || !/^[a-zA-Z]{1,8}(-[a-zA-Z0-9]{1,8})*$|^\*$/.test(tag)) { malformed = true; return; }
      const qp = params.find((p) => p.startsWith('q='));
      const q = qp === undefined ? 1 : Number(qp.slice(2));
      if (Number.isNaN(q)) { malformed = true; return; }
      entries.push({ tag, q, i });
    });
    entries.sort((x, y) => y.q - x.q || x.i - y.i);
    const sup = this.supported();
    for (const e of entries) {
      // `*` (which Node's fetch sends by default) matches any locale: the default serves.
      if (e.tag === '*') return { used: 'en', malformed, firstRaw: undefined };
      const exact = sup.find((s) => s.toLowerCase() === e.tag.toLowerCase());
      if (exact) return { used: exact, malformed, firstRaw: header.split(',')[0]?.split(';')[0]?.trim() };
      const fam = sup.find((s) => s.toLowerCase() === (e.tag.split('-')[0] ?? '').toLowerCase());
      if (fam) return { used: fam, malformed, firstRaw: header.split(',')[0]?.split(';')[0]?.trim() };
    }
    return { used: 'en', malformed, firstRaw: header.split(',')[0]?.split(';')[0]?.trim() };
  }

  private send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    if (req.method === 'GET' && path === '/.well-known/openwop') return this.send(res, 200, this.discovery);
    const m = /^\/runs\/([^/]+)$/.exec(path);
    if (req.method !== 'GET' || !m) return this.send(res, 404, { error: 'not_found', message: `no route ${req.method} ${path}` });

    const header = req.headers['accept-language'];
    const n = this.negotiate(typeof header === 'string' ? header : undefined);
    if (n.malformed && this.defect === 'malformed-400') return this.send(res, 400, { error: 'validation_error', message: 'bad Accept-Language' });
    if (typeof header === 'string' && !n.malformed && n.firstRaw !== undefined && n.used === 'en' && !header.toLowerCase().startsWith('en') && this.defect === 'unsupported-406') {
      return this.send(res, 406, { error: 'not_acceptable', message: 'locale not supported' });
    }
    const localized = n.used !== 'en';
    let cl: string | undefined = typeof header === 'string' ? n.used : undefined;
    if (this.defect === 'content-language-lies' && n.firstRaw !== undefined) cl = n.firstRaw;
    if (this.defect === 'content-language-garbage' && cl !== undefined) cl = 'en_US!';

    let id: string;
    try { id = unprojectBoundId(m[1]!); } catch { return this.send(res, 400, { error: 'validation_error', message: 'bad id projection' }); }
    const tenant = id.includes('/') ? id.split('/')[0] : OWN_TENANT;
    const foreign = tenant !== OWN_TENANT;
    const code = this.defect === 'code-localized' && localized ? (foreign ? 'inquilino_distinto' : 'no_encontrado') : (foreign ? 'id_tenant_mismatch' : 'not_found');
    const details: Record<string, unknown> = this.defect === 'details-keys-localized' && localized ? { recurso: 'run' } : { resource: 'run' };
    if (localized) details['locale'] = this.defect === 'details-locale-garbage' ? 'spanish!' : n.used;
    return this.send(res, foreign ? 403 : 404, { error: code, message: MESSAGES[n.used] ?? MESSAGES['en'], details }, cl === undefined ? {} : { 'content-language': cl });
  }
}
