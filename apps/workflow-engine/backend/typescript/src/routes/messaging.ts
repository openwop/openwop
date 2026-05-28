/**
 * Messaging relay-gateway routes (demo app only — NOT normative openwop v1).
 *
 * Vendor-prefixed under `/v1/host/sample/messaging` per `host-extensions.md`:
 * openwop is a channel-agnostic workflow protocol, so chat channels
 * (Signal / WhatsApp / iMessage) live entirely in a host-extension layer.
 * Other hosts MAY add their own under their own vendor prefix; nothing here
 * is part of the protocol wire surface.
 *
 * Architecture (distributed-relay pattern): the openwop CLI owns the platform
 * connection and runs as a local relay device. It registers once, exchanges
 * an activation code for a device token, then heartbeats + pulls outbound.
 * Inbound platform messages are POSTed here and bridged to a workflow run;
 * outbound replies are queued per relay and pulled + acked by the device.
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
 *   Connectors (operator bearer):  GET|POST .../connectors[/:id[/enable|disable|test]]
 *   Sessions (operator bearer):    GET .../sessions[/:key]; DELETE .../sessions/:key
 *
 * State is durable in `Storage` (relay_devices / relay_outbound /
 * messaging_connectors / messaging_sessions across sqlite + postgres) so the
 * gateway is correct across a multi-instance / restarting host. Device tokens
 * are persisted as a SHA-256 hash only; the plaintext is returned once at
 * activation. Tenant scope follows the same wildcard/`?tenantId` rules as the
 * notification routes.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { Express, Request } from 'express';
import { OpenwopError } from '../types.js';
import type { Storage } from '../storage/storage.js';
import {
  RELAY_CHANNELS,
  type ChatEgressEnvelope,
  type ChatIngressEnvelope,
  type DmPolicy,
  type GroupPolicy,
  type MessagingBridge,
  type MessagingIdentityRecord,
  type MessagingPolicyRecord,
  type MessagingRoutingRuleRecord,
  type RelayChannel,
  type RelayDeviceRecord,
} from '../messaging/types.js';

const DM_POLICIES: readonly DmPolicy[] = ['pairing', 'allowlist', 'open', 'disabled'];
const GROUP_POLICIES: readonly GroupPolicy[] = ['allowlist', 'open', 'disabled'];
const NOTIFY_KINDS = ['email', 'sms'] as const;
type NotifyKind = (typeof NOTIFY_KINDS)[number];

const BASE = '/v1/host/sample/messaging';

const DEVICE_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ACTIVATION_TTL_MS = 10 * 60 * 1000; // 10 minutes
const HEARTBEAT_INTERVAL_SECONDS = 30;
const OUTBOUND_POLL_INTERVAL_SECONDS = 5;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

interface Deps {
  storage: Storage;
  bridge?: MessagingBridge;
}

export function registerMessagingRoutes(app: Express, deps: Deps): void {
  const { storage, bridge } = deps;

  // ---- Device lifecycle (operator bearer) ----

  app.post(`${BASE}/relay/register`, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const channel = assertChannel((req.body ?? {}).channel);
      const deviceName = optionalString((req.body ?? {}).deviceName);
      const now = Date.now();
      const activationCode = randomUUID().replace(/-/g, '').slice(0, 12);
      const record: RelayDeviceRecord = {
        relayId: `relay_${randomUUID()}`,
        tenantId,
        channel,
        ...(deviceName ? { deviceName } : {}),
        status: 'registered',
        activationCode,
        activationExpiresAt: new Date(now + ACTIVATION_TTL_MS).toISOString(),
        registeredAt: new Date(now).toISOString(),
      };
      await storage.upsertRelayDevice(record);
      res.status(201).json({
        relayId: record.relayId,
        channel: record.channel,
        activationCode,
        activationExpiresAt: record.activationExpiresAt,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post(`${BASE}/relay/activate`, async (req, res, next) => {
    try {
      const body = req.body ?? {};
      const relayId = requireString(body.relayId, 'relayId');
      const activationCode = requireString(body.activationCode, 'activationCode');
      const device = await storage.getRelayDevice(relayId);
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
      const updated: RelayDeviceRecord = {
        ...device,
        status: 'active',
        deviceTokenHash: hashToken(deviceToken),
        tokenExpiresAt,
      };
      delete updated.activationCode;
      delete updated.activationExpiresAt;
      await storage.upsertRelayDevice(updated);
      res.json({
        relayId,
        channel: device.channel,
        deviceToken, // returned once; only the hash is persisted
        tokenExpiresAt,
        heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS,
        outboundPollIntervalSeconds: OUTBOUND_POLL_INTERVAL_SECONDS,
      });
    } catch (err) {
      next(err);
    }
  });

  app.post(`${BASE}/relay/revoke`, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const relayId = requireString((req.body ?? {}).relayId, 'relayId');
      const device = await storage.getRelayDevice(relayId);
      if (!device || (device.tenantId !== tenantId && !isWildcard(req))) {
        throw new OpenwopError('not_found', 'relay not found', 404);
      }
      const revoked: RelayDeviceRecord = { ...device, status: 'revoked' };
      delete revoked.deviceTokenHash;
      delete revoked.tokenExpiresAt;
      await storage.upsertRelayDevice(revoked);
      await storage.deleteRelayOutbound(relayId);
      res.json({ relayId, revoked: true });
    } catch (err) {
      next(err);
    }
  });

  // ---- Device loop (x-openwop-device-token; bearer-public per auth allowlist) ----

  app.post(`${BASE}/device/heartbeat`, async (req, res, next) => {
    try {
      const device = await requireDevice(req, storage);
      const reported = optionalString((req.body ?? {}).status);
      await storage.upsertRelayDevice({
        ...device,
        lastHeartbeatAt: new Date().toISOString(),
        ...(reported ? { lastReportedStatus: reported } : {}),
      });
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
      const device = await requireDevice(req, storage);
      const envelope = parseIngress(req.body, device.channel);
      const sessionKey = `${device.channel}:${envelope.conversationId}`;
      const existing = await storage.getMessagingSession(sessionKey);
      await storage.upsertMessagingSession({
        sessionKey,
        tenantId: device.tenantId,
        channel: device.channel,
        conversationId: envelope.conversationId,
        peerId: envelope.peerId,
        ...(envelope.peerDisplay ? { peerDisplay: envelope.peerDisplay } : {}),
        lastInboundAt: envelope.timestamp,
        messageCount: (existing?.messageCount ?? 0) + 1,
        ...(existing?.lastRunId ? { lastRunId: existing.lastRunId } : {}),
      });

      let runId: string | undefined;
      if (bridge) {
        const result = await bridge.onInbound({
          device: { relayId: device.relayId, tenantId: device.tenantId, channel: device.channel },
          envelope,
          sessionKey,
        });
        if (result && result.runId) {
          runId = result.runId;
          const s = await storage.getMessagingSession(sessionKey);
          if (s) await storage.upsertMessagingSession({ ...s, lastRunId: runId });
        }
      }
      await storage.appendDeliveryLog({
        logId: `dlv_${randomUUID()}`,
        tenantId: device.tenantId,
        relayId: device.relayId,
        channel: device.channel,
        direction: 'inbound',
        conversationId: envelope.conversationId,
        status: runId ? 'bridged' : 'ingested',
        ...(runId ? { detail: `run ${runId}` } : {}),
        at: new Date().toISOString(),
      });
      res.status(202).json({ accepted: true, sessionKey, ...(runId ? { runId } : {}) });
    } catch (err) {
      next(err);
    }
  });

  app.get(`${BASE}/device/outbound`, async (req, res, next) => {
    try {
      const device = await requireDevice(req, storage);
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const messages = await storage.listRelayOutbound(device.relayId, limit);
      res.json({ relayId: device.relayId, messages });
    } catch (err) {
      next(err);
    }
  });

  app.post(`${BASE}/device/ack`, async (req, res, next) => {
    try {
      const device = await requireDevice(req, storage);
      const egressIds = (req.body ?? {}).egressIds;
      if (!Array.isArray(egressIds)) {
        throw new OpenwopError('invalid_request', 'egressIds[] is required', 400);
      }
      const acked = await storage.ackRelayOutbound(device.relayId, egressIds.map(String));
      res.json({ acked });
    } catch (err) {
      next(err);
    }
  });

  // ---- Outbound enqueue (operator bearer / inbound bridge) ----

  app.post(`${BASE}/relay/enqueue`, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const body = req.body ?? {};
      const relayId = requireString(body.relayId, 'relayId');
      const device = await storage.getRelayDevice(relayId);
      if (!device || (device.tenantId !== tenantId && !isWildcard(req))) {
        throw new OpenwopError('not_found', 'relay not found', 404);
      }
      const egress = await enqueueOutbound(storage, relayId, {
        channel: device.channel,
        conversationId: requireString(body.conversationId, 'conversationId'),
        text: requireString(body.text, 'text'),
        ...(optionalString(body.replyToMessageId) ? { replyToMessageId: String(body.replyToMessageId) } : {}),
        ...parseEgressExtras(body),
      });
      res.status(201).json(egress);
    } catch (err) {
      next(err);
    }
  });

  // ---- Connectors (operator bearer) ----

  app.get(`${BASE}/connectors`, async (req, res, next) => {
    try {
      const connectors = await storage.listMessagingConnectors(listTenantFilter(req));
      res.json({ connectors });
    } catch (err) {
      next(err);
    }
  });

  app.post(`${BASE}/connectors`, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const body = req.body ?? {};
      const channel = assertChannel(body.channel);
      const connectorId = optionalString(body.connectorId) ?? `conn_${channel}_${tenantId}`;
      const now = new Date().toISOString();
      const existing = await storage.getMessagingConnector(connectorId);
      const connector = {
        connectorId,
        tenantId,
        channel,
        displayName: optionalString(body.displayName) ?? channel,
        enabled: typeof body.enabled === 'boolean' ? body.enabled : (existing?.enabled ?? false),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await storage.upsertMessagingConnector(connector);
      res.status(existing ? 200 : 201).json(connector);
    } catch (err) {
      next(err);
    }
  });

  app.get(`${BASE}/connectors/:id`, async (req, res, next) => {
    try {
      res.json(await getConnectorOr404(req, storage));
    } catch (err) {
      next(err);
    }
  });

  app.post(`${BASE}/connectors/:id/enable`, async (req, res, next) => {
    try {
      const c = await getConnectorOr404(req, storage);
      const updated = { ...c, enabled: true, updatedAt: new Date().toISOString() };
      await storage.upsertMessagingConnector(updated);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.post(`${BASE}/connectors/:id/disable`, async (req, res, next) => {
    try {
      const c = await getConnectorOr404(req, storage);
      const updated = { ...c, enabled: false, updatedAt: new Date().toISOString() };
      await storage.upsertMessagingConnector(updated);
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  app.post(`${BASE}/connectors/:id/test`, async (req, res, next) => {
    try {
      const c = await getConnectorOr404(req, storage);
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

  app.get(`${BASE}/sessions`, async (req, res, next) => {
    try {
      const sessions = await storage.listMessagingSessions(listTenantFilter(req));
      res.json({ sessions });
    } catch (err) {
      next(err);
    }
  });

  app.get(`${BASE}/sessions/:key`, async (req, res, next) => {
    try {
      res.json(await getSessionOr404(req, storage));
    } catch (err) {
      next(err);
    }
  });

  app.delete(`${BASE}/sessions/:key`, async (req, res, next) => {
    try {
      const s = await getSessionOr404(req, storage);
      await storage.deleteMessagingSession(s.sessionKey);
      res.json({ sessionKey: s.sessionKey, deleted: true });
    } catch (err) {
      next(err);
    }
  });

  // ---- Access policy (operator bearer) ----
  // Who may DM / activate in groups, per connector. Absent = host default
  // (DM pairing required, groups allowlist-only, mention required).

  app.get(`${BASE}/connectors/:id/policy`, async (req, res, next) => {
    try {
      const c = await getConnectorOr404(req, storage);
      const policy = (await storage.getMessagingPolicy(c.connectorId)) ?? defaultPolicy(c.connectorId, c.tenantId);
      res.json(policy);
    } catch (err) {
      next(err);
    }
  });

  app.put(`${BASE}/connectors/:id/policy`, async (req, res, next) => {
    try {
      const c = await getConnectorOr404(req, storage);
      const body = req.body ?? {};
      const existing = await storage.getMessagingPolicy(c.connectorId);
      const base = existing ?? defaultPolicy(c.connectorId, c.tenantId);
      const policy: MessagingPolicyRecord = {
        connectorId: c.connectorId,
        tenantId: c.tenantId,
        dmPolicy: body.dmPolicy === undefined ? base.dmPolicy : assertDmPolicy(body.dmPolicy),
        groupPolicy: body.groupPolicy === undefined ? base.groupPolicy : assertGroupPolicy(body.groupPolicy),
        requireMention: typeof body.requireMention === 'boolean' ? body.requireMention : base.requireMention,
        updatedAt: new Date().toISOString(),
      };
      await storage.upsertMessagingPolicy(policy);
      res.json(policy);
    } catch (err) {
      next(err);
    }
  });

  // ---- Routing rules (operator bearer) ----
  // Map an inbound match (channel + substring pattern) → a bound workflow.
  // Higher priority wins; '*' pattern matches any conversation/peer.

  app.get(`${BASE}/routing`, async (req, res, next) => {
    try {
      const rules = await storage.listMessagingRoutingRules(listTenantFilter(req));
      res.json({ rules });
    } catch (err) {
      next(err);
    }
  });

  app.post(`${BASE}/routing`, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const body = req.body ?? {};
      const rule: MessagingRoutingRuleRecord = {
        ruleId: optionalString(body.ruleId) ?? `route_${randomUUID()}`,
        tenantId,
        ...(body.channel === undefined ? {} : { channel: assertChannel(body.channel) }),
        pattern: requireString(body.pattern, 'pattern'),
        workflowId: requireString(body.workflowId, 'workflowId'),
        priority: typeof body.priority === 'number' ? body.priority : 0,
        createdAt: new Date().toISOString(),
      };
      await storage.upsertMessagingRoutingRule(rule);
      res.status(201).json(rule);
    } catch (err) {
      next(err);
    }
  });

  app.delete(`${BASE}/routing/:ruleId`, async (req, res, next) => {
    try {
      // Scope the delete to the caller's tenant unless wildcard.
      const found = await getRoutingRuleOr404(req, storage);
      await storage.deleteMessagingRoutingRule(found.ruleId);
      res.json({ ruleId: found.ruleId, deleted: true });
    } catch (err) {
      next(err);
    }
  });

  // ---- Cross-channel identities (operator bearer) ----
  // Link platform peers across channels to one logical person.

  app.get(`${BASE}/identities`, async (req, res, next) => {
    try {
      const identities = await storage.listMessagingIdentities(listTenantFilter(req));
      res.json({ identities });
    } catch (err) {
      next(err);
    }
  });

  app.post(`${BASE}/identities`, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const body = req.body ?? {};
      const identityId = optionalString(body.identityId);
      const peers = parsePeers(body.peers);
      const now = new Date().toISOString();
      if (identityId) {
        // Link mode: merge peers into an existing identity.
        const existing = await storage.getMessagingIdentity(identityId);
        if (!existing || (existing.tenantId !== tenantId && !isWildcard(req))) {
          throw new OpenwopError('not_found', 'identity not found', 404);
        }
        const merged = mergePeers(existing.peers, peers);
        const updated: MessagingIdentityRecord = {
          ...existing,
          ...(optionalString(body.displayName) ? { displayName: String(body.displayName) } : {}),
          peers: merged,
          updatedAt: now,
        };
        await storage.upsertMessagingIdentity(updated);
        res.json(updated);
        return;
      }
      const identity: MessagingIdentityRecord = {
        identityId: `idn_${randomUUID()}`,
        tenantId,
        ...(optionalString(body.displayName) ? { displayName: String(body.displayName) } : {}),
        peers,
        createdAt: now,
        updatedAt: now,
      };
      await storage.upsertMessagingIdentity(identity);
      res.status(201).json(identity);
    } catch (err) {
      next(err);
    }
  });

  app.get(`${BASE}/identities/:id`, async (req, res, next) => {
    try {
      res.json(await getIdentityOr404(req, storage));
    } catch (err) {
      next(err);
    }
  });

  // Unlink a single peer (?channel=&peerId=) or delete the whole identity.
  app.delete(`${BASE}/identities/:id`, async (req, res, next) => {
    try {
      const identity = await getIdentityOr404(req, storage);
      const channel = optionalString(req.query.channel);
      const peerId = optionalString(req.query.peerId);
      if (channel && peerId) {
        const peers = identity.peers.filter((p) => !(p.channel === channel && p.peerId === peerId));
        const updated: MessagingIdentityRecord = { ...identity, peers, updatedAt: new Date().toISOString() };
        await storage.upsertMessagingIdentity(updated);
        res.json(updated);
        return;
      }
      await storage.deleteMessagingIdentity(identity.identityId);
      res.json({ identityId: identity.identityId, deleted: true });
    } catch (err) {
      next(err);
    }
  });

  // ---- Delivery log (operator bearer) ----

  app.get(`${BASE}/logs`, async (req, res, next) => {
    try {
      const filter: Parameters<Storage['listDeliveryLog']>[0] = {
        tenantId: listTenantFilter(req),
        ...(optionalString(req.query.channel) ? { channel: assertChannel(req.query.channel) } : {}),
        ...(optionalString(req.query.direction) ? { direction: assertDirection(req.query.direction) } : {}),
        ...(optionalString(req.query.status) ? { status: String(req.query.status) } : {}),
        ...(optionalString(req.query.limit) ? { limit: clampLimit(req.query.limit) } : {}),
      };
      const entries = await storage.listDeliveryLog(filter);
      res.json({ entries });
    } catch (err) {
      next(err);
    }
  });

  // ---- One-off notifications (operator bearer) ----
  // Demo stub: email / SMS dispatch. Returns a synthetic receipt — wiring an
  // actual provider (SES / Twilio) is a host concern, intentionally out of
  // scope for the reference app.

  app.post(`${BASE}/notify`, async (req, res, next) => {
    try {
      const tenantId = resolveTenant(req);
      const body = req.body ?? {};
      const kind = assertNotifyKind(body.kind);
      const to = requireString(body.to, 'to');
      const text = requireString(body.text, 'text');
      res.status(202).json({
        notifyId: `ntf_${randomUUID()}`,
        tenantId,
        kind,
        to,
        ...(optionalString(body.subject) ? { subject: String(body.subject) } : {}),
        textLength: text.length,
        status: 'accepted',
        detail: `synthetic ${kind} dispatch accepted; no provider configured`,
        acceptedAt: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  });
}

/** Enqueue an outbound egress for a relay. Used by /relay/enqueue and the bridge. */
export async function enqueueOutbound(
  storage: Storage,
  relayId: string,
  fields: {
    channel: RelayChannel;
    conversationId: string;
    text: string;
    replyToMessageId?: string;
    media?: ChatEgressEnvelope['media'];
    components?: ChatEgressEnvelope['components'];
    reactions?: ChatEgressEnvelope['reactions'];
  },
): Promise<ChatEgressEnvelope> {
  const egress: ChatEgressEnvelope = {
    egressId: `egr_${randomUUID()}`,
    relayId,
    channel: fields.channel,
    conversationId: fields.conversationId,
    text: fields.text,
    ...(fields.replyToMessageId ? { replyToMessageId: fields.replyToMessageId } : {}),
    ...(fields.media && fields.media.length ? { media: fields.media } : {}),
    ...(fields.components && fields.components.length ? { components: fields.components } : {}),
    ...(fields.reactions && fields.reactions.length ? { reactions: fields.reactions } : {}),
    enqueuedAt: new Date().toISOString(),
  };
  await storage.enqueueRelayOutbound(egress);
  // Best-effort delivery-log entry (queued). tenantId is resolved from the
  // owning device; if the device is gone we skip the log rather than fail.
  const device = await storage.getRelayDevice(relayId);
  if (device) {
    await storage.appendDeliveryLog({
      logId: `dlv_${randomUUID()}`,
      tenantId: device.tenantId,
      relayId,
      channel: egress.channel,
      direction: 'outbound',
      conversationId: egress.conversationId,
      status: 'queued',
      detail: `egress ${egress.egressId}`,
      at: egress.enqueuedAt,
    });
  }
  return egress;
}

