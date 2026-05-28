/**
 * Channel plugin registry (A4). Each plugin wraps one platform's tooling;
 * the parsing logic lives in `normalize.ts` (unit-tested), so these modules
 * are thin spawn/socket adapters. Delivery mirrors the previously-inline
 * signal-cli / AppleScript logic; receive (B4) streams inbound back.
 *
 * Platform tooling can't run in CI, so `isAvailable` fails closed and the
 * receive loops are exercised in tests via a mock ChannelPlugin + the pure
 * normalizers — the same way you'd test this without a live account.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { ChannelAvailability, ChannelPlugin, InboundMessage, OutboundMessage, RelayChannel } from './types.js';
import { parseImessageRow, parseSignalEnvelope, parseWhatsappMessage } from './normalize.js';

const IS_DARWIN = process.platform === 'darwin';

function signalAvailable(env: NodeJS.ProcessEnv): ChannelAvailability {
  // Daemon mode: a configured signal-cli HTTP daemon makes the channel usable
  // without the local binary on PATH (it can run on another host).
  if (env.OPENWOP_SIGNAL_DAEMON_URL) {
    return { channel: 'signal', available: true, detail: `signal-cli daemon ${env.OPENWOP_SIGNAL_DAEMON_URL}` };
  }
  const probe = spawnSync('signal-cli', ['--version'], { encoding: 'utf8' });
  if (probe.status === 0) return { channel: 'signal', available: true, detail: (probe.stdout || '').trim() || 'signal-cli present' };
  return { channel: 'signal', available: false, detail: 'signal-cli not found on PATH — install from https://github.com/AsamK/signal-cli (or set OPENWOP_SIGNAL_DAEMON_URL)' };
}

/**
 * POST one JSON-RPC call to a signal-cli `daemon --http` endpoint and return
 * the parsed result. Used for daemon-mode delivery.
 */
