/**
 * Messaging relay-gateway routes (demo app only — NOT normative openwop v1).
 *
 * Vendor-prefixed under `/v1/host/sample/messaging` per `host-extensions.md`:
 * openwop is a channel-agnostic workflow protocol, so chat channels
 * (Signal / WhatsApp / iMessage) live entirely in a host-extension layer.
 * Other hosts MAY add their own under their own vendor prefix; nothing here
 * is part of the protocol wire surface.
 *
 * Architecture (distributed-relay pattern): the openwop CLI owns the
 * platform connection (signal-cli / Baileys / iMessage) and runs as a local
 * relay device. It registers once, exchanges an activation code for a
 * tenant-scoped device token, then runs two loops — heartbeat (keepalive)
 * and outbound poller (pull). Inbound platform messages are POSTed here and
 * bridged to a workflow run; outbound replies are queued per relay and
 * pulled + acked by the device.
 *
 *   Device lifecycle (operator bearer):
 *     POST   .../relay/register             — issue relayId + activation code
 *     POST   .../relay/activate             — exchange code → device token
 *     POST   .../relay/revoke               — deactivate a relay
 *   Device loop (x-openwop-device-token; bearer-public per auth allowlist):
 *     POST   .../device/heartbeat           — keepalive + status report
 *     POST   .../device/inbound             — ingest a platform message
 *     GET    .../device/outbound            — pull pending egress for this relay
 *     POST   .../device/ack                 — acknowledge delivered egress
 *   Outbound enqueue (operator bearer / bridge):
 *     POST   .../relay/enqueue              — queue an egress for a relay
 *   Connectors (operator bearer):
 *     GET    .../connectors                 — list
 *     POST   .../connectors                 — upsert
 *     GET    .../connectors/:id             — get
 *     POST   .../connectors/:id/enable      — enable
 *     POST   .../connectors/:id/disable     — disable
 *     POST   .../connectors/:id/test        — synthetic delivery probe
 *   Sessions (operator bearer):
 *     GET    .../sessions                   — list
 *     GET    .../sessions/:key              — inspect
 *     DELETE .../sessions/:key              — close + delete
 *
 * State is module-scoped and in-process (demo-grade, non-durable) — the same
 * posture as the test-seam routes. Consequences a real host MUST address by
 * backing this with `Storage`: device tokens + outbound queues + sessions are
 * lost on restart (devices must re-`activate`), and the state is shared across
 * `createApp` instances in one process. `resetMessagingState()` clears it
 * between tests.
 */

import { randomUUID } from 'node:crypto';
import type { Express, Request } from 'express';
import { OpenwopError } from '../types.js';

const BASE = '/v1/host/sample/messaging';

const RELAY_CHANNELS = ['whatsapp', 'signal', 'imessage'] as const;
export type RelayChannel = (typeof RELAY_CHANNELS)[number];

const DEVICE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ACTIVATION_TTL_MS = 10 * 60 * 1000; // 10 minutes
const HEARTBEAT_INTERVAL_SECONDS = 30;
const OUTBOUND_POLL_INTERVAL_SECONDS = 5;

/** Canonical inbound envelope (platform → host). Demo-app shape, not wire spec. */
export interface ChatIngressEnvelope {
  channel: RelayChannel;
  platformMessageId: string;
  conversationId: string;
  peerId: string;
  peerDisplay?: string;
  text: string;
  media?: ReadonlyArray<{ url: string; mimeType?: string }>;
  timestamp: string;
}

/** Canonical outbound envelope (host → platform). */
export interface ChatEgressEnvelope {
  egressId: string;
  relayId: string;
  channel: RelayChannel;
  conversationId: string;
  text: string;
  media?: ReadonlyArray<{ url: string; mimeType?: string }>;
  replyToMessageId?: string;
  enqueuedAt: string;
}

interface RelayDevice {
  relayId: string;
  tenantId: string;
  channel: RelayChannel;
  deviceName?: string;
  status: 'registered' | 'active' | 'revoked';
  deviceToken?: string;
  tokenExpiresAt?: string;
  activationCode?: string;
  activationExpiresAt?: string;
  registeredAt: string;
  lastHeartbeatAt?: string;
  lastReportedStatus?: string;
}

