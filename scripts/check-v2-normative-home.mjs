#!/usr/bin/env node
/**
 * check-v2-normative-home — every v2 core family must have a normative home that
 * survives v1 end-of-support.
 *
 * ## The gap this measures
 *
 * `spec/v2/declaration.json` gives each family a `section` pointer, and for core
 * families that is `core/capabilities.md#<key>`. For most of them the section it
 * points at is a STUB. `§ toolHooks` reads, in full:
 *
 *     Witness `witnessable-gated`; owner RFC 0064.
 *
 * That is v2's deliberate shape, not neglect: `core/*.md` prose is capped at
 * 25,000 words (`check-core-budget.mjs`) and the tree currently sits at 24,998 —
 * two words of headroom. The kernel is a DECLARATION surface by construction, so
 * a family's behaviour is written somewhere else and the declaration names the
 * owning RFC.
 *
 * The consequence nothing measured: for 35 of 72 core families the "somewhere
 * else" is a document under `spec/v1/`. v1 is not retired — a host advertises
 * both majors through the overlap — but `evidence/v1-end-of-support.json` carries
 * a date. **On that date those families lose the only place their behaviour is
 * written out, and no gate would notice.** The capability keeps advertising, the
 * conformance floor keeps passing, and the prose a host implements against stops
 * being operative.
 *
 * ## What `normativeText` is, and why it is hand-declared
 *
 * `section` names the DECLARATION site. `normativeText` names where a reader
 * finds the BEHAVIOUR. They are different questions and only the first was
 * recorded.
 *
 * It is not derived, because derivation gets it wrong. The obvious heuristic —
 * the spec document an owning RFC references most — puts `toolHooks` in
 * `spec/v1/mcp-integration.md` (3 references) when its `perToolAuthorization`
 * rule is written in `spec/v1/host-capabilities.md`. Frequency is not authority.
 * The declaration is hand-reviewed source ("generated FROM nothing, checked
 * AGAINST everything"); this field follows that rule and this gate checks it.
 *
 * ## Three states, counted separately
 *
 *   RESOLVED     `normativeText` names a path outside `spec/v1/` that exists.
 *                Survives EOS.
 *   V1-DEPENDENT `normativeText` names a path under `spec/v1/`. Real, honest,
 *                and orphaned on the EOS date. Ratcheted: MUST NOT grow.
 *   UNDECLARED   no `normativeText`. Not "fine" — unmeasured. Ratcheted.
 *
 * A declared path that does not exist is a hard failure at any count: a pointer
 * to a missing file is worse than no pointer, because it reads as resolved.
 *
 * Both ratchets must reach zero before `endOfSupportNotBefore`. The gate prints
 * the days remaining so the number is a deadline rather than a statistic.
 *
 * Exit 0 when every pointer resolves and neither ratchet has grown; 1 otherwise.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DECL = join(ROOT, 'spec/v2/declaration.json');
const EOS = join(ROOT, 'evidence/v1-end-of-support.json');
const BASELINE = join(ROOT, 'docs/normative-home-baseline.json');

/** Today, injectable so the deadline arithmetic is testable. */
const NOW = process.env['OPENWOP_NORMATIVE_HOME_TODAY'] ?? new Date().toISOString().slice(0, 10);

const decl = JSON.parse(readFileSync(DECL, 'utf8'));
const families = [];
(function walk(x) {
  if (x && typeof x === 'object') {
    if (x.key && x.anchor && x.kind === 'family') families.push(x);
    for (const v of Object.values(x)) walk(v);
  }
})(decl);

const core = families.filter((f) => f.anchor === 'core');
process.stdout.write('=== check-v2-normative-home — does every core family survive v1 EOS? ===\n');

const resolved = [];
const v1dep = [];
const undeclared = [];
const missing = [];

const refused = [];
const unnamed = [];
const noObligation = [];
const unclaimed = [];
const facetsUncovered = [];