// ---- helpers ----

function isWildcard(req: Request): boolean {
  return (req.principal?.tenants ?? []).includes('*');
}

function resolveTenant(req: Request): string {
  if (isWildcard(req)) {
    if (typeof req.query.tenantId === 'string' && req.query.tenantId.length > 0) return req.query.tenantId;
    const bodyTenant = (req.body ?? {}).tenantId;
    return typeof bodyTenant === 'string' && bodyTenant.length > 0 ? bodyTenant : 'default';
  }
  return req.tenantId ?? 'default';
}

/** Tenant filter for list endpoints: undefined = all (wildcard, no ?tenantId). */
function listTenantFilter(req: Request): string | undefined {
  if (isWildcard(req)) {
    return typeof req.query.tenantId === 'string' ? req.query.tenantId : undefined;
  }
  return req.tenantId;
}

async function requireDevice(req: Request, storage: Storage): Promise<RelayDeviceRecord> {
  const token = req.header('x-openwop-device-token');
  if (!token) throw new OpenwopError('unauthenticated', 'x-openwop-device-token header required', 401);
  const device = await storage.getRelayDeviceByTokenHash(hashToken(token));
  if (!device || device.status !== 'active') {
    throw new OpenwopError('unauthenticated', 'invalid or revoked device token', 401);
  }
  if (device.tokenExpiresAt && Date.parse(device.tokenExpiresAt) < Date.now()) {
    throw new OpenwopError('unauthenticated', 'device token expired', 401);
  }
  return device;
}