async function signalDaemonRpc(baseUrl: string, method: string, params: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(new URL('/api/v1/rpc', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
  if (!res.ok || body.error) throw new Error(`signal-cli daemon ${method} failed: ${body.error?.message ?? `HTTP ${res.status}`}`);
  return body;
}

const signalPlugin: ChannelPlugin = {
  channel: 'signal',
  isAvailable: (env = process.env) => signalAvailable(env),
  async deliver(msg: OutboundMessage) {
    const account = process.env.OPENWOP_SIGNAL_ACCOUNT;
    const daemon = process.env.OPENWOP_SIGNAL_DAEMON_URL;
    const group = msg.conversationId.startsWith('group:') ? msg.conversationId.slice('group:'.length) : undefined;
    if (daemon) {
      // Daemon JSON-RPC `send`: recipients[] for DMs, groupId for groups.
      await signalDaemonRpc(daemon, 'send', {
        ...(account ? { account } : {}),
        ...(group ? { groupId: group } : { recipient: [msg.conversationId] }),
        message: msg.text,
      });
      return;
    }
    const args = [...(account ? ['-a', account] : []), 'send', '-m', msg.text, group ?? msg.conversationId];
    const r = spawnSync('signal-cli', args, { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`signal-cli send failed: ${(r.stderr || '').trim() || r.status}`);
  },
  async startReceive(onInbound, opts = {}) {
    const env = opts.env ?? process.env;
    const daemon = env.OPENWOP_SIGNAL_DAEMON_URL;
    const forward = async (payload: unknown) => {
      const msg = parseSignalEnvelope(payload);
      if (msg) await onInbound(msg);
    };

    // Daemon mode: stream the SSE event feed (each `data:` line is a JSON-RPC
    // `receive` notification). Robust to the daemon being unreachable — it
    // reconnects with backoff. This is the production transport; the spawn
    // loop below is the local-binary fallback.
    if (daemon) {
      const eventsPath = env.OPENWOP_SIGNAL_EVENTS_PATH || '/api/v1/events';
      let stopped = false;
      const ctrl = new AbortController();
      const run = async () => {
        while (!stopped) {
          try {
            const res = await fetch(new URL(eventsPath, daemon), {
              headers: { accept: 'text/event-stream' },
              signal: ctrl.signal,
            });
            if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buf = '';
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              buf += decoder.decode(value, { stream: true });
              // SSE frames are separated by a blank line; each carries `data:`.
              let sep: number;
              while ((sep = buf.indexOf('\n\n')) >= 0) {
                const frame = buf.slice(0, sep); buf = buf.slice(sep + 2);
                for (const line of frame.split('\n')) {
                  if (!line.startsWith('data:')) continue;
                  const data = line.slice(5).trim();
                  if (!data) continue;
                  try { await forward(JSON.parse(data)); } catch { /* skip malformed frame */ }
                }
              }
            }
          } catch {
            if (stopped) return;
          }
          if (!stopped) await new Promise((r) => setTimeout(r, 2000)); // reconnect backoff
        }
      };
      void run();
      return () => { stopped = true; ctrl.abort(); };
    }

    // Fallback: spawn `signal-cli -a <acct> receive --json` on a re-spawn loop.
    const account = env.OPENWOP_SIGNAL_ACCOUNT;
    if (!account) throw new Error('OPENWOP_SIGNAL_ACCOUNT (the registered Signal number) is required for receive, or set OPENWOP_SIGNAL_DAEMON_URL.');
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const child = spawn('signal-cli', ['-a', account, 'receive', '--json'], { stdio: ['ignore', 'pipe', 'ignore'] });
      const rl = createInterface({ input: child.stdout });
      rl.on('line', async (line) => {
        if (!line.trim()) return;
        try { await forward(JSON.parse(line)); } catch { /* skip malformed line */ }
      });
      child.on('exit', () => { if (!stopped) setTimeout(tick, 1000); });
    };
    tick();
    return () => { stopped = true; };
  },
};

const imessagePlugin: ChannelPlugin = {
  channel: 'imessage',
  isAvailable: (env = process.env) =>
    (env.OPENWOP_FORCE_PLATFORM ?? process.platform) === 'darwin'
      ? { channel: 'imessage', available: true, detail: 'macOS — needs Messages signed in + Full Disk Access for chat.db' }
      : { channel: 'imessage', available: false, detail: 'iMessage requires macOS (Messages.app + chat.db)' },
  async deliver(msg: OutboundMessage) {
    const script = `tell application "Messages" to send ${JSON.stringify(msg.text)} to buddy ${JSON.stringify(msg.conversationId.replace(/^chat:/, ''))} of (service 1 whose service type is iMessage)`;
    const r = spawnSync('osascript', ['-e', script], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`osascript send failed: ${(r.stderr || '').trim() || r.status}`);
  },
  async startReceive(onInbound, opts = {}) {
    if (!IS_DARWIN) throw new Error('iMessage receive requires macOS.');
    const { homedir } = await import('node:os');
    const dbPath = `${homedir()}/Library/Messages/chat.db`;
    let lastRowId = 0;
    let stopped = false;
    const poll = () => {
      if (stopped) return;
      // Query via the sqlite3 CLI to avoid a native dep; -json gives rows.
      // hex(attributedBody): modern macOS leaves m.text NULL and stores the body
      // in the attributedBody BLOB; hex keeps it intact through `sqlite3 -json`.
      const sql = `SELECT m.ROWID as ROWID, m.text as text, hex(m.attributedBody) as attributed_body_hex, m.is_from_me as is_from_me, m.date as date, h.id as handle_id_str FROM message m LEFT JOIN handle h ON m.handle_id = h.ROWID WHERE m.ROWID > ${lastRowId} ORDER BY m.ROWID ASC LIMIT 50;`;
      const r = spawnSync('sqlite3', ['-json', dbPath, sql], { encoding: 'utf8' });
      if (r.status === 0 && r.stdout.trim()) {
        try {
          for (const row of JSON.parse(r.stdout) as Array<Record<string, unknown>>) {
            lastRowId = Math.max(lastRowId, Number(row.ROWID) || 0);
            const msg = parseImessageRow(row);
            if (msg) void onInbound(msg);
          }
        } catch { /* skip */ }
      }
      if (!stopped) setTimeout(poll, 2000);
    };
    poll();
    return () => { stopped = true; };
  },
};

const whatsappPlugin: ChannelPlugin = {
  channel: 'whatsapp',
  isAvailable: () => ({ channel: 'whatsapp', available: false, detail: 'WhatsApp needs @whiskeysockets/baileys (optional dep) installed in the CLI build' }),
  async deliver() { throw new Error('WhatsApp delivery requires the Baileys channel build (not bundled).'); },
  async startReceive(onInbound, opts = {}) {
    // Lazy-load Baileys; absent by default (heavy optional dep).
    // Optional heavy dep — not bundled. A variable specifier keeps tsc from
    // trying to resolve the (absent) module at build time; it's `any` because
    // Baileys ships no types we depend on.
    let baileys: any;
    const baileysPkg = '@whiskeysockets/baileys';
    try { baileys = await import(baileysPkg); }
    catch { throw new Error('WhatsApp receive requires @whiskeysockets/baileys — install it in the CLI build.'); }
    const { makeWASocket, useMultiFileAuthState } = baileys;
    const { state, saveCreds } = await useMultiFileAuthState(`${process.env.HOME}/.openwop/whatsapp-auth`);
    const sock = makeWASocket({ auth: state, printQRInTerminal: true });
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('messages.upsert', async (up: any) => {
      for (const m of up.messages ?? []) {
        const msg = parseWhatsappMessage(m);
        if (msg) await onInbound(msg);
      }
    });
    return () => { try { sock.end?.(); } catch { /* ignore */ } };
  },
};

const PLUGINS: Record<RelayChannel, ChannelPlugin> = {
  signal: signalPlugin,
  imessage: imessagePlugin,
  whatsapp: whatsappPlugin,
};

export function getChannelPlugin(channel: RelayChannel): ChannelPlugin {
  const p = PLUGINS[channel];
  if (!p) throw new Error(`unknown channel: ${channel}`);
  return p;
}

export type { ChannelPlugin, InboundMessage, OutboundMessage, ChannelAvailability, RelayChannel };