/** RFC 0189 §A — the legal home classes. */
const homeClass = (h) => {
  if (h === 'spec/v2/core/capabilities.md') return 'declaration-site';
  if (h.startsWith('spec/v2/core/')) return 'core';
  if (h.startsWith('spec/v2/ext/')) return 'ext';
  if (h.startsWith('schemas/v2/') || h.startsWith('spec/v2/facets/')) return 'schema';
  if (h.startsWith('spec/v1/')) return 'v1';
  if (h.startsWith('RFCS/')) return 'rfc';
  return 'refused';
};
const KEYWORD = /\b(MUST NOT|MUST|SHOULD NOT|SHOULD|MAY)\b/;
// RFC 0189 G5 — `-`, `_`, `.` and `/` are not word boundaries for a family key.
//
// The original predicate treated every non-alphanumeric as a boundary, so a key
// was "named" by any token that merely contained it. Measured at 2.13.0, six of
// the twenty families that satisfied §B(c) did so ONLY through this:
//   fs          <- "nodes are fs-gated"            (hyphen)
//   budget      <- "token_budget_exceeded"         (underscore)
//   i18n        <- "see i18n.md"                   (file extension) -- NOT CLOSED, see below
//   portability <- "spec/v2/ext/portability/"      (path segment)
//   workspace   <- "RunSnapshot.owner.workspace"   (field-path SUFFIX)
//
// The dot is asymmetric and that asymmetry is the whole rule: `runList.maxPageSize`
// genuinely names `runList` (family.facet), while `owner.workspace` does not name
// `workspace` (it is the tail of a field path). So a FOLLOWING dot counts only when
// what follows is a DECLARED FACET of that family; a PRECEDING dot never counts.
//
// Like G4 this strictly narrows and breaks no honest declaration — verified against
// WHAT G5 DOES NOT CLOSE, stated because an earlier version of this comment
// claimed otherwise. The trailing class `A` excludes `-`, `_` and `/` but NOT
// `.`, because a following dot must stay open for the `key.facet` arm. So a
// FOLLOWING dot still bleeds: "see i18n.md" names `i18n`, and
// `channelPresence.supported` names `channelPresence`. Only a PRECEDING dot
// is closed. Adding `.` to `A` was measured and breaks EIGHT honestly
// declared families (connections, oauth, multiAgent, toolHooks, ...) whose
// real mentions are `key.<something>` where <something> is not a declared
// facet. Recorded as G8 rather than left as a false claim in the file whose
// whole purpose is not making false claims.
//
// all 13 resolved families. It does not catch English homonyms ("MUST cache the
// result" still names `cache`); that is what the RFC 0191 marker and a reader are
// for, and RFC 0191 §B says so rather than claiming otherwise.
const namesKey = (text, key, facets = []) => {
  const B = '[^A-Za-z0-9\\-_/.]';        // a real boundary: not alnum, not - _ / .
  const A = '[^A-Za-z0-9\\-_/]';         // trailing: a dot may still open a facet ref
  if (new RegExp(`(^|${B})\`?${key}\`?($|${A})`).test(text)) return true;
  for (const f of facets) {
    if (new RegExp(`(^|${B})\`?${key}\\.${f}\\b`).test(text)) return true;
  }
  return false;
};

