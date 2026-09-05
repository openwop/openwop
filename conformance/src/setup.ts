/**
 * Suite-init setup (RFC 0003).
 *
 * Loaded by vitest via `test.setupFiles` BEFORE any scenario file is
 * imported. Top-level `await` is supported in vitest's setup files so
 * this can fetch the host's `/.well-known/openwop` once and populate the
 * fixture-gating cache; `describe.skipIf(...)` predicates that read
 * `isFixtureAdvertised(...)` then see the populated cache when they
 * register their tests.
 *
 * Behavior matrix:
 *
 *   | OPENWOP_BASE_URL | discovery 200 | fixtures field | result |
 *   |---|---|---|---|
 *   | unset        | n/a            | n/a             | empty cache (offline mode) |
 *   | set          | yes            | absent/empty    | empty cache (host advertises none) |
 *   | set          | yes            | non-empty       | populated cache |
 *   | set          | non-200 / err  | n/a             | empty cache + console warning |
 *
 * "Empty cache" means every fixture-dependent scenario skips. That is
 * the correct outcome for a host that doesn't advertise the fixture
 * surface — see RFC 0003 §"Implementation notes."
 *
 * This file is intentionally side-effect-only. Do NOT add `describe`/
 * `it` here; vitest treats setupFiles differently from scenario files.
 */

import { setAdvertisedFixtures } from './lib/fixtures.js';
import { setMultiAgentCapabilities } from './lib/multi-agent-capabilities.js';
import { OtelCollector, setCollector } from './lib/otel-collector.js';
import { McpFakeServer, setMcpFakeServer } from './lib/mcp-fake-server.js';
import { A2AFakePeer, setA2AFakePeer } from './lib/a2a-fake-peer.js';
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { basename, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { PKG_ROOT_PATH } from './lib/paths.js';
import { recordRequirement, hasRequirement, journalLength, journalSince } from './lib/requirement-ledger.js';
import { requirementIdForFile, resolveFileRecord, type FileTestState } from './lib/scenario-disposition.js';
import { softSkipDisposition } from './lib/soft-skip.js';
import { ItIdAllocator, takeExplicitRequirementId } from './lib/requirement-ids.js';
import { SPEC_COHERENCE_SCENARIOS, SPEC_COHERENCE_DETAIL } from './lib/spec-coherence.js';
import type { DiscoveryPayload } from './lib/profiles.js';
import { targetMajor } from './lib/seams.js';
import { softSkip } from './lib/soft-skip.js';

const SUITE_INIT_TIMEOUT_MS = 5_000;

async function loadHostFixtures(): Promise<void> {
  const baseUrl = process.env.OPENWOP_BASE_URL?.trim();
  if (!baseUrl) {
    // Offline / fixture-stub-only run. No host to ask; treat as "host
    // advertises no fixtures" so all fixture-dependent scenarios skip.
    setAdvertisedFixtures(null);
    setMultiAgentCapabilities(null);
    return;
  }

  const normalizedBase = baseUrl.replace(/\/$/, '');
  const url = `${normalizedBase}/.well-known/openwop`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUITE_INIT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[openwop-conformance setup] discovery fetch returned ${res.status}; ` +
          `treating host as advertising no fixtures. Fixture-dependent scenarios will skip.`,
      );
      setAdvertisedFixtures(null);
    setMultiAgentCapabilities(null);
      return;
    }
    const body = (await res.json()) as DiscoveryPayload;
    setAdvertisedFixtures(body);
    setMultiAgentCapabilities(body);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[openwop-conformance setup] discovery fetch failed (${(err as Error).message ?? 'unknown'}); ` +
        `treating host as advertising no fixtures. Fixture-dependent scenarios will skip.`,
    );
    setAdvertisedFixtures(null);
    setMultiAgentCapabilities(null);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * OTel collector lifecycle (Track 11).
 *
 * Opt-in: only starts when `OPENWOP_OTEL_COLLECTOR=true` is set. Hosts
 * that don't claim observability conformance skip the scenarios; hosts
 * that do MUST be configured with
 * `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:<port>` and
 * `OTEL_EXPORTER_OTLP_PROTOCOL=http/json` before startup. The chosen
 * port is exposed via `OPENWOP_OTEL_COLLECTOR_PORT` (read by scenarios
 * for diagnostics) and printed to stderr at suite init.
 */
async function maybeStartOtelCollector(): Promise<void> {
  if (process.env.OPENWOP_OTEL_COLLECTOR !== 'true') {
    setCollector(null);
    return;
  }
  const portEnv = process.env.OPENWOP_OTEL_COLLECTOR_PORT;
  const requestedPort = portEnv ? Number(portEnv) : 4318;
  const collector = new OtelCollector();
  try {
    await collector.start(requestedPort);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[openwop-conformance setup] OTel collector failed to bind on port ${requestedPort} ` +
        `(${(err as Error).message ?? 'unknown'}); falling back to ephemeral port.`,
    );
    await collector.start(0);
  }
  setCollector(collector);
  // eslint-disable-next-line no-console
  console.error(
    `[openwop-conformance setup] OTel collector listening at ${collector.endpoint()}. ` +
      `Configure the host with OTEL_EXPORTER_OTLP_ENDPOINT=${collector.endpoint()} ` +
      `and OTEL_EXPORTER_OTLP_PROTOCOL=http/json.`,
  );

  // Track 11 — opt into the parallel OTLP/gRPC collector when
  // `OPENWOP_OTEL_COLLECTOR_GRPC=true`. Same span/metric store; hosts
  // emitting via either transport surface in `getCollector().spans()`.
  if (process.env.OPENWOP_OTEL_COLLECTOR_GRPC === 'true') {
    const grpcPortEnv = process.env.OPENWOP_OTEL_COLLECTOR_GRPC_PORT;
    const grpcRequestedPort = grpcPortEnv ? Number(grpcPortEnv) : 4317;
    try {
      await collector.startGrpc(grpcRequestedPort);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[openwop-conformance setup] OTLP/gRPC collector failed to bind on port ${grpcRequestedPort} ` +
          `(${(err as Error).message ?? 'unknown'}); falling back to ephemeral port.`,
      );
      await collector.startGrpc(0);
    }
    // eslint-disable-next-line no-console
    console.error(
      `[openwop-conformance setup] OTLP/gRPC collector listening at ${collector.grpcEndpoint()}. ` +
        `Configure the host with OTEL_EXPORTER_OTLP_ENDPOINT=${collector.grpcEndpoint()} ` +
        `and OTEL_EXPORTER_OTLP_PROTOCOL=grpc.`,
    );
  }
}

