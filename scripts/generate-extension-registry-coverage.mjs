#!/usr/bin/env node
/**
 * RFC 0155 §C — make "unlisted means uncovered" a CHECKED list, not a sentence.
 *
 * `spec/v1/extensions.json` covers the RFC 0147 program extensions and says of
 * everything else that it is unlisted and therefore uncovered. That is honest,
 * and it is also unmeasured: nothing said WHICH capability families were
 * uncovered, so the registry could not tell a reader how far from complete it
 * was, and a family could be added to `capabilities.schema.json` without the
 * registry noticing.
 *
 * This script derives, from the capability schema and the registry, a
 * `coverage` block:
 *
 *   coreFields[]  — top-level capability keys that are part of the
 *                   `openwop-discovery-core` predicate (`profiles.md`) and so are
 *                   CORE, not extensions;
 *   metadataFields[] — keys that describe the document/host (versions, identity,
 *                   hints to the suite, the production-profile claim) rather than
 *                   gate a feature; each carries a stated rationale;
 *   covered[]     — top-level families reached by some record's `capabilityPath`;
 *   uncovered[]   — every other top-level family. These are the extensions the
 *                   registry does NOT yet describe. Uncovered ≠ non-compliant;
 *                   it means no maturity/security/evidence record exists.
 *
 * Everything is DERIVED. Nothing is hand-listed. `--write` updates the block;
 * `--check` (the gate) fails if the block on disk differs from a fresh
 * derivation — so a new family cannot arrive unaccounted for.
 *
 *   node scripts/generate-extension-registry-coverage.mjs --write
 *   node scripts/generate-extension-registry-coverage.mjs --check
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CAPS = resolve(ROOT, 'schemas/capabilities.schema.json');
const REGISTRY = resolve(ROOT, 'spec/v1/extensions.json');

/** The discovery-core predicate's fields (`profiles.md` §openwop-discovery-core). */
const CORE_FIELDS = ['protocolVersion', 'supportedEnvelopes', 'schemaVersions', 'limits'];

/**
 * Discovery METADATA — top-level keys that describe the document or the host
 * (identity, versions, what the suite may assume, which profile is claimed)
 * rather than gate an optional wire feature. They are not extensions and never
 * get a maturity/security/evidence record; listing them here is what lets the
 * `uncovered` count reach zero honestly instead of by fiat. Each entry names
 * why it is metadata; a key that gates behaviour does NOT belong here.
 */
const METADATA_FIELDS = {
  engineVersion: 'server engine version axis (version-negotiation.md); a number, not a feature',
  eventLogSchemaVersion: 'per-run event-log schema axis (version-negotiation.md)',
  minClientVersion: 'minimum SDK version the server interops with; a pin, not a feature',
  implementation: 'server identity (name / version / vendor)',
  supportedTransports: 'transport list; REST is required regardless and gRPC has its own `grpc` family',
  fixtures: 'fixture workflow ids the host seeded — a hint to the suite about what it may drive',
  runtimeCapabilities: 'opaque ids NodeModules may `requires`; a vocabulary the host names, not a contract this corpus defines',
  configurable: 'per-run `RunOptions.configurable` overlay keys the server honours; a schema hint',
  extensions: 'per-canvas / per-workflow overrides (additional envelope types, override limits); an override slot, not a family',
  observability: 'hints about emitted spans/metrics/logs (observability.md); descriptive',
  testing: 'testing-mode advertisement (mock providers, seams) — for suites and dev clients, not a production feature',
  conformance: 'conformance-only typeIds the host registered (RFC 0023) — evidence apparatus, not a feature',
  compliance: 'which masking mode is in effect (closes O5) — describes an operator setting so clients can read `[REDACTED]` correctly',
  discovery: 'discovery-change-detection advertisement (capabilities-change-detection.md) — describes the discovery document itself',
};

export function derive() {
  const caps = JSON.parse(readFileSync(CAPS, 'utf8'));
  const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  const families = Object.keys(caps.properties ?? {}).sort();
  const coveredSet = new Set(
    (registry.extensions ?? []).map((e) => String(e.capabilityPath ?? '').split('.')[0]).filter(Boolean),
  );
  const coreFields = families.filter((f) => CORE_FIELDS.includes(f));
  const metadataFields = families.filter((f) => f in METADATA_FIELDS && !CORE_FIELDS.includes(f));
  const covered = families.filter((f) => coveredSet.has(f) && !CORE_FIELDS.includes(f) && !(f in METADATA_FIELDS));
  const uncovered = families.filter((f) => !coveredSet.has(f) && !CORE_FIELDS.includes(f) && !(f in METADATA_FIELDS));
  const metadataRationale = Object.fromEntries(metadataFields.map((f) => [f, METADATA_FIELDS[f]]));
  return {
    rule:
      'Derived by scripts/generate-extension-registry-coverage.mjs from the top-level keys of ' +
      'schemas/capabilities.schema.json. coreFields = the openwop-discovery-core predicate fields ' +
      '(profiles.md); metadataFields = keys that describe the document or host rather than gate an ' +
      'optional feature (each carries its rationale in metadataRationale; a key that gates behaviour ' +
      'may not be listed there); covered = extension families reached by some record capabilityPath; ' +
      'uncovered = every other family. Uncovered means no registry record exists — not that the ' +
      'family is non-compliant. Regenerate with --write; the gate runs --check.',
    familiesTotal: families.length,
    coreFields,
    metadataFields,
    metadataRationale,
    covered,
    uncovered,
  };
}

const mode = process.argv[2];
if (mode === '--write' || mode === '--check') {
  const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
  const fresh = derive();
  const onDisk = registry.coverage;
  const same = JSON.stringify(onDisk) === JSON.stringify(fresh);
  if (mode === '--check') {
    if (!same) {
      console.error('extension registry coverage is STALE — run: node scripts/generate-extension-registry-coverage.mjs --write');
      console.error(`  fresh: ${fresh.covered.length} covered / ${fresh.uncovered.length} uncovered / ${fresh.metadataFields.length} metadata of ${fresh.familiesTotal}`);
      process.exit(1);
    }
    console.log(`extension registry coverage is current: ${fresh.covered.length} covered / ${fresh.uncovered.length} uncovered / ${fresh.coreFields.length} core / ${fresh.metadataFields.length} metadata of ${fresh.familiesTotal} families`);
  } else {
    // Preserve key order: $comment, rfc, coverage, extensions.
    const out = { $comment: registry.$comment, rfc: registry.rfc, coverage: fresh, extensions: registry.extensions };
    // Match the file's existing serialization (ASCII with \uXXXX escapes) so the
    // diff is the coverage block and nothing else.
    const text = JSON.stringify(out, null, 2).replace(/[\u007f-\uffff]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
    writeFileSync(REGISTRY, text + '\n');
    console.log(`wrote coverage: ${fresh.covered.length} covered / ${fresh.uncovered.length} uncovered / ${fresh.coreFields.length} core of ${fresh.familiesTotal} families`);
  }
} else if (mode !== undefined) {
  console.error('usage: generate-extension-registry-coverage.mjs [--write|--check]');
  process.exit(2);
}