async function getConnectorOr404(req: Request, storage: Storage) {
  const c = await storage.getMessagingConnector(req.params.id);
  if (!c || (c.tenantId !== resolveTenant(req) && !isWildcard(req))) {
    throw new OpenwopError('not_found', 'connector not found', 404);
  }
  return c;
}

async function getSessionOr404(req: Request, storage: Storage) {
  const s = await storage.getMessagingSession(req.params.key);
  if (!s || (s.tenantId !== resolveTenant(req) && !isWildcard(req))) {
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
      .filter((m): m is { url: string; mimeType?: string; filename?: string } => !!m && typeof (m as { url?: unknown }).url === 'string')
      .map((m) => ({ url: m.url, ...(m.mimeType ? { mimeType: m.mimeType } : {}), ...(m.filename ? { filename: m.filename } : {}) }));
  }
  // ── envelope v2 passthrough (all optional; unknown kinds tolerated) ──
  const kind = optionalString(body.kind);
  if (kind === 'reaction' || kind === 'edit' || kind === 'command' || kind === 'message') envelope.kind = kind;
  if (optionalString(body.quotedMessageId)) envelope.quotedMessageId = String(body.quotedMessageId);
  const reaction = body.reaction as { emoji?: unknown; targetMessageId?: unknown } | undefined;
  if (reaction && typeof reaction.emoji === 'string' && typeof reaction.targetMessageId === 'string') {
    envelope.reaction = { emoji: reaction.emoji, targetMessageId: reaction.targetMessageId };
  }
  const command = body.command as { name?: unknown; args?: unknown } | undefined;
  if (command && typeof command.name === 'string') {
    envelope.command = { name: command.name, ...(typeof command.args === 'string' ? { args: command.args } : {}) };
  }
  if (body.channelMeta && typeof body.channelMeta === 'object' && !Array.isArray(body.channelMeta)) {
    envelope.channelMeta = body.channelMeta as Record<string, unknown>;
  }
  return envelope;
}