/**
 * MCP fake-server lifecycle (Track 6).
 *
 * Opt-in: only starts when `OPENWOP_MCP_FAKE_SERVER=true`. Operator
 * configures the host to use the printed URL as one of its MCP servers
 * (e.g., via host-specific config — the wire transport is normative
 * but how the host registers servers is not).
 */
async function maybeStartMcpFakeServer(): Promise<void> {
  if (process.env.OPENWOP_MCP_FAKE_SERVER !== 'true') {
    setMcpFakeServer(null);
    return;
  }
  const portEnv = process.env.OPENWOP_MCP_FAKE_SERVER_PORT;
  const requestedPort = portEnv ? Number(portEnv) : 0;
  const server = new McpFakeServer();
  await server.start(requestedPort);
  setMcpFakeServer(server);
  // eslint-disable-next-line no-console
  console.error(
    `[openwop-conformance setup] MCP fake server listening at ${server.endpoint()}. ` +
      `Configure the host's MCP integration to use this URL.`,
  );
}

/**
 * A2A fake peer lifecycle (Track 6).
 *
 * Opt-in via `OPENWOP_A2A_FAKE_PEER=true`. Operator configures the host
 * to consume the printed AgentCard URL.
 */
async function maybeStartA2AFakePeer(): Promise<void> {
  if (process.env.OPENWOP_A2A_FAKE_PEER !== 'true') {
    setA2AFakePeer(null);
    return;
  }
  const portEnv = process.env.OPENWOP_A2A_FAKE_PEER_PORT;
  const requestedPort = portEnv ? Number(portEnv) : 0;
  // Dual-era since 1.112.0. Order = card shape for a header-less GET (first
  // wins); both eras are spoken on the RPC path. Default keeps the 0.3 card so
  // today's 0.3 clients (which read `card.url`) keep working; set
  // OPENWOP_A2A_FAKE_PEER_VERSIONS=1.0,0.3 to serve the 1.0 card by default.
  const versionsEnv = process.env.OPENWOP_A2A_FAKE_PEER_VERSIONS;
  const versions = versionsEnv
    ? (versionsEnv.split(',').map((v) => v.trim()).filter((v) => v === '1.0' || v === '0.3') as Array<'1.0' | '0.3'>)
    : undefined;
  const peer = new A2AFakePeer(versions && versions.length > 0 ? { protocolVersions: versions } : undefined);
  await peer.start(requestedPort);
  setA2AFakePeer(peer);
  // eslint-disable-next-line no-console
  console.error(
    `[openwop-conformance setup] A2A fake peer listening at ${peer.endpoint()}. ` +
      `AgentCard at ${peer.endpoint()}/.well-known/agent-card.json.`,
  );
}

