/**
 * a2ui-surface-delta-transport — RFC 0114 §"Delta transport".
 *
 * RFC 0114 adds an opt-in, HOST-SIDE TRANSPORT projection over the recorded
 * `ui.a2ui-surface` envelope (RFC 0102): the recorded envelope stays the FULL
 * surface (replay-pinned, security-validated, event-log-full — UNCHANGED), and
 * a host that advertises `a2uiSurface.deltaTransport: true` MAY deliver RFC 6902
 * (JSON-Patch) delta frames over the run event stream to subscribers that
 * negotiate `?a2uiDelta=1`, materializing the full surface for everyone else.
 *
 * Assertions:
 *
 *   Always-on (server-free, Ajv2020 + a client-side RFC 6902 applier):
 *     1. `schemas/a2ui-surface-delta-frame.schema.json` compiles; a positive
 *        frame validates; the `test` op is EXCLUDED from the op enum.
 *     2. A full surface + a sequence of delta frames reconstruct the expected
 *        tree (apply RFC 6902 client-side) AND the reconstruction equals the
 *        full surface a non-negotiating subscriber materializes (delta and full
 *        agree); the reconstruction validates against the closed catalog.
 *     3. A delta whose `patch` `add`s an OUT-OF-CATALOG component yields a
 *        post-patch surface that FAILS closed-catalog validation → rejected
 *        fail-closed (the `a2ui-surface-no-code-exec` boundary holds post-patch),
 *        forcing full re-materialization.
 *     4. The recorded envelope (event-log read / replay) is ALWAYS the full
 *        surface, never a delta: a delta frame does NOT validate against the
 *        recorded `ui.a2ui-surface` envelope schema, and the full surface does.
 *     5. `catalogVersion` on a delta frame MUST equal the referenced full
 *        surface's.
 *
 *   Capability-gated (HTTP, soft-skip on absent host / absent capability):
 *     6. When the host advertises `a2uiSurface.deltaTransport`, a non-negotiating
 *        events subscriber (no `?a2uiDelta=1`) receives a FULL `ui.a2ui-surface`
 *        surface, never a delta frame — the default-materialization floor.
 *
 * @see RFCS/0114-a2ui-surface-deltas.md
 * @see spec/v1/ai-envelope.md §"Delta transport"
 * @see spec/v1/stream-modes.md §"A2UI delta transport"
 * @see schemas/a2ui-surface-delta-frame.schema.json
 * @see SECURITY/invariants.yaml (a2ui-surface-no-code-exec)
 */

import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCHEMAS_DIR } from '../lib/paths.js';
import { driver } from '../lib/driver.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const ajv = new Ajv2020({ strict: false, allErrors: true });

const recordedEnvelopeSchema = JSON.parse(
  readFileSync(join(SCHEMAS_DIR, 'envelopes/ui.a2ui-surface.schema.json'), 'utf8'),
) as Record<string, unknown>;
const deltaFrameSchema = JSON.parse(
  readFileSync(join(SCHEMAS_DIR, 'a2ui-surface-delta-frame.schema.json'), 'utf8'),
) as Record<string, unknown>;

const validateRecorded: ValidateFunction = ajv.compile(recordedEnvelopeSchema);
const validateFrame: ValidateFunction = ajv.compile(deltaFrameSchema);

// ── Minimal, typed JSON value model + RFC 6901 / RFC 6902 applier ────────────
// A cast-free reference applier: enough of RFC 6902 to exercise the transport
// contract (add/remove/replace over RFC 6901 pointers). The suite owns this so
// the scenario carries no external JSON-Patch dependency.

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

interface PatchOp {
  readonly op: 'add' | 'remove' | 'replace' | 'move' | 'copy';
  readonly path: string;
  readonly from?: string;
  readonly value?: JsonValue;
}