interface Connector {
  connectorId: string;
  tenantId: string;
  channel: RelayChannel;
  displayName: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface MessagingSession {
  sessionKey: string;
  tenantId: string;
  channel: RelayChannel;
  conversationId: string;
  peerId: string;
  peerDisplay?: string;
  lastInboundAt: string;
  messageCount: number;
  lastRunId?: string;
}

/**
 * The inbound → run bridge seam. Injected from index.ts where the run
 * pipeline (storage + hostSuite) is available. When absent, inbound
 * messages are recorded but no run is created (transport-only mode).
 */
export interface MessagingBridge {
  onInbound(params: {
    device: { relayId: string; tenantId: string; channel: RelayChannel };
    envelope: ChatIngressEnvelope;
    sessionKey: string;
  }): Promise<{ runId?: string } | void>;
}

interface MessagingState {
  devices: Map<string, RelayDevice>;
  tokens: Map<string, string>; // deviceToken → relayId
  outbound: Map<string, ChatEgressEnvelope[]>; // relayId → queue
  connectors: Map<string, Connector>;
  sessions: Map<string, MessagingSession>;
}

const state: MessagingState = {
  devices: new Map(),
  tokens: new Map(),
  outbound: new Map(),
  connectors: new Map(),
  sessions: new Map(),
};

/** Test helper — clears all relay state. */
export function resetMessagingState(): void {
  state.devices.clear();
  state.tokens.clear();
  state.outbound.clear();
  state.connectors.clear();
  state.sessions.clear();
}

interface Deps {
  bridge?: MessagingBridge;
}

export function registerMessagingRoutes(app: Express, deps: Deps = {}): void {
  const { bridge } = deps;

  // ---- Device lifecycle (operator bearer) ----

  app.post(`${BASE}/relay/register`, (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const channel = assertChannel((req.body ?? {}).channel);
      const deviceName = optionalString((req.body ?? {}).deviceName);
      const now = Date.now();
      const device: RelayDevice = {
        relayId: `relay_${randomUUID()}`,
        tenantId,
        channel,
        ...(deviceName ? { deviceName } : {}),
        status: 'registered',
        activationCode: randomUUID().replace(/-/g, '').slice(0, 12),
        activationExpiresAt: new Date(now + ACTIVATION_TTL_MS).toISOString(),
        registeredAt: new Date(now).toISOString(),
      };
      state.devices.set(device.relayId, device);
      res.status(201).json({
        relayId: device.relayId,
        channel: device.channel,
        activationCode: device.activationCode,
        activationExpiresAt: device.activationExpiresAt,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post(`${BASE}/relay/activate`, (req, res, next) => {
    try {
      const body = req.body ?? {};
      const relayId = requireString(body.relayId, 'relayId');
      const activationCode = requireString(body.activationCode, 'activationCode');
      const device = state.devices.get(relayId);
      if (!device || device.status === 'revoked') {
        throw new OpenwopError('not_found', 'relay not found', 404);
      }
      if (
        device.activationCode !== activationCode ||
        !device.activationExpiresAt ||
        Date.parse(device.activationExpiresAt) < Date.now()
      ) {
        throw new OpenwopError('invalid_request', 'activation code invalid or expired', 400);
      }
      const deviceToken = `dtok_${randomUUID().replace(/-/g, '')}`;
      const tokenExpiresAt = new Date(Date.now() + DEVICE_TOKEN_TTL_MS).toISOString();
      device.status = 'active';
      device.deviceToken = deviceToken;
      device.tokenExpiresAt = tokenExpiresAt;
      delete device.activationCode;
      delete device.activationExpiresAt;
      state.tokens.set(deviceToken, relayId);
      if (!state.outbound.has(relayId)) state.outbound.set(relayId, []);
      res.json({
        relayId,
        channel: device.channel,
        deviceToken,
        tokenExpiresAt,
        heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS,
        outboundPollIntervalSeconds: OUTBOUND_POLL_INTERVAL_SECONDS,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post(`${BASE}/relay/revoke`, (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const relayId = requireString((req.body ?? {}).relayId, 'relayId');
      const device = state.devices.get(relayId);
      if (!device || (device.tenantId !== tenantId && !isWildcard(req))) {
        throw new OpenwopError('not_found', 'relay not found', 404);
      }
      if (device.deviceToken) state.tokens.delete(device.deviceToken);
      device.status = 'revoked';
      delete device.deviceToken;
      delete device.tokenExpiresAt;
      state.outbound.delete(relayId);
      res.json({ relayId, revoked: true });
    } catch (err) {
      next(err);
    }
  });

  // ---- Device loop (x-openwop-device-token; bearer-public per allowlist) ----
  // Grouped under `${BASE}/device/` so the device token is the sole
  // credential — same pattern as token-authed /v1/interrupts and
  // /v1/host/sample/assets (see PUBLIC_PATH_PREFIXES in middleware/auth.ts).

  app.post(`${BASE}/device/heartbeat`, (req, res, next) => {
    try {
      const device = requireDevice(req);
      device.lastHeartbeatAt = new Date().toISOString();
      const reported = optionalString((req.body ?? {}).status);
      if (reported) device.lastReportedStatus = reported;
      res.json({
        ok: true,
        serverTime: new Date().toISOString(),
        heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS,
        outboundPollIntervalSeconds: OUTBOUND_POLL_INTERVAL_SECONDS,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post(`${BASE}/device/inbound`, async (req, res, next) => {
    try {
      const device = requireDevice(req);
      const envelope = parseIngress(req.body, device.channel);
      const sessionKey = `${device.channel}:${envelope.conversationId}`;
      const existing = state.sessions.get(sessionKey);
      const session: MessagingSession = {
        sessionKey,
        tenantId: device.tenantId,
        channel: device.channel,
        conversationId: envelope.conversationId,
        peerId: envelope.peerId,
        ...(envelope.peerDisplay ? { peerDisplay: envelope.peerDisplay } : {}),
        lastInboundAt: envelope.timestamp,
        messageCount: (existing?.messageCount ?? 0) + 1,
        ...(existing?.lastRunId ? { lastRunId: existing.lastRunId } : {}),
      };
      state.sessions.set(sessionKey, session);

      let runId: string | undefined;
      if (bridge) {
        const result = await bridge.onInbound({
          device: { relayId: device.relayId, tenantId: device.tenantId, channel: device.channel },
          envelope,
          sessionKey,
        });
        if (result && result.runId) {
          runId = result.runId;
          session.lastRunId = runId;
        }
      }
      res.status(202).json({ accepted: true, sessionKey, ...(runId ? { runId } : {}) });
    } catch (err) {
      next(err);
    }
  });

  app.get(`${BASE}/device/outbound`, (req, res, next) => {
    try {
      const device = requireDevice(req);
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const queue = state.outbound.get(device.relayId) ?? [];
      res.json({ relayId: device.relayId, messages: queue.slice(0, limit) });
    } catch (err) {
      next(err);
    }
  });

  app.post(`${BASE}/device/ack`, (req, res, next) => {
    try {
      const device = requireDevice(req);
      const egressIds = (req.body ?? {}).egressIds;
      if (!Array.isArray(egressIds)) {
        throw new OpenwopError('invalid_request', 'egressIds[] is required', 400);
      }
      const ackSet = new Set(egressIds.map(String));
      const queue = state.outbound.get(device.relayId) ?? [];
      const remaining = queue.filter((m) => !ackSet.has(m.egressId));
      const acked = queue.length - remaining.length;
      state.outbound.set(device.relayId, remaining);
      res.json({ acked });
    } catch (err) {
      next(err);
    }
  });

  // ---- Outbound enqueue (operator bearer / inbound bridge) ----

  app.post(`${BASE}/relay/enqueue`, (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const body = req.body ?? {};
      const relayId = requireString(body.relayId, 'relayId');
      const device = state.devices.get(relayId);
      if (!device || (device.tenantId !== tenantId && !isWildcard(req))) {
        throw new OpenwopError('not_found', 'relay not found', 404);
      }
      const egress = enqueueOutbound(relayId, {
        channel: device.channel,
        conversationId: requireString(body.conversationId, 'conversationId'),
        text: requireString(body.text, 'text'),
        ...(optionalString(body.replyToMessageId) ? { replyToMessageId: String(body.replyToMessageId) } : {}),
      });
      res.status(201).json(egress);
    } catch (err) {
      next(err);
    }
  });

  // ---- Connectors (operator bearer) ----

  app.get(`${BASE}/connectors`, (req, res, next) => {
    try {
      const connectors = filterByTenant(req, [...state.connectors.values()]);
      res.json({ connectors });
    } catch (err) {
      next(err);
    }
  });

  app.post(`${BASE}/connectors`, (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const body = req.body ?? {};
      const channel = assertChannel(body.channel);
      const connectorId = optionalString(body.connectorId) ?? `conn_${channel}_${tenantId}`;
      const now = new Date().toISOString();
      const existing = state.connectors.get(connectorId);
      const connector: Connector = {
        connectorId,
        tenantId,
        channel,
        displayName: optionalString(body.displayName) ?? channel,
        enabled: typeof body.enabled === 'boolean' ? body.enabled : (existing?.enabled ?? false),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      state.connectors.set(connectorId, connector);
      res.status(existing ? 200 : 201).json(connector);
    } catch (err) {
      next(err);
    }
  });

  app.get(`${BASE}/connectors/:id`, (req, res, next) => {
    try {
      res.json(getConnectorOr404(req));
    } catch (err) {
      next(err);
    }
  });

  app.post(`${BASE}/connectors/:id/enable`, (req, res, next) => {
    try {
      const c = getConnectorOr404(req);
      c.enabled = true;
      c.updatedAt = new Date().toISOString();
      res.json(c);
    } catch (err) {
      next(err);
    }
  });

  app.post(`${BASE}/connectors/:id/disable`, (req, res, next) => {
    try {
      const c = getConnectorOr404(req);
      c.enabled = false;
      c.updatedAt = new Date().toISOString();
      res.json(c);
    } catch (err) {
      next(err);
    }
  });

  app.post(`${BASE}/connectors/:id/test`, (req, res, next) => {
    try {
      const c = getConnectorOr404(req);
      // Synthetic probe — a real connector would round-trip the platform.
      res.json({
        connectorId: c.connectorId,
        channel: c.channel,
        enabled: c.enabled,
        ok: c.enabled,
        detail: c.enabled ? 'connector enabled; synthetic probe ok' : 'connector disabled',
        probedAt: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });

  // ---- Sessions (operator bearer) ----

  app.get(`${BASE}/sessions`, (req, res, next) => {
    try {
      const sessions = filterByTenant(req, [...state.sessions.values()]);
      res.json({ sessions });
    } catch (err) {
      next(err);
    }
  });

  app.get(`${BASE}/sessions/:key`, (req, res, next) => {
    try {
      res.json(getSessionOr404(req));
    } catch (err) {
      next(err);
    }
  });

  app.delete(`${BASE}/sessions/:key`, (req, res, next) => {
    try {
      const s = getSessionOr404(req);
      state.sessions.delete(s.sessionKey);
      res.json({ sessionKey: s.sessionKey, deleted: true });
    } catch (err) {
      next(err);
    }
  });
}

/** Enqueue an outbound egress for a relay. Used by /relay/enqueue and the bridge. */
export function enqueueOutbound(
  relayId: string,
  fields: { channel: RelayChannel; conversationId: string; text: string; replyToMessageId?: string },
): ChatEgressEnvelope {
  const egress: ChatEgressEnvelope = {
    egressId: `egr_${randomUUID()}`,
    relayId,
    channel: fields.channel,
    conversationId: fields.conversationId,
    text: fields.text,
    ...(fields.replyToMessageId ? { replyToMessageId: fields.replyToMessageId } : {}),
    enqueuedAt: new Date().toISOString(),
  };
  const queue = state.outbound.get(relayId) ?? [];
  queue.push(egress);
  state.outbound.set(relayId, queue);
  return egress;
}

// ---- helpers ----

function isWildcard(req: Request): boolean {
  return (req.principal?.tenants ?? []).includes('*');
}

function resolveTenant(req: Request): string {
  if (isWildcard(req)) {
    return typeof req.query.tenantId === 'string' && req.query.tenantId.length > 0
      ? req.query.tenantId
      : (typeof (req.body ?? {}).tenantId === 'string' && req.body.tenantId.length > 0 ? req.body.tenantId : 'default');
  }
  return req.tenantId ?? 'default';
}

function filterByTenant<T extends { tenantId: string }>(req: Request, rows: T[]): T[] {
  if (isWildcard(req)) {
    const requested = typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined;
    return requested ? rows.filter((r) => r.tenantId === requested) : rows;
  }
  const tenantId = req.tenantId;
  return rows.filter((r) => r.tenantId === tenantId);
}

function requireDevice(req: Request): RelayDevice {
  const token = req.header('x-openwop-device-token');
  if (!token) throw new OpenwopError('unauthenticated', 'x-openwop-device-token header required', 401);
  const relayId = state.tokens.get(token);
  const device = relayId ? state.devices.get(relayId) : undefined;
  if (!device || device.status !== 'active' || device.deviceToken !== token) {
    throw new OpenwopError('unauthenticated', 'invalid or revoked device token', 401);
  }
  if (device.tokenExpiresAt && Date.parse(device.tokenExpiresAt) < Date.now()) {
    throw new OpenwopError('unauthenticated', 'device token expired', 401);
  }
  return device;
}

function getConnectorOr404(req: Request): Connector {
  const c = state.connectors.get(req.params.id);
  if (!c) throw new OpenwopError('not_found', 'connector not found', 404);
  if (c.tenantId !== resolveTenant(req) && !isWildcard(req)) {
    throw new OpenwopError('not_found', 'connector not found', 404);
  }
  return c;
}

function getSessionOr404(req: Request): MessagingSession {
  const s = state.sessions.get(req.params.key);
  if (!s) throw new OpenwopError('not_found', 'session not found', 404);
  if (s.tenantId !== resolveTenant(req) && !isWildcard(req)) {
    throw new OpenwopError('not_found', 'session not found', 404);
  }
  return s;
}

function assertChannel(raw: unknown): RelayChannel {
  if (typeof raw === 'string' && (RELAY_CHANNELS as readonly string[]).includes(raw)) {
    return raw as RelayChannel;
  }
  throw new OpenwopError('invalid_request', `channel must be one of ${RELAY_CHANNELS.join(', ')}`, 400, {
    allowed: RELAY_CHANNELS,
  });
}

function parseIngress(raw: unknown, channel: RelayChannel): ChatIngressEnvelope {
  const body = (raw ?? {}) as Record<string, unknown>;
  const envelope: ChatIngressEnvelope = {
    channel,
    platformMessageId: requireString(body.platformMessageId, 'platformMessageId'),
    conversationId: requireString(body.conversationId, 'conversationId'),
    peerId: requireString(body.peerId, 'peerId'),
    ...(optionalString(body.peerDisplay) ? { peerDisplay: String(body.peerDisplay) } : {}),
    text: typeof body.text === 'string' ? body.text : '',
    timestamp: optionalString(body.timestamp) ?? new Date().toISOString(),
  };
  if (Array.isArray(body.media)) {
    envelope.media = body.media
      .filter((m): m is { url: string; mimeType?: string } => !!m && typeof (m as { url?: unknown }).url === 'string')
      .map((m) => ({ url: m.url, ...(m.mimeType ? { mimeType: m.mimeType } : {}) }));
  }
  return envelope;
}

function requireString(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new OpenwopError('invalid_request', `${field} is required`, 400);
  }
  return raw;
}

function optionalString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}