await loadHostFixtures();
await maybeStartOtelCollector();
await maybeStartMcpFakeServer();
await maybeStartA2AFakePeer();

// ─── RFC 0148 §A file-level disposition recording (S6, acceptance item 2) ─────
//
// Every scenario FILE records exactly one disposition for its own requirement
// id when it finishes. `afterEach` collects per-test states; `afterAll` folds
// them (fileDisposition) and records — `executed-fail` / `executed-pass` /
// `inapplicable` or `skipped` (when a behaviorGate in the file recorded that
// reason for the profile it gates on) / else `blocked` (an all-skipped file
// with no reason is an unclassified return, and §A resolves it to blocked).
// When the runner set OPENWOP_LEDGER_PATH the recording also lands in the JSONL
// sink, which is how `--certify` gets requirement-level dispositions instead of
// inferring them from per-file pass/fail/skip.
//
// Setup-file hooks apply to every file in the worker; state is keyed by file.
const _fileStates = new Map<string, FileTestState[]>();
const _fileAssertions = new Map<string, number>();
const _ledgerMarks = new Map<string, number>();
// Per-`it` recording (v2 charter Phase 1, suite 1.153.0 — the durable G8 fix
// named in scenario-disposition.ts). Each test gets its own ledger row under
// `openwop.it.<file>.<title-slug>` so a file that asserted a positive control
// and soft-skipped the requirement no longer certifies the requirement. The
// file-level row is RETAINED (floors key on it); the per-`it` rows are
// additive bundle rows (RFC 0148 §C `requirements[]` accepts any id).
const _itAllocators = new Map<string, ItIdAllocator>();
const _itMarks = new Map<string, number>();
const _itAssertionsBefore = new Map<string, number>();
function _assertionCalls(): number {
  try {
    return (expect.getState() as { assertionCalls?: number }).assertionCalls ?? 0;
  } catch {
    return 0;
  }
}

/**
 * (file, title) → the explicit `req()` id the scenario cites, read from the
 * generated `requirements.json` that ships with the package. Only ids under
 * `openwop.requirement.` are returned: a per-`it` id is what the allocator
 * would mint anyway.
 */
let _registry: Map<string, string> | undefined;
function registeredExplicitId(file: string, title: string): string | null {
  if (_registry === undefined) {
    _registry = new Map();
    for (const root of [PKG_ROOT_PATH, join(PKG_ROOT_PATH, '..')]) {
      const path = join(root, 'requirements.json');
      if (!existsSync(path)) continue;
      try {
        const doc = JSON.parse(readFileSync(path, 'utf8')) as { records?: Array<{ file?: unknown; title?: unknown; explicitId?: unknown }> };
        for (const r of doc.records ?? []) {
          if (typeof r.file === 'string' && typeof r.title === 'string' && typeof r.explicitId === 'string' && r.explicitId.startsWith('openwop.requirement.')) {
            _registry.set(`${r.file}\u0000${r.title}`, r.explicitId);
          }
        }
      } catch { /* an unreadable registry simply yields no fallback */ }
      break;
    }
  }
  return _registry.get(`${file}\u0000${title}`) ?? null;
}