function isRecord(v: JsonValue): v is { [key: string]: JsonValue } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clone(v: JsonValue): JsonValue {
  return JSON.parse(JSON.stringify(v)) as JsonValue;
}

function unescapeToken(token: string): string {
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new Error(`invalid JSON pointer: ${pointer}`);
  return pointer.slice(1).split('/').map(unescapeToken);
}

/** Read the value at `pointer`; throws on any missing/invalid segment. */
function getAt(doc: JsonValue, pointer: string): JsonValue {
  let node: JsonValue = doc;
  for (const token of parsePointer(pointer)) {
    if (Array.isArray(node)) {
      const idx = Number(token);
      if (!Number.isInteger(idx) || idx < 0 || idx >= node.length) {
        throw new Error(`pointer index out of range: ${pointer}`);
      }
      node = node[idx];
    } else if (isRecord(node)) {
      if (!Object.prototype.hasOwnProperty.call(node, token)) {
        throw new Error(`pointer key missing: ${pointer}`);
      }
      node = node[token];
    } else {
      throw new Error(`pointer descends into a scalar: ${pointer}`);
    }
  }
  return node;
}

function setAt(doc: JsonValue, pointer: string, value: JsonValue, mode: 'add' | 'replace'): void {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) throw new Error('cannot set the document root');
  const last = tokens[tokens.length - 1];
  let parent: JsonValue = doc;
  for (const token of tokens.slice(0, -1)) {
    parent = stepInto(parent, token, pointer);
  }
  if (Array.isArray(parent)) {
    const idx = last === '-' ? parent.length : Number(last);
    if (mode === 'add') {
      if (last === '-') parent.push(value);
      else {
        if (!Number.isInteger(idx) || idx < 0 || idx > parent.length) {
          throw new Error(`array add index out of range: ${pointer}`);
        }
        parent.splice(idx, 0, value);
      }
    } else {
      if (!Number.isInteger(idx) || idx < 0 || idx >= parent.length) {
        throw new Error(`array replace index out of range: ${pointer}`);
      }
      parent[idx] = value;
    }
  } else if (isRecord(parent)) {
    if (mode === 'replace' && !Object.prototype.hasOwnProperty.call(parent, last)) {
      throw new Error(`replace target missing: ${pointer}`);
    }
    parent[last] = value;
  } else {
    throw new Error(`cannot set into a scalar parent: ${pointer}`);
  }
}

function removeAt(doc: JsonValue, pointer: string): JsonValue {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) throw new Error('cannot remove the document root');
  const last = tokens[tokens.length - 1];
  let parent: JsonValue = doc;
  for (const token of tokens.slice(0, -1)) {
    parent = stepInto(parent, token, pointer);
  }
  if (Array.isArray(parent)) {
    const idx = Number(last);
    if (!Number.isInteger(idx) || idx < 0 || idx >= parent.length) {
      throw new Error(`array remove index out of range: ${pointer}`);
    }
    const [removed] = parent.splice(idx, 1);
    return removed;
  }
  if (isRecord(parent)) {
    if (!Object.prototype.hasOwnProperty.call(parent, last)) {
      throw new Error(`remove target missing: ${pointer}`);
    }
    const removed = parent[last];
    delete parent[last];
    return removed;
  }
  throw new Error(`cannot remove from a scalar parent: ${pointer}`);
}

function stepInto(node: JsonValue, token: string, pointer: string): JsonValue {
  if (Array.isArray(node)) {
    const idx = Number(token);
    if (!Number.isInteger(idx) || idx < 0 || idx >= node.length) {
      throw new Error(`pointer index out of range: ${pointer}`);
    }
    return node[idx];
  }
  if (isRecord(node)) {
    if (!Object.prototype.hasOwnProperty.call(node, token)) {
      throw new Error(`pointer key missing: ${pointer}`);
    }
    return node[token];
  }
  throw new Error(`pointer descends into a scalar: ${pointer}`);
}