for (const f of core) {
  const homes = f.normativeText;
  if (!Array.isArray(homes) || homes.length === 0) {
    undeclared.push(f.key);
    continue;
  }
  let bad = false;
  let prose = '';
  let obligationProse = '';
  for (const h of homes) {
    const cls = homeClass(h);
    // §A — a declaration site cannot be its own behaviour home. Every core
    // family's `section` is ALREADY `core/capabilities.md#<key>`, and every one
    // of those bodies is a one-line stub, so allowing it would resolve all 72
    // for free and make the gate `section` spelled twice.
    if (cls === 'declaration-site') { refused.push(`${f.key} -> ${h} (the declaration site: capabilities.md § ${f.key} is a stub, not behaviour)`); bad = true; continue; }
    if (cls === 'rfc') { refused.push(`${f.key} -> ${h} (an RFC is history, not operative text; owningRfc already records it)`); bad = true; continue; }
    if (cls === 'refused') { refused.push(`${f.key} -> ${h} (not a normative home: only spec/v2/core, spec/v2/ext, a v2 schema as a CO-pointer, or spec/v1 as a declared dependency)`); bad = true; continue; }
    if (!existsSync(join(ROOT, h))) { missing.push(`${f.key} -> ${h}`); bad = true; continue; }
    // RFC 0189 G13 — a document that declares itself NON-NORMATIVE cannot be a
    // normative home. `spec/v1/structured-output-subset.md` is titled
    // "(informative)" and banners "Non-normative snapshot" — and it is the ONLY
    // prose site of `envelopes.tierOneSubsetCompliance` corpus-wide, so the
    // cheapest way to resolve `envelopes` was to declare an informative document
    // as operative prose. The gate checked only that a Status banner EXISTS, so
    // it would have accepted it, and the §D fallback would then assert at
    // end-of-support that an informative document is operative.
    {
      const banner = (readFileSync(join(ROOT, h), 'utf8').slice(0, 2000).split('\n').find((l) => /Status/.test(l)) ?? '');
      // A conformance-seam catalog is no more a behaviour home than an
      // informative document: spec/v1/host-sample-test-seams.md banners
      // "observation seams, not application endpoints", and its
      // multiPartyConversation bullet says in its own matched text that
      // RFC 0101 "mints no normative client wire-route".
      if (h.endsWith('host-sample-test-seams.md')) {
        refused.push(`${f.key} -> ${h} (a conformance-seam catalog is an observation surface, not a behaviour home)`);
        bad = true; continue;
      }
      if (/\binformative\b|\bNon-normative\b/i.test(banner)) {
        refused.push(`${f.key} -> ${h} (the document declares itself non-normative: ${banner.trim().slice(0, 90)})`);
        bad = true; continue;
      }
    }
    // RFC 0190 §B — `ext` is a CO-POINTER, never the target that carries the
    // family's obligation. spec/v2/ext/ is the UNWITNESSED TAIL (RFC 0174
    // §E.2), not a second kernel: letting it satisfy §B(b)/(c) resolved a core
    // family with zero words in core/ and no stub — and it resolved
    // `authorization` against thirteen unrelated ext READMEs, each of which
    // happens to carry the boilerplate "clients MUST NOT infer ... authorization
    // semantics from its presence". So ext prose contributes FACET COVERAGE
    // (§B(d)) and nothing else; the obligation must come from core/ or v1.
    if (cls !== 'schema') {
      const text = readFileSync(join(ROOT, h), 'utf8') + '\n';
      // RFC 0191 §A — the RECIPROCAL marker. A `spec/v2/**` home must itself
      // claim the family, in a `> **Normative home:** \`key\`.` line under its
      // Status banner (an ext README uses a `| **homes:** | \`key\` |` row, the
      // same shape check-declaration.mjs already requires for `witness:`).
      //
      // Why a marker and not a better regex: no syntactic predicate over prose
      // satisfies both constraints. Measured at 2.11.0, `replay` and `interrupt`
      // each have an obligation paragraph naming them in NINE core documents,
      // `idempotency` in eight, `packs` in seven including security-defaults.md
      // and versioning.md. Requiring backticks fails five of the eleven declared
      // families, because honest prose names a family in words ("connection
      // packs"); requiring the key in a heading fails six, for the same reason.
      // A concentration ratchet creates action-at-a-distance failures.
      //
      // So this does NOT make a false declaration impossible — it makes it
      // EXPLICIT, LOCAL and REVIEWABLE. The cheapest green path becomes writing
      // a false sentence into a document whose own prose contradicts it, in the
      // diff, in a file CODEOWNERS routes to the lead maintainer. Claiming more
      // than that would repeat the defect RFC 0189's Motivation exists to end.
      //
      // spec/v1/ targets are exempt: v1 prose is frozen-but-operative (§D) and
      // must not be edited for v2 bookkeeping. That buys nothing on the
      // burn-down, since open = v1Dependent + undeclared counts them either way.
      if (h.startsWith('spec/v2/')) {
        const claims = [...text.matchAll(/(?:\*\*Normative home:\*\*|\*\*homes:\*\*)([^\n|]*)/g)]
          .flatMap((m) => [...m[1].matchAll(/`([A-Za-z0-9_.-]+)`/g)].map((x) => x[1]));
        if (!claims.includes(f.key)) {
          unclaimed.push(`${f.key} -> ${h} (the document does not claim it — add a "> **Normative home:** \`${f.key}\`." line under its Status banner)`);
          bad = true;
          continue;
        }
      }
      prose += text;
      if (cls !== 'ext') obligationProse += text;
    }
  }
  if (bad) continue;
  // §A — a schema may co-point, never stand alone: RFC 0174 §E.2a parks
  // rationale in schema descriptions precisely because the budget does not
  // count them, and a schema-only home turns that escape into "no prose".
  if (prose === '') { refused.push(`${f.key} -> schema-only (a schema MAY co-point; it MUST NOT be the sole home — RFC 0174 §E.2a)`); continue; }
  if (obligationProse === '') { refused.push(`${f.key} -> ext-only (spec/v2/ext/ is the unwitnessed tail and MAY co-point; it MUST NOT be the sole home — RFC 0190 §B)`); continue; }
  // §B(b) — the target names the family.
  if (!namesKey(obligationProse, f.key)) { unnamed.push(`${f.key} (no core/ or v1 target names it — an ext co-pointer cannot carry the obligation, RFC 0190 §B)`); continue; }
  // §B(c) — an obligation ABOUT the family: a 2119 keyword in a paragraph that
  // also names it. Document scope would pass on almost any v2 core doc.
  // RFC 0189 G4 — a markdown TABLE is not one paragraph.
  //
  // `split(/\n\s*\n/)` collapsed an entire table into a single block, so a
  // MUST anywhere in it satisfied EVERY family named anywhere in it. Measured:
  // `versioning.md`'s 18-axis disposition table is one 20-line "paragraph";
  // `multiAgent` (row 13) and `schemaVersions` (row 6) were both satisfied by
  // the MUST in row 15, which is about `minClientVersion`. Both rows name
  // `events.md` as their owner in their own Owner column, and events.md
  // mentions neither family. The gate green-lit both declarations.
  //
  // Eleven of the still-undeclared families have a table-only match waiting.
  // Splitting table rows into their own units strictly NARROWS the predicate:
  // no honestly declared family relies on a cross-row match, so unlike the four
  // tightenings RFC 0191 measured and rejected, this one breaks nothing.
  // RFC 0189 G10 — an obligation inside a section TITLED for the family is an
  // obligation about that family.
  //
  // G4 split table rows apart so a MUST in row 15 could not satisfy a family
  // named in row 6. Correct, and it had a cost nobody measured: it also severed
  // rows from the SECTION HEADING that scopes them. `spec/v1/host-capabilities.md`
  // carries `## §host.kvStorage`, `## §host.blobStorage`, `## §host.vectorStore`
  // and five more — each a real contract with three to five MUSTs, every one of
  // them a table row reading "A `get` for tenant A MUST NOT return values written
  // by tenant B". The family's name is in the heading; the obligation is in the
  // row; G4 put them in different units and the gate concluded the contract did
  // not exist. Seven families looked like they needed a design decision about
  // where a host service lives in v2, when their contract was already written.
  //
  // The heading must be TITLED for the family — `## §host.kvStorage`, `### § packs`,
  // `## \`replay\`` — not merely mention it. A heading that happens to contain the
  // word is the G1 homonym hazard one level up; requiring the heading to BE the
  // family's section title is the narrow form, and `host.` is admitted because it
  // is the v1 capability namespace these sections are named in.
  const titledFor = (h, k) => new RegExp(`^#{1,6}\\s*§?\\s*\`?(?:host\\.)?${k}\`?\\s*$`).test(h.trim());
  // RFC 0189 G12 — a fenced code block is an illustrative shape, not an
  // obligation. Before G10 such a block was usually self-blocking: it spells the
  // family `ctx.<key>.…`, and G5 refuses a preceding dot. G10 made the HEADING
  // supply the name, so any `## §host.<key>` section opening with a TypeScript
  // sketch containing a stray MUST/SHOULD/MAY in a comment now satisfies §B(c) —
  // `host-capabilities.md`'s §host.secrets block does exactly that via a
  // "pack SHOULD treat as advisory" comment. Measured: stripping fenced blocks
  // costs ZERO currently-declared families. Strictly narrowing.
  const obligationText = obligationProse.replace(/^```[\s\S]*?^```[^\n]*$/gm, '\n');
  const paras = [];
  {
    let heading = '';
    for (const block of obligationText.split(/\n\s*\n/)) {
      const lines = block.split('\n').filter((l) => l.trim() !== '');
      if (lines.length && /^#{1,6}\s/.test(lines[0].trim())) heading = lines[0];
      // RFC 0189 G14 — a BULLET LIST is not one paragraph either.
      //
      // G4 split tables so a MUST in row 15 could not satisfy a family named in
      // row 6. It did not split bullet lists, and the same exploit lives one
      // syntax down: in spec/v1/ai-envelope.md the `envelopeContracts.advertised`
      // bullet carries NO 2119 keyword, and passed §B(c) only because the
      // ADJACENT `envelopeStrictness` bullet says "MUST cause refusal". That
      // declaration shipped in 2.21.0 and this is what catches it.
      //
      // Unlike G4 and G12 this is not free: it removes 27 pre-existing candidate
      // pairs and breaks exactly one declared family — the one that is false.
      const isTable = lines.length > 1 && lines.every((l) => l.trim().startsWith('|'));
      const isList = lines.length > 1 && lines.every((l) => /^\s*([-*+]|\d+\.)\s/.test(l));
      for (const unit of (isTable || isList ? lines : [block])) paras.push({ text: unit, heading });
    }
  }
  if (!paras.some((q) => KEYWORD.test(q.text) && (namesKey(q.text, f.key) || titledFor(q.heading, f.key)))) { noObligation.push(`${f.key} (named, but no MUST/SHOULD/MAY in a paragraph that names it, nor under a section titled for it)`); continue; }
  // §B(d) — facet completeness, counted rather than failed (see the ratchet).
  // A facet is legitimately named EITHER bare (`packsSupported`) or, far more
  // often, qualified by its family (`connections.packsSupported`). G5's rule that
  // a PRECEDING dot does not name a key is right for a family — `owner.workspace`
  // is not the `workspace` family — and exactly wrong for a facet, where
  // `family.facet` is the canonical form. So accept the qualified spelling too.
  const namesFacet = (text, key, facet) =>
    namesKey(text, facet) || new RegExp(`(^|[^A-Za-z0-9\\-_/])${key}\\.${facet}\\b`).test(text);
  // RFC 0189 G15 was PROPOSED and REJECTED on measurement. The proposal was to
  // strip fenced blocks from the facet arm as G12 does for the obligation arm,
  // on the claim that it costs zero declared families. Measured: it breaks
  // SIXTEEN facets — credentials.encryptionAtRest, oauth.grants,
  // kvStorage.maxTtlSeconds and thirteen more — every one of them named in a
  // JSON ADVERTISEMENT EXAMPLE, which is precisely how a facet is legitimately
  // named. §B(d) is a naming count by design, not an obligation check, so the
  // two arms are not symmetric: a code block cannot carry an obligation, but it
  // can perfectly well name a field. The `aiEnvelope.await` case that motivated
  // the proposal is a HOMONYM, not a fence problem, and stripping fences is the
  // wrong instrument for it.
  for (const facet of f.facets ?? []) if (!namesFacet(prose, f.key, facet)) facetsUncovered.push(`${f.key}.${facet}`);
  if (homes.some((h) => h.startsWith('spec/v1/'))) v1dep.push(f.key);
  else resolved.push(f.key);
}

process.stdout.write(
  `  ${core.length} core families: ${resolved.length} resolved, ${v1dep.length} v1-dependent, ${undeclared.length} undeclared.\n`,
);

// RFC 0189 §B — a declared home that is not a home, or does not carry an
// obligation about its family, reads as resolved and is not. Hard fail: unlike
// the counters below, these are authoring errors, not debt.
const predicateFailures = [...refused, ...unnamed, ...noObligation, ...unclaimed];
if (predicateFailures.length > 0) {
  process.stdout.write(`\n  FAIL — ${predicateFailures.length} normativeText declaration(s) do not carry their family's behaviour:\n`);
  for (const m of predicateFailures) process.stdout.write(`    ${m}\n`);
  process.stdout.write('  A declared home must NAME the family and carry an RFC 2119 obligation about it\n  in the same paragraph. `existsSync` alone let README.md resolve all 72.\n');
  process.exit(1);
}

// A pointer to a file that does not exist reads as resolved. Never tolerated.
if (missing.length > 0) {
  process.stdout.write(`\n  FAIL — ${missing.length} normativeText path(s) do not exist:\n`);
  for (const m of missing) process.stdout.write(`    ${m}\n`);
  process.stdout.write('  A pointer to a missing file is worse than no pointer: it reads as resolved.\n');
  process.exit(1);
}

let base0 = { v1Dependent: v1dep.length, undeclared: undeclared.length, facetsUncovered: facetsUncovered.length };
if (existsSync(BASELINE)) base0 = JSON.parse(readFileSync(BASELINE, 'utf8'));

let eosDate = null;
try {
  eosDate = JSON.parse(readFileSync(EOS, 'utf8')).endOfSupportNotBefore ?? null;
} catch { /* clock absent — the ratchets still hold, the deadline is just unknown */ }

if (eosDate) {
  const days = Math.round((Date.parse(eosDate) - Date.parse(NOW)) / 86_400_000);
  // RFC 0189 §D / G9 (REOPENED) — the burn-down measures what §D makes FATAL.
  //
  // This counted `v1dep + undeclared`, which is STRICTER than the terminal
  // predicate it schedules: at end-of-support `fatal = undeclared + uncarried +
  // broken`, so a CARRIED v1-dependent family is acceptable. The daily clock was
  // demanding v2 text for families §D says are fine.
  //
  // RFC 0190 §C rejected aligning them, reasoning that `v1Carried` is hand-written
  // and excluding it would make "add your family to v1Carried" a zero-work way to
  // lower the count. THAT PREMISE IS NO LONGER TRUE, and it was falsified by work
  // that landed after it: G7 requires `v1Carried` to EQUAL the computed
  // v1-dependent set, and §B(b)/(c) + G5 require the v1 target to genuinely name
  // the family and carry a 2119 obligation about it — the same predicate a v2
  // resolution must pass. Sabotage-proved: pointing `promptLibrary` at an
  // unrelated v1 document is refused by name. There is no hatch left to close.
  //
  // So the two are aligned, deliberately and with the reason recorded. This is
  // not schedule relief: `v1Dependent` remains reported and unconstrained
  // upward only because §C is right that punishing the first honest declaration
  // is what made silence cheapest. What changed is which number the CALENDAR is
  // attached to.
  const uncarriedNow = v1dep.filter((k) => !(base0.v1Carried ?? []).includes(k));
  const open = undeclared.length + uncarriedNow.length;
  process.stdout.write(`  v1 end-of-support not before ${eosDate} — ${days} day(s) from ${NOW}.\n`);
  if (open > 0) {
    // RFC 0189 §D. The line this replaces said the count "becomes one on the
    // date, silently" — and the comparison did not exist, nor did any scheduled
    // job run this gate, so it could not have. A gate that describes a check it
    // does not perform is the defect this corpus keeps finding in others.
    process.stdout.write(
      `  ${undeclared.length} famil(ies) have NO declared home; ${v1dep.length} declare one that dies with v1.\n` +
        '  Not a failure on a PR: this gate runs the ratchets there, never the clock.\n' +
        '  The clock runs daily on main under --deadline, as a BURN-DOWN rather than\n' +
        '  a cliff: a schedule that only fails on the last day is a statistic.\n',
    );
  }
  // RFC 0190 §C — `v1Carried` must equal the computed v1-dependent set.
  //
  // §C leaves `v1Dependent` unconstrained UPWARD on purpose, so a family may
  // legally become v1-dependent at any time. Nothing checked that it also
  // entered `v1Carried` — and `v1Carried` is what the §D fallback covers. A
  // family could therefore be v1-dependent, uncovered by the fallback, and
  // green until the day the fallback ran. This is the same class as the
  // fallback that was printed and never applied: a list whose membership
  // nothing maintained.
  {
    const carried = new Set(base0.v1Carried ?? []);
    const missing = v1dep.filter((k) => !carried.has(k));
    const stale = [...carried].filter((k) => !v1dep.includes(k));
    if (missing.length || stale.length) {
      process.stdout.write('\n  FAIL — docs/normative-home-baseline.json `v1Carried` does not match the\n  computed v1-dependent set, and `v1Carried` is what the RFC 0189 §D fallback covers:\n');
      for (const k of missing) process.stdout.write(`    ${k}: v1-dependent but NOT listed — the fallback would not cover it\n`);
      for (const k of stale) process.stdout.write(`    ${k}: listed but no longer v1-dependent — remove it\n`);
      process.exit(1);
    }
  }

  // --deadline: opt-in, so a contributor's unrelated PR never reds on a calendar.
  if (process.argv.includes('--deadline') && open > 0) {
    const t0 = base0.t0 ?? null;
    const openAtT0 = base0.openAtT0 ?? open;
    if (Date.parse(NOW) >= Date.parse(eosDate)) {
      // RFC 0190 §C — APPLY the §D fallback rather than printing it.
      //
      // This branch used to describe the fallback and then exit 1 regardless:
      // `v1Carried` was read into base0 and never used, and nothing ever checked
      // whether a carried target had been deleted or had its Status banner
      // changed. So on 2026-12-04 the daily job would have gone permanently red
      // even in the world §D calls acceptable — which is precisely the defect
      // RFC 0189's own Motivation exists to end ("a sentence describing a check
      // the code did not perform"). It was committed by the RFC that named it.
      //
      // §D's actual rule: at end-of-support spec/v1/** is FROZEN-BUT-OPERATIVE
      // for exactly the families in `v1Carried`. End-of-support ends new v1 wire
      // support; it does not de-normativize prose a v2 family still points at.
      // So after the date this fails on two things only: a family still
      // undeclared, or a carried target deleted / its Status banner changed.
      const carried = new Set(base0.v1Carried ?? []);
      const banners = base0.v1Banners ?? {};
      const uncarried = v1dep.filter((k) => !carried.has(k));
      const broken = [];
      for (const f of core) {
        if (!carried.has(f.key)) continue;
        for (const h of f.normativeText ?? []) {
          if (!h.startsWith('spec/v1/')) continue;
          const abs = join(ROOT, h);
          if (!existsSync(abs)) { broken.push(`${f.key} -> ${h} (DELETED)`); continue; }
          const head = readFileSync(abs, 'utf8').slice(0, 2000);
          const banner = (head.split('\n').find((l) => /Status/.test(l)) ?? '').trim();
          // §D fails after the date only if a carried target is DELETED or its
          // banner CHANGES. Testing /Stable|FINAL/ tested the banner's STATE, a
          // different question — and it already failed on the pristine tree:
          // spec/v1/multi-agent-execution.md has read `Status: Draft` since long
          // before `multiAgent` was carried into it, so a banner that never changed
          // failed a check whose only purpose is to notice change. Compare against
          // the banner recorded at declaration time instead.
          if (!/\*\*Status:?\*\*|Status:/.test(head)) broken.push(`${f.key} -> ${h} (no Status banner)`);
          else if (banners[h] === undefined) {
            broken.push(`${f.key} -> ${h} (carried with no recorded banner — add it to \`v1Banners\` in docs/normative-home-baseline.json so a later change is detectable)`);
          } else if (banners[h] !== banner) {
            broken.push(`${f.key} -> ${h} (Status banner CHANGED since it was carried)\n      was: ${banners[h].slice(0, 90)}\n      now: ${banner.slice(0, 90)}`);
          }
        }
      }
      const fatal = [...undeclared.map((k) => `${k} (no declared home)`), ...uncarried.map((k) => `${k} (v1-dependent but not in v1Carried)`), ...broken];
      if (fatal.length === 0) {
        process.stdout.write(`\n  v1 end-of-support (${eosDate}) has passed. RFC 0189 §D fallback APPLIES: every\n  remaining family points into spec/v1/**, which is frozen-but-operative for the\n  ${carried.size} famil(ies) in \`v1Carried\`, and every target still exists with a Stable\n  banner. This is the world §D calls acceptable, so it is not a failure.\n`);
      } else {
        process.stdout.write(`\n  FAIL — v1 end-of-support (${eosDate}) has passed and the §D fallback does NOT cover:\n`);
        for (const m of fatal) process.stdout.write(`    ${m}\n`);
        process.exit(1);
      }
    }
    if (t0) {
      const span = Date.parse(eosDate) - Date.parse(t0);
      const left = Date.parse(eosDate) - Date.parse(NOW);
      const allowed = Math.ceil(openAtT0 * (left / span));
      process.stdout.write(`  burn-down: ${open} open, ${allowed} allowed at this point on the schedule (${openAtT0} at t0 ${t0}).\n`);
      if (open > allowed) {
        process.stdout.write(`\n  FAIL — behind the burn-down: ${open} open against ${allowed} allowed.\n  Detected the week it slips rather than on the day nothing can be done.\n`);
        process.exit(1);
      }
    }
  }
}

const base = base0;

// RFC 0189 §C. The old rule failed when `v1Dependent` ROSE — which is exactly
// what the first HONEST declaration does: moving a family from `undeclared` to
// `v1-dependent` gains information and leaves total debt unchanged, and the
// gate exited 1 on it. So the cheapest way to stay green was to declare
// nothing, on 70 of 72 rows. Now: `undeclared` may never rise, and the SUM may
// never rise; `v1Dependent` alone is unconstrained upward.
const grew = [];
const du = undeclared.length - base.undeclared;
const dv = v1dep.length - base.v1Dependent;
if (du > 0) grew.push(`undeclared ${base.undeclared} -> ${undeclared.length} (a core family with no declared home is new debt)`);
if (du + dv > 0) grew.push(`total open debt ${base.undeclared + base.v1Dependent} -> ${undeclared.length + v1dep.length}`);
if (facetsUncovered.length > (base.facetsUncovered ?? facetsUncovered.length)) grew.push(`facets with no normative text ${base.facetsUncovered} -> ${facetsUncovered.length} (${facetsUncovered.slice(0, 4).join(', ')})`);

if (grew.length > 0) {
  process.stdout.write(`\n  FAIL — a ratchet grew: ${grew.join('; ')}.\n`);
  process.stdout.write(
    '  A new core family whose behaviour is written only in spec/v1/, or with no\n' +
      '  declared home at all, adds to a debt that comes due on the EOS date.\n' +
      '  Declare `normativeText` pointing outside spec/v1/, or lower nothing.\n',
  );
  process.exit(1);
}

if (undeclared.length + v1dep.length < base.undeclared + base.v1Dependent || facetsUncovered.length < (base.facetsUncovered ?? facetsUncovered.length)) {
  process.stdout.write(
    `\n  Improved: v1-dependent ${base.v1Dependent} -> ${v1dep.length}, undeclared ${base.undeclared} -> ${undeclared.length}.\n` +
      `  Lower the baseline in ${BASELINE.replace(ROOT + '/', '')} so the gain is held.\n`,
  );
  process.exit(1);
}

process.stdout.write('\n=== check-v2-normative-home OK — pointers resolve; ratchets at baseline ===\n');
process.exit(0);