function _fileOf(task: { file?: { filepath?: string; name?: string } } | undefined): string | null {
  const f = task?.file?.filepath ?? task?.file?.name;
  return typeof f === 'string' && f.length > 0 ? basename(f) : null;
}
// ---------------------------------------------------------------------------
// The applicability check and the assertion MUST run under the same contract.
//
// A scenario's registration in scenario-majors.json says which target majors it
// is written for. The driver reads OPENWOP_TARGET_MAJOR to decide which header
// and path space every probe uses. Nothing connected the two: a lane that ran
// vitest directly over all 501 files at the default (major 1) executed every
// major-2 scenario with major-1 requests. The scenarios' own gates call
// v2Discovery(), which sets the header EXPLICITLY, so the gate passed and the
// probe went out as v1 — a check that proved the host speaks v2 with one
// request, then tested a v2 requirement with a request that did not.
//
// Measured on a tier-1 host 2026-09-04: three "host defects" reported from that
// lane, all of which evaporated at major 2; the host was one edit from "fixing"
// correct behaviour. And in the other direction: 4 of 56 v2 files fail on every
// host forever under a major-1 driver, so a gate that runs them that way is red
// by construction and gets reasoned past. Both are the same defect: a scoped
// signal read as unscoped, with the scope nowhere in the output.
//
// So: a file whose registered majors do not include the driver's target major
// is INAPPLICABLE to this lane, recorded as such with the reason, and never
// probes. Files not in the registry (coherence checks, lib tests) are untouched.
// ---------------------------------------------------------------------------
const SCENARIO_MAJORS: Record<string, number[]> = (() => {
  try {
    const p = join(PKG_ROOT_PATH, 'scenario-majors.json');
    if (!existsSync(p)) return {};
    return (JSON.parse(readFileSync(p, 'utf8')) as { majors?: Record<string, number[]> }).majors ?? {};
  } catch {
    return {};
  }
})();

beforeEach((ctx) => {
  const p = (expect.getState() as { testPath?: string }).testPath;
  if (!p) return;
  const file = basename(p);
  const majors = SCENARIO_MAJORS[file];
  if (!majors) return;
  const lane = targetMajor();
  if (majors.includes(lane)) return;
  const detail = `registered for target major ${majors.join('/')} and this lane runs at major ${lane} (OPENWOP_TARGET_MAJOR) — the probe would go out under a contract the scenario's gate does not use; select files with --target-major or set the variable`;
  // Two records, one per resolver. The per-TEST disposition is read from the
  // requirement journal (the same entry behaviorGate writes), so the row lands
  // as `inapplicable` with this reason rather than `skipped`, which under RFC
  // 0148 would claim the operator opted out. The per-FILE note covers the
  // all-skipped fallback in resolveFileRecord.
  try {
    recordRequirement('openwop.family.lane-target-major', 'inapplicable', detail, { scenarioFile: file });
  } catch {
    /* never fail a test for bookkeeping */
  }
  softSkip('inapplicable', detail);
  ctx.skip();
});