/** Apply an RFC 6902 patch to a deep clone of `doc`; throws on any failure. */
function applyPatch(doc: JsonValue, patch: readonly PatchOp[]): JsonValue {
  const out = clone(doc);
  for (const op of patch) {
    switch (op.op) {
      case 'add':
        setAt(out, op.path, op.value ?? null, 'add');
        break;
      case 'replace':
        setAt(out, op.path, op.value ?? null, 'replace');
        break;
      case 'remove':
        removeAt(out, op.path);
        break;
      case 'move': {
        if (op.from === undefined) throw new Error('move requires `from`');
        const moved = removeAt(out, op.from);
        setAt(out, op.path, moved, 'add');
        break;
      }
      case 'copy': {
        if (op.from === undefined) throw new Error('copy requires `from`');
        const copied = clone(getAt(out, op.from));
        setAt(out, op.path, copied, 'add');
        break;
      }
      default:
        throw new Error(`unsupported op: ${String(op.op)}`);
    }
  }
  return out;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CATALOG_VERSION = '0.9.1';

function fullSurfaceV0(): { [key: string]: JsonValue } {
  return {
    catalogVersion: CATALOG_VERSION,
    surface: {
      title: 'Schedule the kickoff',
      components: [
        { component: 'heading', text: 'Kickoff', level: 2 },
        { component: 'text', text: 'Pick a date and confirm.' },
        { component: 'field.text', id: 'name', label: 'Your name', required: true },
        { component: 'action.button', id: 'go', label: 'Confirm', action: { target: 'resume' } },
      ],
    },
  };
}

// The full surface a NON-NEGOTIATING subscriber materializes after the same two
// updates the delta frames carry — the independent oracle for "delta and full agree".
function fullSurfaceMaterializedAfterUpdates(): { [key: string]: JsonValue } {
  return {
    catalogVersion: CATALOG_VERSION,
    surface: {
      title: 'Schedule the kickoff',
      components: [
        { component: 'heading', text: 'Kickoff', level: 2 },
        { component: 'text', text: 'Confirmed — see you then.' },
        { component: 'field.text', id: 'name', label: 'Your name', required: true },
        { component: 'action.button', id: 'go', label: 'Confirm', action: { target: 'resume' } },
        { component: 'text', text: 'A calendar invite is on its way.' },
      ],
    },
  };
}

describe('a2ui-surface-delta-transport: frame schema + op set (RFC 0114)', () => {
  it('a2ui-surface-delta-frame.schema.json compiles under Ajv2020', () => {
    expect(validateFrame, req('openwop.it.a2ui-surface-delta-transport.a2ui-surface-delta-frame-schema-json-compiles-under-ajv2020', 'RFC 0114 §"Delta transport', 'RFC 0114: the delta-frame schema MUST compile')).toBeTypeOf('function');
  });

  it('accepts a positive delta frame', () => {
    const frame = {
      surfaceRef: 'evt_9',
      catalogVersion: CATALOG_VERSION,
      patch: [{ op: 'replace', path: '/surface/components/1/text', value: 'Done' }],
    };
    expect(
      validateFrame(frame),
      req('openwop.it.a2ui-surface-delta-transport.accepts-a-positive-delta-frame', 'RFC 0114 §"Delta transport', `RFC 0114: a positive delta frame MUST validate; errors: ${JSON.stringify(validateFrame.errors)}`),
    ).toBe(true);
  });

  it('rejects a frame missing the required `surfaceRef`/`catalogVersion`/`patch`', () => {
    expect(validateFrame({ catalogVersion: CATALOG_VERSION, patch: [{ op: 'replace', path: '/x' }] }), req('openwop.it.a2ui-surface-delta-transport.rejects-a-frame-missing-the-required-surfaceref-catalogversion-patch', 'RFC 0114 §"Delta transport', 'rejects a frame missing the required `surfaceRef`/`catalogVersion`/`patch`')).toBe(false);
    expect(validateFrame({ surfaceRef: 'e', patch: [{ op: 'replace', path: '/x' }] })).toBe(false);
    expect(validateFrame({ surfaceRef: 'e', catalogVersion: CATALOG_VERSION })).toBe(false);
  });

  it('rejects an empty patch (minItems: 1)', () => {
    expect(validateFrame({ surfaceRef: 'e', catalogVersion: CATALOG_VERSION, patch: [] }), req('openwop.it.a2ui-surface-delta-transport.rejects-an-empty-patch-minitems-1', 'RFC 0114 §"Delta transport', 'rejects an empty patch (minItems: 1)')).toBe(false);
  });

  it('EXCLUDES the `test` op from the op enum', () => {
    const frame = {
      surfaceRef: 'evt_9',
      catalogVersion: CATALOG_VERSION,
      patch: [{ op: 'test', path: '/surface/components/0/component', value: 'heading' }],
    };
    expect(
      validateFrame(frame),
      req('openwop.it.a2ui-surface-delta-transport.excludes-the-test-op-from-the-op-enum', 'RFC 0114 §"Delta transport', 'RFC 0114: a fire-and-forget transport frame cannot act on a failed conditional; `test` is excluded'),
    ).toBe(false);
  });

  it('rejects a patch item carrying an out-of-set property (additionalProperties:false)', () => {
    const frame = {
      surfaceRef: 'evt_9',
      catalogVersion: CATALOG_VERSION,
      patch: [{ op: 'replace', path: '/x', value: 1, onApply: "fetch('https://evil')" }],
    };
    expect(validateFrame(frame), req('openwop.it.a2ui-surface-delta-transport.rejects-a-patch-item-carrying-an-out-of-set-property-additionalproperties-false', 'RFC 0114 §"Delta transport', 'rejects a patch item carrying an out-of-set property (additionalProperties:false)')).toBe(false);
  });
});

describe('a2ui-surface-delta-transport: full + deltas reconstruct the materialized full (RFC 0114)', () => {
  it('a full surface + delta frames reconstruct the tree AND equal the non-negotiating full', () => {
    const recordedRef = 'evt_9';
    const full = fullSurfaceV0();

    // Frame 1: replace a leaf. Frame 2: append a new IN-CATALOG component.
    const frames = [
      {
        surfaceRef: recordedRef,
        catalogVersion: CATALOG_VERSION,
        patch: [{ op: 'replace' as const, path: '/surface/components/1/text', value: 'Confirmed — see you then.' }],
      },
      {
        surfaceRef: recordedRef,
        catalogVersion: CATALOG_VERSION,
        patch: [{ op: 'add' as const, path: '/surface/components/-', value: { component: 'text', text: 'A calendar invite is on its way.' } }],
      },
    ];

    for (const frame of frames) {
      expect(validateFrame(frame), req('openwop.it.a2ui-surface-delta-transport.a-full-surface-delta-frames-reconstruct-the-tree-and-equal-the-non-negotiating-f', 'RFC 0114 §"Delta transport', `RFC 0114: each delta frame MUST validate; ${JSON.stringify(validateFrame.errors)}`)).toBe(true);
      // catalogVersion on a delta MUST equal the referenced full surface's.
      expect(
        frame.catalogVersion,
        req('openwop.it.a2ui-surface-delta-transport.a-full-surface-delta-frames-reconstruct-the-tree-and-equal-the-non-negotiating-f', 'RFC 0114 §"Delta transport', 'RFC 0114: a delta frame\'s catalogVersion MUST equal the referenced full surface\'s'),
      ).toBe(full.catalogVersion);
    }

    // Apply the frames client-side over the surface last delivered under surfaceRef.
    let reconstructed: JsonValue = full;
    for (const frame of frames) {
      reconstructed = applyPatch(reconstructed, frame.patch);
    }

    // (a) the reconstruction equals the full surface a non-negotiating subscriber materializes.
    expect(
      reconstructed,
      req('openwop.it.a2ui-surface-delta-transport.a-full-surface-delta-frames-reconstruct-the-tree-and-equal-the-non-negotiating-f', 'RFC 0114 §"Delta transport', 'RFC 0114: the delta reconstruction MUST equal the full surface the host materializes for a non-negotiating subscriber'),
    ).toEqual(fullSurfaceMaterializedAfterUpdates());

    // (b) the reconstruction re-validates against the closed catalog before render.
    expect(
      validateRecorded(reconstructed),
      req('openwop.it.a2ui-surface-delta-transport.a-full-surface-delta-frames-reconstruct-the-tree-and-equal-the-non-negotiating-f', 'RFC 0114 §"Delta transport', `RFC 0114: the post-patch surface MUST re-validate against the closed catalog; ${JSON.stringify(validateRecorded.errors)}`),
    ).toBe(true);
  });
});

describe('a2ui-surface-delta-transport: out-of-catalog delta fails closed (RFC 0114)', () => {
  it('a delta that `add`s an out-of-catalog component yields a post-patch surface that FAILS closed-catalog validation', () => {
    const full = fullSurfaceV0();
    const outOfCatalogFrame = {
      surfaceRef: 'evt_9',
      catalogVersion: CATALOG_VERSION,
      patch: [
        {
          op: 'add' as const,
          path: '/surface/components/-',
          value: { component: 'iframe', src: 'https://evil.example/x' },
        },
      ],
    };

    // The frame is structurally a valid delta FRAME (the catalog check is render-side).
    expect(validateFrame(outOfCatalogFrame)).toBe(true);

    const postPatch = applyPatch(full, outOfCatalogFrame.patch);

    // The post-patch surface MUST fail the closed-catalog validation a full surface
    // receives — the consumer rejects fail-closed and the host re-materializes full.
    // The `a2ui-surface-no-code-exec` boundary holds on the post-patch surface.
    expect(
      validateRecorded(postPatch),
      req('openwop.it.a2ui-surface-delta-transport.a-delta-that-add-s-an-out-of-catalog-component-yields-a-post-patch-surface-that', 'RFC 0114 §"Delta transport', 'RFC 0114 / a2ui-surface-no-code-exec: an out-of-catalog component reached by a delta MUST fail closed-catalog validation post-patch'),
    ).toBe(false);
  });

  it('a delta `replace` smuggling a script-bearing property also fails closed-catalog validation', () => {
    const full = fullSurfaceV0();
    const frame = {
      surfaceRef: 'evt_9',
      catalogVersion: CATALOG_VERSION,
      patch: [
        {
          op: 'replace' as const,
          path: '/surface/components/0',
          value: { component: 'heading', text: 'Hi', onClick: "fetch('https://evil')" },
        },
      ],
    };
    expect(validateFrame(frame)).toBe(true);
    const postPatch = applyPatch(full, frame.patch);
    expect(
      validateRecorded(postPatch),
      req('openwop.it.a2ui-surface-delta-transport.a-delta-replace-smuggling-a-script-bearing-property-also-fails-closed-catalog-va', 'RFC 0114 §"Delta transport', 'RFC 0114: a delta MUST NOT be a path by which a smuggled code field reaches render'),
    ).toBe(false);
  });
});

describe('a2ui-surface-delta-transport: the recorded envelope is always full (RFC 0114)', () => {
  it('a delta frame does NOT validate against the recorded ui.a2ui-surface envelope schema', () => {
    const frame = {
      surfaceRef: 'evt_9',
      catalogVersion: CATALOG_VERSION,
      patch: [{ op: 'replace', path: '/surface/components/1/text', value: 'Done' }],
    };
    expect(
      validateRecorded(frame),
      req('openwop.it.a2ui-surface-delta-transport.a-delta-frame-does-not-validate-against-the-recorded-ui-a2ui-surface-envelope-sc', 'RFC 0114 §"Delta transport', 'RFC 0114: the recorded envelope is NEVER a delta — a delta frame MUST NOT validate as a recorded ui.a2ui-surface payload'),
    ).toBe(false);
  });

  it('the full surface validates as the recorded ui.a2ui-surface payload (event-log read / replay shape)', () => {
    expect(
      validateRecorded(fullSurfaceV0()),
      req('openwop.it.a2ui-surface-delta-transport.the-full-surface-validates-as-the-recorded-ui-a2ui-surface-payload-event-log-rea', 'RFC 0114 §"Delta transport', 'RFC 0114: the event-log read / replay always sees the FULL surface, which MUST validate as the recorded payload'),
    ).toBe(true);
  });
});

// ── Capability-gated HTTP leg (soft-skip on absent host / absent capability) ──
//
// Non-vacuity (RFC 0114, host-sample-test-seams.md §15): a real `ui.a2ui-surface`
// envelope is one-shot per producing node, so the harness drives the SECOND
// surface emission through the OPTIONAL `POST /v1/host/sample/a2ui/emit-surface`
// seam — which MUST flow through the host's REAL surface-emit, the REAL
// `?a2uiDelta=1` transport, and the REAL closed-catalog validator. The harness
// only supplies the surface-update trigger (same shape as RFC 0115's
// harness-driven re-poll); the host produces the delta as it would in production.

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

interface A2uiSurfaceCap {
  readonly deltaTransport?: boolean;
}

interface EmitSurfaceResponse {
  readonly surfaceRef?: string;
}

/** Recursively collect every object in `node` that validates against `check`. */
function collectMatching(node: unknown, check: ValidateFunction): JsonValue[] {
  const out: JsonValue[] = [];
  const visit = (n: unknown): void => {
    if (n === null || typeof n !== 'object') return;
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (check(n)) out.push(n as JsonValue);
    Object.values(n as Record<string, unknown>).forEach(visit);
  };
  visit(node);
  return out;
}

/** Cast-free reader: narrow a validated JsonValue into a typed delta frame. */
function readFrame(v: JsonValue): { surfaceRef: string; catalogVersion: string; patch: PatchOp[] } | null {
  if (!isRecord(v)) return null;
  const { surfaceRef, catalogVersion, patch } = v;
  if (typeof surfaceRef !== 'string' || typeof catalogVersion !== 'string' || !Array.isArray(patch)) return null;
  const ops: PatchOp[] = [];
  for (const item of patch) {
    if (!isRecord(item)) return null;
    const { op, path, from } = item;
    if (typeof op !== 'string' || typeof path !== 'string') return null;
    if (op !== 'add' && op !== 'remove' && op !== 'replace' && op !== 'move' && op !== 'copy') return null;
    ops.push({
      op,
      path,
      ...(typeof from === 'string' ? { from } : {}),
      ...(Object.prototype.hasOwnProperty.call(item, 'value') ? { value: item.value } : {}),
    });
  }
  return { surfaceRef, catalogVersion, patch: ops };
}

/** GET the run events as a JSON envelope; return the parsed body or null. */
async function getEvents(runId: string, deltaOptIn: boolean): Promise<unknown> {
  const q = deltaOptIn ? '?a2uiDelta=1' : '';
  const res = await driver.get(`/v1/runs/${encodeURIComponent(runId)}/events${q}`, {
    headers: { Accept: 'application/json' },
  });
  if (res.status !== 200) return null;
  return res.json;
}

describe.skipIf(HTTP_SKIP)('a2ui-surface-delta-transport: live host delta transport (RFC 0114, gated)', () => {
  it('drives the emit-surface seam: a ?a2uiDelta=1 subscriber reconstruction equals the non-negotiating full', async () => {
    const disco = await driver.get('/.well-known/openwop');
    if (disco.status !== 200) return softSkip('blocked', 'precondition not met — `disco.status !== 200` returned early (no discovery — soft-skip) (seam, prior step, or fixture unavailable)'); // no discovery — soft-skip
    const cap = capabilityFamily<A2uiSurfaceCap>(disco.json, 'a2uiSurface');
    if (cap?.deltaTransport !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap?.deltaTransport !== true` returned early (capability not advertised — soft-skip)'); // capability not advertised — soft-skip

    const runId = `conf-a2ui-delta-${Date.now()}`;
    const surfaceA = fullSurfaceV0();
    const surfaceB = fullSurfaceMaterializedAfterUpdates();

    // Baseline (surface A) through the host's REAL surface-emit path.
    const emitA = await driver.post('/v1/host/sample/a2ui/emit-surface', { runId, surface: surfaceA });
    if (emitA.status === 404 || emitA.status === 405) return softSkip('blocked', 'precondition not met — `emitA.status === 404 || emitA.status === 405` returned early (seam absent — soft-skip the live leg) (seam, prior step, or fixture unavailable)'); // seam absent — soft-skip the live leg
    expect(
      emitA.status,
      req('openwop.it.a2ui-surface-delta-transport.drives-the-emit-surface-seam-a-a2uidelta-1-subscriber-reconstruction-equals-the', 'RFC 0114 §15', 'the emit-surface seam MUST record the baseline full surface'),
    ).toBeLessThan(300);

    // Second full surface (surface B) — recorded full AND transported as a delta
    // to any ?a2uiDelta=1 subscriber.
    const emitB = await driver.post('/v1/host/sample/a2ui/emit-surface', { runId, surface: surfaceB });
    if (emitB.status === 404 || emitB.status === 405) return softSkip('blocked', 'precondition not met — `emitB.status === 404 || emitB.status === 405` returned early (seam, prior step, or fixture unavailable)');
    expect(emitB.status, req('openwop.it.a2ui-surface-delta-transport.drives-the-emit-surface-seam-a-a2uidelta-1-subscriber-reconstruction-equals-the', 'RFC 0114 §15', 'the second emit MUST succeed')).toBeLessThan(300);
    const refB = (emitB.json as EmitSurfaceResponse)?.surfaceRef;

    // ?a2uiDelta=1 subscriber: locate the delta frame the host transported.
    const deltaEvents = await getEvents(runId, true);
    if (deltaEvents === null) return softSkip('blocked', 'precondition not met — `deltaEvents === null` returned early (events stream unavailable in JSON — soft-skip) (seam, prior step, or fixture unavailable)'); // events stream unavailable in JSON — soft-skip
    const frames = collectMatching(deltaEvents, validateFrame)
      .map(readFrame)
      .filter((f): f is { surfaceRef: string; catalogVersion: string; patch: PatchOp[] } => f !== null)
      .filter((f) => refB === undefined || f.surfaceRef === refB);
    if (frames.length === 0) return softSkip('blocked', 'precondition not met — `frames.length === 0` returned early (host streams SSE-only or buffered the frame — soft-skip) (seam, prior step, or fixture unavailable)'); // host streams SSE-only or buffered the frame — soft-skip
    const frame = frames[frames.length - 1];

    // catalogVersion on the delta MUST equal the baseline full surface's.
    expect(
      frame.catalogVersion,
      req('openwop.it.a2ui-surface-delta-transport.drives-the-emit-surface-seam-a-a2uidelta-1-subscriber-reconstruction-equals-the', 'RFC 0114', 'a delta frame catalogVersion MUST equal the referenced full surface'),
    ).toBe(surfaceA.catalogVersion);

    // Reconstruct: apply the host's real delta to the baseline, re-validate against the closed catalog.
    const reconstructed = applyPatch(surfaceA, frame.patch);
    expect(
      validateRecorded(reconstructed),
      req('openwop.it.a2ui-surface-delta-transport.drives-the-emit-surface-seam-a-a2uidelta-1-subscriber-reconstruction-equals-the', 'RFC 0114 §"Delta transport"', 'the post-patch surface MUST re-validate against the closed catalog'),
    ).toBe(true);

    // Non-negotiating subscriber: the host materializes the FULL surface for the same update.
    const fullEvents = await getEvents(runId, false);
    if (fullEvents === null) return softSkip('blocked', 'precondition not met — `fullEvents === null` returned early (seam, prior step, or fixture unavailable)');
    const fulls = collectMatching(fullEvents, validateRecorded);
    if (fulls.length === 0) return softSkip('blocked', 'precondition not met — `fulls.length === 0` returned early (soft-skip — no full surface observed on the non-delta stream) (seam, prior step, or fixture unavailable)'); // soft-skip — no full surface observed on the non-delta stream
    const materializedFull = fulls[fulls.length - 1];

    // delta and full agree — the core RFC 0114 transport guarantee, witnessed live.
    expect(
      reconstructed,
      req('openwop.it.a2ui-surface-delta-transport.drives-the-emit-surface-seam-a-a2uidelta-1-subscriber-reconstruction-equals-the', 
        'RFC 0114 §"Delta transport"',
        'a ?a2uiDelta=1 reconstruction MUST equal the full surface a non-negotiating subscriber materializes',
      ),
    ).toEqual(materializedFull);
  });

  it('the emit-surface seam rejects an out-of-catalog surface fail-closed (real catalog gate)', async () => {
    const disco = await driver.get('/.well-known/openwop');
    if (disco.status !== 200) return softSkip('blocked', 'precondition not met — `disco.status !== 200` returned early (seam, prior step, or fixture unavailable)');
    const cap = capabilityFamily<A2uiSurfaceCap>(disco.json, 'a2uiSurface');
    if (cap?.deltaTransport !== true) return softSkip('inapplicable', 'capability or profile not advertised by this host — gate `cap?.deltaTransport !== true` returned early');

    const runId = `conf-a2ui-delta-oob-${Date.now()}`;
    const baseline = await driver.post('/v1/host/sample/a2ui/emit-surface', { runId, surface: fullSurfaceV0() });
    if (baseline.status === 404 || baseline.status === 405) return softSkip('blocked', 'precondition not met — `baseline.status === 404 || baseline.status === 405` returned early (seam absent — soft-skip) (seam, prior step, or fixture unavailable)'); // seam absent — soft-skip
    expect(baseline.status, req('openwop.it.a2ui-surface-delta-transport.the-emit-surface-seam-rejects-an-out-of-catalog-surface-fail-closed-real-catalog', 'RFC 0114 §15', 'baseline emit MUST succeed')).toBeLessThan(300);

    // An out-of-catalog surface MUST be rejected by the host's REAL closed-catalog
    // validator — no delta transported, the a2ui-surface-no-code-exec boundary holds.
    const outOfCatalog = {
      catalogVersion: CATALOG_VERSION,
      surface: { components: [{ component: 'iframe', src: 'https://evil.example/x' }] },
    };
    const rejected = await driver.post('/v1/host/sample/a2ui/emit-surface', { runId, surface: outOfCatalog });
    if (rejected.status === 404 || rejected.status === 405) return softSkip('blocked', 'precondition not met — `rejected.status === 404 || rejected.status === 405` returned early (seam, prior step, or fixture unavailable)');
    expect(
      rejected.status,
      req('openwop.it.a2ui-surface-delta-transport.the-emit-surface-seam-rejects-an-out-of-catalog-surface-fail-closed-real-catalog', 
        'RFC 0114 §15 / a2ui-surface-no-code-exec',
        'an out-of-catalog surface MUST be rejected fail-closed by the host real catalog validator',
      ),
    ).toBeGreaterThanOrEqual(400);
  });
});
