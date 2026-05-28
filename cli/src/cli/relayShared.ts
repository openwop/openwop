import type { Ctx } from '../context.js';
/** Shared constants + helpers for the messaging/relay command groups (and doctor). */
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { CliError } from '../errors.js';
import { writeLine } from '../io.js';
import { openwopHomeDir } from '../config.js';
import { getChannelPlugin } from '../channels/registry.js';
import type { OutboundMessage } from '../channels/types.js';

export const MESSAGING_BASE = '/v1/host/sample/messaging';
export const DEVICE_TOKEN_HEADER = 'x-openwop-device-token';
export const RELAY_CHANNELS = ['whatsapp', 'signal', 'imessage', 'discord'];

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
 * Detect whether a messaging channel can run on this host (used by `doctor`'s
 * relay-readiness row). Delegates to the channel plugin's own `isAvailable` so
 * there is ONE availability source — adding a channel can't leave this behind
 * (previously this switch lagged and reported a configured Discord relay as
 * "unknown channel"). Unknown channels fail closed.
 */
export function detectChannelAvailability(channel: any, env = process.env) {
  try {
    return getChannelPlugin(channel).isAvailable(env);
  } catch {
    return { channel, available: false, detail: `unknown channel: ${channel}` };
  }
}

/** Map a pulled outbound egress (envelope v2) to the plugin OutboundMessage shape. */
function egressToOutbound(egress: any): OutboundMessage {
  return {
    conversationId: egress.conversationId,
    text: egress.text ?? '',
    ...(egress.replyToMessageId ? { replyToMessageId: egress.replyToMessageId } : {}),
    ...(egress.media ? { media: egress.media } : {}),
    ...(egress.components ? { components: egress.components } : {}),
    ...(egress.reactions ? { reactions: egress.reactions } : {}),
  };
}

/**
 * Build the outbound-delivery function for a channel. Delegates to the channel
 * plugin's `deliver()` (signal-cli/daemon, Baileys, discord.js, AppleScript)
 * when the platform tooling is present; otherwise falls back to console
 * delivery so the bridge stays observable and never silently drops a message.
 * Tests inject ctx.relayDeliver to bypass this entirely.
 */
export function makeChannelDeliver(channel: any, ctx: any) {
  let plugin: ReturnType<typeof getChannelPlugin> | undefined;
  try { plugin = getChannelPlugin(channel); } catch { plugin = undefined; }
  const avail = plugin ? plugin.isAvailable(ctx.env) : { available: false, detail: `unknown channel ${channel}` };
  if (!plugin || !avail.available) {
    let warned = false;
    return async (egress: any) => {
      if (!warned) { writeLine(ctx.io.stderr, `channel ${channel} unavailable (${avail.detail}); printing instead.`); warned = true; }
      writeLine(ctx.io.stdout, `→ [${channel}] ${egress.conversationId}: ${egress.text}`);
    };
  }
  return async (egress: any) => { await plugin!.deliver(egressToOutbound(egress)); };
}
