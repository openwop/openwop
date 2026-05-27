import type { Ctx } from '../context.js';
/** Shared constants + helpers for the messaging/relay command groups (and doctor). */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CliError } from '../errors.js';
import { writeLine } from '../io.js';
import { openwopHomeDir } from '../config.js';

export const MESSAGING_BASE = '/v1/host/sample/messaging';
export const DEVICE_TOKEN_HEADER = 'x-openwop-device-token';
export const RELAY_CHANNELS = ['whatsapp', 'signal', 'imessage'];

// The relay record carries the device token — a bearer-equivalent host
// credential. It is kept OUT of config.json (which holds only non-secret
// settings + BYOK refs) and written to a dedicated 0600 file, preserving the
// CLI's "no secrets in config.json" posture (see cli/README §Config).
export function relayCredsPath(env: any) {
  return join(openwopHomeDir(env), 'relay-credentials.json');
}

export function loadRelayConfig(ctx: Ctx) {
  try {
    const p = relayCredsPath(ctx.env);
    if (existsSync(p)) return JSON.parse(readFileSync(p, 'utf8'));
  } catch { /* unreadable/corrupt → treat as unconfigured */ }
  return {};
}

export function saveRelayConfig(ctx: Ctx, relay: any) {
  const p = relayCredsPath(ctx.env);
  mkdirSync(dirname(p), { recursive: true });
  if (!relay || Object.keys(relay).length === 0) {
    try { if (existsSync(p)) rmSync(p); } catch { /* best-effort */ }
    return;
  }
  writeFileSync(p, `${JSON.stringify(relay, null, 2)}\n`, 'utf8');
  try { chmodSync(p, 0o600); } catch { /* best-effort on Windows */ }
}

export function assertRelayChannel(channel: any) {
  if (!RELAY_CHANNELS.includes(channel)) {
    throw new CliError(`--channel must be one of: ${RELAY_CHANNELS.join(', ')}`);
  }
}

export function relayPidPath(env: any) { return join(openwopHomeDir(env), 'relay.pid.json'); }
export function relayLogPath(env: any) { return join(openwopHomeDir(env), 'relay.log'); }
export function readRelayRecord(env: any) {
  try {
    const p = relayPidPath(env);
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
  } catch { return null; }
}

/**
 * Detect whether a messaging channel can run on this host. Pure-ish (only
 * probes the environment) so doctor + relay can report readiness and fail
 * closed rather than pretend a channel works. Phase 3 channel plugins reuse
 * this before attempting platform I/O.
 */
export function detectChannelAvailability(channel: any, env = process.env) {
  switch (channel) {
    case 'signal': {
      const probe = spawnSync('signal-cli', ['--version'], { encoding: 'utf8' });
      if (probe.status === 0) {
        return { channel, available: true, detail: (probe.stdout || '').trim() || 'signal-cli present' };
      }
      return { channel, available: false, detail: 'signal-cli not found on PATH — install signal-cli (https://github.com/AsamK/signal-cli)' };
    }
    case 'imessage': {
      if ((env.OPENWOP_FORCE_PLATFORM ?? process.platform) === 'darwin') {
        return { channel, available: true, detail: 'macOS detected — requires Messages signed in + Full Disk Access for chat.db' };
      }
      return { channel, available: false, detail: 'iMessage requires macOS (Messages.app + chat.db); not available on this platform' };
    }
    case 'whatsapp': {
      // Baileys is a heavy native-ish dep, not bundled in the stdlib CLI; the
      // WhatsApp plugin ships with the channel build (TS migration phase).
      return { channel, available: false, detail: 'WhatsApp requires the @openwop/cli channel build (@whiskeysockets/baileys); not bundled in the core CLI' };
    }
    default:
      return { channel, available: false, detail: `unknown channel: ${channel}` };
  }
}

/**
 * Build the outbound-delivery function for a channel. When the channel's
 * platform tooling is present, deliver natively (signal-cli / AppleScript);
 * otherwise fall back to console delivery so the bridge stays observable and
 * never silently drops a message. Tests inject ctx.relayDeliver to bypass this.
 */
export function makeChannelDeliver(channel: any, ctx: any) {
  const avail = detectChannelAvailability(channel, ctx.env);
  if (!avail.available) {
    let warned = false;
    return (egress: any) => {
      if (!warned) { writeLine(ctx.io.stderr, `channel ${channel} unavailable (${avail.detail}); printing instead.`); warned = true; }
      writeLine(ctx.io.stdout, `→ [${channel}] ${egress.conversationId}: ${egress.text}`);
    };
  }
  if (channel === 'signal') {
    return (egress: any) => {
      const r = spawnSync('signal-cli', ['send', '-m', egress.text, egress.conversationId], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`signal-cli send failed: ${(r.stderr || '').trim() || r.status}`);
    };
  }
  if (channel === 'imessage') {
    return (egress: any) => {
      const script = `tell application "Messages" to send ${JSON.stringify(egress.text)} to buddy ${JSON.stringify(egress.conversationId)} of (service 1 whose service type is iMessage)`;
      const r = spawnSync('osascript', ['-e', script], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`osascript send failed: ${(r.stderr || '').trim() || r.status}`);
    };
  }
  return (egress: any) => writeLine(ctx.io.stdout, `→ [${channel}] ${egress.conversationId}: ${egress.text}`);
}