/** Parse the optional envelope-v2 outbound fields (media/components/reactions) off a request body. */
function parseEgressExtras(body: Record<string, unknown>): {
  media?: ChatEgressEnvelope['media'];
  components?: ChatEgressEnvelope['components'];
  reactions?: ChatEgressEnvelope['reactions'];
} {
  const out: {
    media?: ChatEgressEnvelope['media'];
    components?: ChatEgressEnvelope['components'];
    reactions?: ChatEgressEnvelope['reactions'];
  } = {};
  if (Array.isArray(body.media)) {
    out.media = body.media
      .filter((m): m is { url: string; mimeType?: string; filename?: string } => !!m && typeof (m as { url?: unknown }).url === 'string')
      .map((m) => ({ url: m.url, ...(m.mimeType ? { mimeType: m.mimeType } : {}), ...(m.filename ? { filename: m.filename } : {}) }));
  }
  if (Array.isArray(body.components)) {
    out.components = body.components
      .filter((c): c is { id: string; label: string; style?: 'reply' | 'link'; url?: string } =>
        !!c && typeof (c as { id?: unknown }).id === 'string' && typeof (c as { label?: unknown }).label === 'string')
      .map((c) => ({ id: c.id, label: c.label, ...(c.style ? { style: c.style } : {}), ...(c.url ? { url: c.url } : {}) }));
  }
  if (Array.isArray(body.reactions)) {
    out.reactions = body.reactions.filter((r): r is string => typeof r === 'string');
  }
  return out;
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

/**
 * Coerce a `?limit=` query value to a sane positive integer in [1, 1000].
 * Non-numeric / non-positive inputs fall back to the default (100) — important
 * because SQLite treats a negative LIMIT as "unbounded", so an unclamped
 * `?limit=-1` would otherwise dump the whole table on the sqlite/memory host.
 */
function clampLimit(raw: unknown, fallback = 100): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 1000);
}