beforeAll(({}, suite) => {
  // Mark the ledger journal BEFORE the file's tests run, so a behaviorGate
  // decision made by the very first test is inside the file's window.
  const s = suite as unknown as { filepath?: string; name?: string; file?: { filepath?: string; name?: string } };
  const file = _fileOf({ file: s.file ?? s });
  if (file !== null && !_ledgerMarks.has(file)) _ledgerMarks.set(file, journalLength());
});
beforeEach(({ task }) => {
  const file = _fileOf(task as { file?: { filepath?: string; name?: string } });
  if (file === null) return;
  // Window for this test's own gate decisions and its own assertion count.
  _itMarks.set(file, journalLength());
  _itAssertionsBefore.set(file, _assertionCalls());
  takeExplicitRequirementId(); // clear any override left by a test that threw before afterEach
});
afterEach(({ task }) => {
  const file = _fileOf(task as { file?: { filepath?: string; name?: string } });
  if (file === null) return;
  if (!_ledgerMarks.has(file)) _ledgerMarks.set(file, 0);
  const state = task.result?.state;
  const arr = _fileStates.get(file) ?? [];
  arr.push(state === 'pass' ? 'pass' : state === 'fail' ? 'fail' : 'skip');
  _fileStates.set(file, arr);
  // RFC 0148 §C assertionCount: how many `expect` calls this test actually made.
  // A leg that early-returns from a gate makes zero, and a file of such legs is
  // an `executed-pass` with assertionCount 0 — visible, and unclassified for a
  // claimed floor.
  //
  // `expect.getState().assertionCalls` is per-test in vitest (reset at each
  // test start), so it is this test's count; the file total is the sum.
  const calls = _assertionCalls();
  _fileAssertions.set(file, (_fileAssertions.get(file) ?? 0) + calls);

  // Per-`it` row. Disposition follows RFC 0148 §A at test granularity:
  //   fail                       → executed-fail (detail = the first error message)
  //   skip (ctx.skip / it.skip)  → the gate's recorded reason since this test began, else `skipped`
  //   pass with ≥1 assertion     → executed-pass
  //   pass with 0 assertions     → the gate's recorded reason (softSkip / seamAbsent / behaviorGate)
  //                                since this test began, else `blocked` (unclassified return)
  if (!file.endsWith('.test.ts')) return;
  // Only SCENARIO files get per-`it` rows. The setup hooks run for every file in
  // the worker, including `src/lib/*.test.ts` — the suite's own self-tests,
  // which prove fixtures and helpers, not a host, and must never become bundle
  // evidence (that is why RFC 0163 G5 / RFC 0050 G1 moved them out of scenarios).
  const filepath = (task as { file?: { filepath?: string } }).file?.filepath ?? '';
  // Suite 2.0.0: src/coherence/ rows feed the corpus ledger (scripts/check-spec-coherence.mjs), not a host bundle.
  if (!/[\\/]src[\\/](scenarios|coherence)[\\/]/.test(filepath)) {
    takeExplicitRequirementId();
    return;
  }
  // A leg that soft-skips before its first assertion never calls `req()`, so the
  // runtime override is empty and the row lands under the per-`it` id instead of
  // the requirement the leg is about — leaving that requirement with no row in
  // any bundle, which is the §F Witness gate's subject. The generated registry
  // already knows (file, title) → explicit id statically, so fall back to it and
  // the disposition is attributed either way.
  const explicit = takeExplicitRequirementId() ?? registeredExplicitId(file, task.name);
  const alloc = _itAllocators.get(file) ?? new ItIdAllocator();
  _itAllocators.set(file, alloc);
  const itId = explicit ?? alloc.allocate(file, task.name);
  const since = journalSince(_itMarks.get(file) ?? 0);
  const gate = since.find((e) => e.disposition === 'inapplicable') ?? since.find((e) => e.disposition === 'skipped');
  let disposition: 'executed-pass' | 'executed-fail' | 'skipped' | 'inapplicable' | 'blocked';
  let detail: string | undefined;
  // Suite 2.0.0: under the corpus gate (scripts/check-spec-coherence.mjs sets OPENWOP_CORPUS_GATE) a coherence scenario IS the subject; its rows are real dispositions for evidence/corpus-ledger.json.
  if (process.env.OPENWOP_CORPUS_GATE !== '1' && (SPEC_COHERENCE_SCENARIOS.has(file) || SPEC_COHERENCE_SCENARIOS.has(file.replace(/\.test\.ts$/, '')))) {
    // Corpus-coherence scenario: it reads spec/v1 and asserts nothing about a
    // host, in any layout. Its rows are `inapplicable` to every host — the same
    // rule `resolveFileRecord` applies to the file in the published layout.
    disposition = 'inapplicable';
    detail = SPEC_COHERENCE_DETAIL;
  } else if (state === 'fail') {
    disposition = 'executed-fail';
    const err = (task.result?.errors ?? [])[0] as { message?: string } | undefined;
    detail = `the test executed and failed: ${(err?.message ?? 'no message').slice(0, 300)}`;
  } else if (state === 'pass' && calls > 0) {
    disposition = 'executed-pass';
  } else if (gate !== undefined) {
    disposition = gate.disposition as 'skipped' | 'inapplicable';
    detail = gate.detail ?? `${gate.disposition} (gate recorded no reason)`;
  } else if (state === 'pass') {
    disposition = 'blocked';
    detail = 'unclassified return: the test passed with zero assertions and recorded no reason — RFC 0148 §A resolves it to blocked, never to a pass';
  } else {
    disposition = 'skipped';
    detail = 'vitest skipped the test (ctx.skip / it.skip) without a recorded gate reason';
  }
  try {
    recordRequirement(itId, disposition, detail, { assertionCount: calls, scenarioFile: file });
  } catch {
    /* never fail a test for bookkeeping */
  }
});
afterAll(({}, suite) => {
  // vitest 4: the suite/file task is the SECOND argument. For a file-level
  // afterAll registered from a setup file, `suite` is the File task itself.
  const s = suite as unknown as { filepath?: string; name?: string; file?: { filepath?: string; name?: string } };
  const file = _fileOf({ file: s.file ?? s });
  if (file === null || !file.endsWith('.test.ts')) return;
  const states = _fileStates.get(file) ?? [];
  // Did a behaviorGate in this file record inapplicable/skipped for its profile?
  const mark = _ledgerMarks.get(file) ?? 0;
  const since = journalSince(mark);
  const gateReason = since.some((e) => e.disposition === 'inapplicable')
    ? 'inapplicable'
    : since.some((e) => e.disposition === 'skipped')
      ? 'skipped'
      : undefined;
  const assertionCount = _fileAssertions.get(file) ?? 0;
  // RFC 0148 §A: a pass with zero assertions is an unclassified return. If the
  // file said why (softSkip / seamAbsent / behaviorGate), that is its
  // disposition; if it said nothing, the runner resolves it to `blocked` with
  // the marker detail — never to a pass. Floors still REJECT that row, so the
  // honest bundle row and the pressure to say why both survive. The rule is
  // `resolveFileRecord` (pinned by conformance-execution-witness.test.ts).
  const { disposition, detail } = resolveFileRecord(states, gateReason, assertionCount, softSkipDisposition(file), file);
  const fileRequirementId = requirementIdForFile(file);
  // A scenario that classified ITSELF wins outright — including its `detail` and
  // its `assertionCount`.
  //
  // The `catch` below has always made the explicit record win when the two
  // DISAGREE (`recordRequirement` throws on a conflicting disposition). It did
  // not when they AGREE: the automatic call then reached `ledger.set` and
  // silently replaced the scenario's own detail and count with the file-level
  // ones. Invisible until 2026-08-19, when `resolveFileRecord` started attaching
  // a `partial-witness:` marker — a scenario that recorded `executed-pass` for a
  // requirement it really did exercise, in a file whose LAST leg soft-skipped,
  // would have been stamped "may not have witnessed this" over its own explicit
  // finding. That would inject false positives into exactly the measurement the
  // marker exists to produce.
  //
  // So the comment describing this line was true of half the cases. It is true
  // of both now.
  if (!hasRequirement(fileRequirementId)) {
    try {
      recordRequirement(fileRequirementId, disposition, detail, { assertionCount, scenarioFile: file });
    } catch {
      /* never fail a file for bookkeeping */
    }
  }
  _fileStates.delete(file);
  _fileAssertions.delete(file);
  _ledgerMarks.delete(file);
  _itAllocators.delete(file);
  _itMarks.delete(file);
  _itAssertionsBefore.delete(file);
});

