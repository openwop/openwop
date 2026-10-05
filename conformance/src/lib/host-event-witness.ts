/**
 * RFC 0236 — host events: the judges `v2-host-event-delivery` applies to what
 * it observed. Pure: each takes an observation and returns findings, so the
 * self-test (`host-event-witness.test.ts`) can feed each one a defect and show
 * it convicts.
 *
 * The scenario owns the I/O (the `/host/events` stream, the emit seam, the
 * scoped webhook receiver). This file owns only "given what arrived, which
 * `events.md` §Host events / `webhooks.md` §Delivery rule failed?".
 */

export interface Finding { readonly ok: boolean; readonly message: string }
export interface AdvertisedType { readonly type: string; readonly delivery: 'durable' | 'ephemeral' }
export interface Frame { readonly event: string; readonly data: string; readonly id: string | null }

const ok = (message: string): Finding => ({ ok: true, message });
const bad = (message: string): Finding => ({ ok: false, message });

/** The advertised `hostEvents.types[]`, keeping only well-formed entries. */
export function advertisedTypes(record: Readonly<Record<string, unknown>> | null): AdvertisedType[] {
  const raw = Array.isArray(record?.['types']) ? (record['types'] as unknown[]) : [];
  return raw.flatMap((t) => {
    const r = t as { type?: unknown; delivery?: unknown };
    return typeof r.type === 'string' && (r.delivery === 'durable' || r.delivery === 'ephemeral') ? [{ type: r.type, delivery: r.delivery }] : [];
  });
}

/** The conformance types the §G seam drives: an `example.*` type of the given class. */
export function exampleType(types: readonly AdvertisedType[], delivery: AdvertisedType['delivery']): string | null {
  return types.find((t) => t.type.startsWith('example.') && t.delivery === delivery)?.type ?? null;
}

/** The frame carrying `eventId`, parsed, or null. */
export function frameFor(frames: readonly Frame[], eventId: string): { frame: Frame; envelope: Record<string, unknown> } | null {
  for (const frame of frames) {
    let env: unknown;
    try { env = JSON.parse(frame.data); } catch { continue; }
    if (env !== null && typeof env === 'object' && (env as { eventId?: unknown }).eventId === eventId) return { frame, envelope: env as Record<string, unknown> };
  }
  return null;
}

/**
 * §A/§B: an emitted event arrives as a valid envelope, labelled with its type,
 * of its advertised class, with `id:` = `eventId` when durable and no `id:` when
 * ephemeral. `validate` is the host-event schema validator.
 */
export function judgeEnvelope(
  frames: readonly Frame[], eventId: string, advertised: AdvertisedType,
  validate: (doc: unknown) => { ok: boolean; errors: string },
): Finding[] {
  const hit = frameFor(frames, eventId);
  if (hit === null) return [bad(`no frame on /host/events carried eventId ${eventId} (${frames.length} frame(s) arrived)`)];
  const { frame, envelope } = hit;
  const v = validate(envelope);
  const out: Finding[] = [
    v.ok ? ok('the frame is a valid host-event envelope') : bad(`the frame MUST be a valid host-event envelope (no runId, no sequence; closed): ${v.errors}`),
    frame.event === advertised.type ? ok('event: is the type') : bad(`the frame's event: MUST be the host-event type ${advertised.type}; got ${frame.event}`),
    envelope['delivery'] === advertised.delivery ? ok('delivery is the advertised class') : bad(`delivery MUST be the advertised class ${advertised.delivery}; got ${JSON.stringify(envelope['delivery'])}`),
  ];
  if (advertised.delivery === 'durable') out.push(frame.id === eventId ? ok('durable id: is eventId') : bad(`a durable event's frame id: MUST be its eventId ${eventId}; got ${JSON.stringify(frame.id)}`));
  else out.push(frame.id === null ? ok('ephemeral frame has no id:') : bad(`an ephemeral event's frame MUST carry no id:; got ${JSON.stringify(frame.id)}`));
  return out;
}

/** §C: after a reconnect with `Last-Event-ID`, the ephemeral event is not redelivered. */
export function judgeNoResume(resumed: readonly Frame[], ephemeralEventId: string): Finding {
  return frameFor(resumed, ephemeralEventId) === null
    ? ok('the ephemeral event was not redelivered')
    : bad(`a host MUST NOT redeliver an ephemeral host event on reconnection; eventId ${ephemeralEventId} arrived again after Last-Event-ID`);
}

/** §C: no webhook delivery carries the ephemeral event. `bodies` are the raw delivery bodies the subscription received. */
export function judgeNoFanOut(bodies: readonly string[], ephemeralEventId: string): Finding {
  const leaked = bodies.some((b) => b.includes(ephemeralEventId));
  return leaked ? bad(`a host MUST NOT deliver an ephemeral host event through webhooks; a delivery carried eventId ${ephemeralEventId}`) : ok('no delivery carried the ephemeral event');
}

/** §E: the host body validates, names the event and type, and verifies under the subscription secret. */
export function judgeHostBody(
  body: string, eventType: string | undefined, verified: boolean, eventId: string, type: string,
  validate: (doc: unknown) => { ok: boolean; errors: string },
): Finding[] {
  let doc: unknown;
  try { doc = JSON.parse(body); } catch { return [bad(`the delivery body MUST be JSON; got ${body.slice(0, 120)}`)]; }
  const v = validate(doc);
  const he = (doc as { hostEvent?: { eventId?: unknown; type?: unknown } } | null)?.hostEvent;
  return [
    v.ok && he !== undefined ? ok('the body is the { hostEvent } delivery') : bad(`a host-event delivery MUST be { hostEvent } and validate against webhook-delivery.schema.json: ${v.ok ? 'no hostEvent' : v.errors}`),
    he?.eventId === eventId ? ok('the body carries the emitted event') : bad(`the delivery MUST carry the emitted eventId ${eventId}; got ${JSON.stringify(he?.eventId)}`),
    eventType === type ? ok('OpenWOP-Event-Type is the host-event type') : bad(`OpenWOP-Event-Type MUST be ${type}; got ${JSON.stringify(eventType)}`),
    verified ? ok('the signature verifies') : bad('the delivery MUST verify under the subscription secret (webhooks.md §Signing is unchanged for host events)'),
  ];
}

/** §D: the second tenant's stream received nothing for the first tenant's event, while the first tenant's did (non-vacuous). */
export function judgeTenantScope(own: readonly Frame[], other: readonly Frame[], eventId: string): Finding[] {
  return [
    frameFor(own, eventId) !== null ? ok('the owning tenant received it') : bad(`the owning tenant's stream MUST receive its own event ${eventId} (otherwise the isolation check is vacuous)`),
    frameFor(other, eventId) === null ? ok('the other tenant did not') : bad(`a host MUST deliver a host event only within its tenant; a second tenant's stream received ${eventId}`),
  ];
}