/** Host default policy: DM pairing required, groups allowlist-only, mention required. */
function defaultPolicy(connectorId: string, tenantId: string): MessagingPolicyRecord {
  return {
    connectorId,
    tenantId,
    dmPolicy: 'pairing',
    groupPolicy: 'allowlist',
    requireMention: true,
    updatedAt: new Date().toISOString(),
  };
}

function assertDmPolicy(raw: unknown): DmPolicy {
  if (typeof raw === 'string' && (DM_POLICIES as readonly string[]).includes(raw)) return raw as DmPolicy;
  throw new OpenwopError('invalid_request', `dmPolicy must be one of ${DM_POLICIES.join(', ')}`, 400, { allowed: DM_POLICIES });
}

function assertGroupPolicy(raw: unknown): GroupPolicy {
  if (typeof raw === 'string' && (GROUP_POLICIES as readonly string[]).includes(raw)) return raw as GroupPolicy;
  throw new OpenwopError('invalid_request', `groupPolicy must be one of ${GROUP_POLICIES.join(', ')}`, 400, { allowed: GROUP_POLICIES });
}

function assertDirection(raw: unknown): 'inbound' | 'outbound' {
  if (raw === 'inbound' || raw === 'outbound') return raw;
  throw new OpenwopError('invalid_request', "direction must be 'inbound' or 'outbound'", 400);
}

