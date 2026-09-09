#!/usr/bin/env node
/**
 * RFC 0173 §E.2 / RFC 0175 §F.1 — every SECURITY/threat-model-*.md carries the
 * template sections: "Why this model", "Trust boundaries", "Threats" (or
 * "Adversaries" + a per-surface threat table), "Residual risks",
 * "Verification", "References". threat-model-replay.md is the known five-section
 * file (RFC 0173 §E.2 adds §6–§8 in P3-D) and threat-model-interop.md is the
 * known-missing file (RFC 0175 §F.1, P3-D); both are listed as REQUIRED here so
 * the gate goes red until P3-D lands them — run with --pending to see the list
 * without failing (used by stage 10 until P3-D).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'SECURITY');
const REQUIRED = ['Why this model', 'Trust boundaries', /Threats|Adversaries/, 'Residual risks', 'Verification', 'References'];
const REQUIRED_FILES = ['threat-model-interop.md'];
const pending = process.argv.includes('--pending');
const failures = [];
const files = readdirSync(DIR).filter((f) => /^threat-model-.*\.md$/.test(f)).sort();
for (const f of REQUIRED_FILES) if (!files.includes(f)) failures.push(`SECURITY/${f} does not exist (RFC 0175 §F.1)`);
for (const f of files) {
  const heads = [...readFileSync(join(DIR, f), 'utf8').matchAll(/^##\s+(?:\d+\.\s*)?(.+)$/gm)].map((m) => m[1].trim());
  for (const r of REQUIRED) if (!heads.some((h) => (r instanceof RegExp ? r.test(h) : h.toLowerCase().startsWith(r.toLowerCase())))) failures.push(`SECURITY/${f}: missing section "${r instanceof RegExp ? r.source : r}"`);
}
if (failures.length) { console[pending ? 'log' : 'error'](`=== check-threat-model-template ${pending ? 'PENDING' : 'FAILED'} — ${failures.length} item(s) ===\n  ` + failures.join('\n  ')); process.exit(pending ? 0 : 1); }
console.log(`=== check-threat-model-template OK — ${files.length} threat model(s) carry the template sections ===`);