function assertNotifyKind(raw: unknown): NotifyKind {
  if (typeof raw === 'string' && (NOTIFY_KINDS as readonly string[]).includes(raw)) return raw as NotifyKind;
  throw new OpenwopError('invalid_request', `kind must be one of ${NOTIFY_KINDS.join(', ')}`, 400, { allowed: NOTIFY_KINDS });
}

/** Parse + validate a peers array: [{ channel, peerId }]. */
function parsePeers(raw: unknown): MessagingIdentityRecord['peers'] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is { channel: unknown; peerId: unknown } => !!p && typeof p === 'object')
    .map((p) => ({ channel: assertChannel(p.channel), peerId: requireString(p.peerId, 'peerId') }));
}

/** Merge new peers into existing, de-duped by (channel, peerId). */
function mergePeers(
  existing: MessagingIdentityRecord['peers'],
  incoming: MessagingIdentityRecord['peers'],
): MessagingIdentityRecord['peers'] {
  const seen = new Set(existing.map((p) => `${p.channel} ${p.peerId}`));
  const merged = [...existing];
  for (const p of incoming) {
    const key = `${p.channel} ${p.peerId}`;
    if (!seen.has(key)) { seen.add(key); merged.push(p); }
  }
  return merged;
}

async function getRoutingRuleOr404(req: Request, storage: Storage): Promise<MessagingRoutingRuleRecord> {
  const rules = await storage.listMessagingRoutingRules(listTenantFilter(req));
  const found = rules.find((r) => r.ruleId === req.params.ruleId);
  if (!found) throw new OpenwopError('not_found', 'routing rule not found', 404);
  return found;
}

async function getIdentityOr404(req: Request, storage: Storage): Promise<MessagingIdentityRecord> {
  const i = await storage.getMessagingIdentity(req.params.id);
  if (!i || (i.tenantId !== resolveTenant(req) && !isWildcard(req))) {
    throw new OpenwopError('not_found', 'identity not found', 404);
  }
  return i;
}
