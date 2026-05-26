// feature-dev — end-to-end change lifecycle for openwop
// ---------------------------------------------------------------------------
// Run by name (`feature-dev`), passing { feature, skipUx?, openPr?, reviewFloor? }
// (or just a one-line string = the feature). It launches as a background task —
// P pauses/resumes, X skips a subagent, stalled agents retry up to 5×.
//
// Each agent() below is a FRESH subagent in a clean context window. Results pass
// between phases as plain data held by THIS orchestrator and re-injected into the
// next prompt — never replayed through the launching session's context. That's
// the point: the 5,000-line RFC from /prd never taxes anyone's token window again.
//
// Flow:  /prd → /plan → /architect gate → /goal (implement until done) → build →
//        /code-review fix-loop → /ux-review (only if a UX surface changed) →
//        conformance + docs (parallel) → /nfr gate → /pr
//
// Parallel-session note (CLAUDE.md): this is a PROJECT file under
// .claude/workflows/, visible to every session on this checkout. It takes no
// shared-tree git locks; all git work is deferred to the /pr phase, whose
// subagent branches from origin/main in its own worktree.
//
// Repo mapping: /goal is the autonomous implementer — it keeps working the task
// until done, not stopping at the first checkpoint. /plan precedes it to produce
// the phased plan + acceptance criteria that /goal executes against. Skills are
// invoked by naming them in the agent prompt (the runtime has no `skill:` option).
// ---------------------------------------------------------------------------

export const meta = {
  name: 'feature-dev',
  description:
    'Drive an openwop change from RFC to merge-ready PR: prd → plan → architect ' +
    '→ implement → build → code-review → (ux-review) → conformance + docs → nfr → pr.',
  whenToUse:
    'A net-new openwop change that warrants an RFC: spec/schema additions, new ' +
    'conformance scenarios, host behavior. Overkill for a one-file typo fix.',
  phases: [
    { title: 'Author RFC',     detail: '/prd — five-architect pass',                 model: 'opus' },
    { title: 'Plan',           detail: '/plan — phases + acceptance criteria',        model: 'opus' },
    { title: 'Architect gate', detail: '/architect — design review before code',      model: 'opus' },
    { title: 'Goal',           detail: '/goal — autonomously implement until done',   model: 'opus' },
    { title: 'Build gate',     detail: '/ts-check until openwop:check is green',      model: 'sonnet' },
    { title: 'Code review',    detail: '/code-review fix-loop, token-bounded',        model: 'opus' },
    { title: 'UX review',      detail: '/ux-review — only if a UX surface changed',   model: 'sonnet' },
    { title: 'Sync',           detail: 'conformance + docs, in parallel',             model: 'sonnet' },
    { title: 'NFR gate',       detail: '/nfr — non-functional checklist',             model: 'opus' },
    { title: 'Open PR',        detail: '/pr — branch from origin/main, open PR',      model: 'sonnet' },
  ],
}

// ── args: arrives as object | string | undefined; normalize exactly once ────
const input =
  typeof args === 'string'
    ? (() => { try { return JSON.parse(args) } catch { return { feature: args } } })()
    : (args ?? {})

const feature     = input.feature ?? ''
const skipUx      = input.skipUx ?? false
const openPr      = input.openPr ?? true
const reviewFloor = input.reviewFloor ?? 50_000   // stop the review loop once budget dips below this
const MAX_REVIEW_ROUNDS = input.maxReviewRounds ?? 3   // hard cap — every loop needs one

if (!feature) throw new Error('feature-dev requires a `feature` description (object {feature} or a plain string).')

// ── structured returns: JSON Schema, validated by the runtime (AJV) ─────────
const S = {
  prd: {
    type: 'object',
    required: ['rfcPath', 'slug', 'summary'],
    properties: {
      rfcPath: { type: 'string' },          // RFCS/NNNN-<slug>.md
      slug:    { type: 'string' },
      summary: { type: 'string' },
      openGaps: { type: 'array', items: { type: 'string' } },
      risks:    { type: 'array', items: { type: 'string' } },
    },
  },
  plan: {
    type: 'object',
    required: ['changeClass', 'phases', 'uxNeeded'],
    properties: {
      changeClass: { type: 'string', enum: ['editorial', 'additive', 'safety-fix', 'breaking'] },
      phases: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'goal', 'files', 'acceptance'],
          properties: {
            id:   { type: 'string' },
            goal: { type: 'string' },
            files:      { type: 'array', items: { type: 'string' } },
            acceptance: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      uxNeeded: { type: 'boolean' },
      uxMode:   { type: 'string', enum: ['marketing-site', 'spec-prose'] },
    },
  },
  findings: {
    type: 'object',
    required: ['clean', 'blocking'],
    properties: {
      clean: { type: 'boolean' },
      blocking: {
        type: 'array',
        items: {
          type: 'object',
          required: ['issue', 'fix'],
          properties: {
            file:  { type: 'string' },
            line:  { type: 'number' },
            issue: { type: 'string' },
            fix:   { type: 'string' },
          },
        },
      },
      nits: { type: 'array', items: { type: 'string' } },
    },
  },
  changed: {
    type: 'object',
    required: ['files'],
    properties: {
      files:   { type: 'array', items: { type: 'string' } },
      summary: { type: 'string' },
    },
  },
  gate: {
    type: 'object',
    required: ['pass', 'details'],
    properties: { pass: { type: 'boolean' }, details: { type: 'string' } },
  },
}

// A change touches a UX surface when it edits the marketing site or human-read
// spec prose — the two modes of the /ux-review skill.
const UX_GLOBS = [
  /^public\//, /^site\//,                              // marketing-site mode
  /^spec\/v1\//, /^RFCS\//, /^README\.md$/,            // spec-prose mode
  /^CHANGELOG\.md$/, /^INTEROP-MATRIX\.md$/, /^ROADMAP\.md$/, /^docs\//,
]
const uxModeFor = (files) =>
  files.some((f) => /^public\/|^site\//.test(f)) ? 'marketing-site' : 'spec-prose'

const uniq = (xs) => [...new Set(xs)]

// ── Phase 1: /prd — author the RFC ──────────────────────────────────────────
const prd = await agent(
  `Use the /prd skill to author the openwop RFC for: ${feature}\n` +
  `Land RFCS/NNNN-<slug>.md plus its gap and risk registers.`,
  { phase: 'Author RFC', label: 'prd', schema: S.prd },
)
log(`RFC ${prd.rfcPath} — ${(prd.openGaps ?? []).length} open gaps, ${(prd.risks ?? []).length} risks`)

// ── Phase 2: /plan — phased plan + acceptance criteria for /goal to execute ─
const plan = await agent(
  `Use the /plan skill to produce a phased implementation plan with acceptance ` +
  `criteria for RFC ${prd.rfcPath}.\n` +
  `Summary: ${prd.summary}\nOpen gaps: ${(prd.openGaps ?? []).join('; ')}\n` +
  `Classify the change (editorial | additive | safety-fix | breaking) and set ` +
  `uxNeeded/uxMode if any marketing-site or spec-prose surface is in scope.`,
  { phase: 'Plan', label: 'plan', schema: S.plan },
)
log(`${plan.changeClass} change, ${plan.phases.length} implementation phases`)

// ── Phase 3: /architect — gate the design BEFORE writing code ───────────────
const arch = await agent(
  `Use the /architect skill to review this plan for wire-shape stability, ` +
  `capability gating, version negotiation, BYOK/replay safety, and SECURITY ` +
  `invariants. Set pass=false if any finding is blocking.\n` +
  `RFC: ${prd.rfcPath}\nPlan: ${JSON.stringify(plan)}`,
  { phase: 'Architect gate', label: 'architect', schema: S.gate },
)
if (!arch.pass) {
  log(`architect BLOCKED: ${arch.details}`)
  return { stoppedAt: 'architect', reason: arch.details, rfc: prd.rfcPath }
}
log('architect: design cleared')

// ── Phase 4: /goal — autonomously implement the plan until it is done ───────
// /goal is a self-driving skill: it works the task to completion rather than
// stopping at the first checkpoint, so it replaces a hand-orchestrated per-phase
// loop with one long-running agent. stallMs is raised well past the 180s default
// because an "until done" agent legitimately works long stretches between
// visible output, and we don't want the runtime to mistake that for a stall.
const goal = await agent(
  `Use the /goal skill to implement RFC ${prd.rfcPath} to completion. Do not stop ` +
  `until every acceptance criterion below is met.\n` +
  `Plan phases (work in order — later phases edit files earlier ones touch):\n` +
  `${JSON.stringify(plan.phases)}\n` +
  `Stage explicit paths only; never run git stash/clean/reset on the shared tree. ` +
  `Return the complete set of changed files.`,
  { phase: 'Goal', label: 'goal', schema: S.changed, model: 'opus', stallMs: 900_000 },
)
let touched = uniq(goal.files)
log(`goal: implemented to completion — ${touched.length} files changed`)

// ── Phase 5: build gate — /ts-check until `npm run openwop:check` is green ──
const build = await agent(
  `Use the /ts-check skill to resolve every type/lint/schema error at the root ` +
  `cause (no \`as any\`, no @ts-ignore/@ts-nocheck) until \`npm run openwop:check\` ` +
  `is fully green. Sandbox note: npx exits 194 here — run ` +
  `\`node node_modules/<pkg>/<entry>\` directly. Set pass=false if you cannot get green.`,
  { phase: 'Build gate', label: 'build', schema: S.gate },
)
if (!build.pass) {
  log(`build BLOCKED: ${build.details}`)
  return { stoppedAt: 'build', reason: build.details, rfc: prd.rfcPath, changed: touched }
}
log('build: openwop:check green')

// ── Phase 6: /code-review — fix-loop, bounded by the run's token budget ─────
// review → fix blocking findings → re-review. Exits clean, at the round cap, or
// when budget runs low. `budget.total` is falsy when the invoker set no ceiling.
let review = await agent(
  `Use the /code-review skill for a senior pass on the current diff. ` +
  `Zero-tolerance on banned suppression patterns and schema-discipline ` +
  `violations. Set clean=true only if nothing is blocking.`,
  { phase: 'Code review', label: 'code-review', schema: S.findings },
)
let rounds = 1
while (!review.clean && rounds < MAX_REVIEW_ROUNDS && budget.total && budget.remaining() > reviewFloor) {
  log(`code-review round ${rounds}: ${review.blocking.length} blocking — dispatching fixes`)
  const fix = await agent(
    `Fix exactly these blocking review findings at the root cause, then re-run ` +
    `\`npm run openwop:check\` before returning:\n${JSON.stringify(review.blocking)}`,
    { phase: 'Code review', label: `code-review:fix-${rounds}`, schema: S.changed },
  )
  touched = uniq([...touched, ...fix.files])
  rounds += 1
  review = await agent(
    `Use the /code-review skill to re-review the diff after the latest fixes. ` +
    `Set clean=true only if nothing is blocking.`,
    { phase: 'Code review', label: `code-review:round-${rounds}`, schema: S.findings },
  )
}
log(review.clean ? `code-review: clean after ${rounds} round(s)` : `code-review: budget low — ${review.blocking.length} blocking remain`)

// ── Phase 7: /ux-review — only when a UX surface actually changed ───────────
const uxFiles = touched.filter((f) => UX_GLOBS.some((re) => re.test(f)))
let ux = null
if (!skipUx && (uxFiles.length || plan.uxNeeded)) {
  const mode = plan.uxMode ?? uxModeFor(uxFiles)
  ux = await agent(
    `Use the /ux-review skill in ${mode} mode against these changed surfaces:\n` +
    `${uxFiles.join(', ') || '(plan flagged UX though no UX-glob file changed — audit the diff)'}\n` +
    `Set clean=true only if nothing is blocking.`,
    { phase: 'UX review', label: 'ux-review', schema: S.findings },
  )
  log(ux.clean ? `ux-review: clean (${mode})` : `ux-review: ${ux.blocking.length} blocking (${mode})`)
} else {
  log('ux-review: skipped — no UX surface in the diff')
}

// ── Phase 8: conformance + docs — independent, so run as a parallel barrier ─
// parallel() takes thunks and returns nulls for skipped/failed agents → filter.
const [conformance, docs] = (await parallel([
  () => agent(
    `Use the /update-conformance skill to sync the conformance suite to RFC ` +
    `${prd.rfcPath}: scenarios, fixtures + catalog, capability gating, CHANGELOG, ` +
    `and the suite version bump. pass=false if coverage is incomplete.`,
    { phase: 'Sync', label: 'conformance', schema: S.gate },
  ),
  () => agent(
    `Use the /update-docs skill to sync README doc index, CHANGELOG [Unreleased], ` +
    `RFCS status table, INTEROP-MATRIX, and ROADMAP to RFC ${prd.rfcPath}. ` +
    `Re-run the README-count + \`npm run protocol:status\` gate since an RFC was added.`,
    { phase: 'Sync', label: 'docs', schema: S.gate },
  ),
])).filter(Boolean)
log(`sync: conformance ${conformance?.pass ? '✓' : '✗'} · docs ${docs?.pass ? '✓' : '✗'}`)

// ── Phase 9: /nfr — non-functional gate before PR ───────────────────────────
const nfr = await agent(
  `Use the /nfr skill to run the non-functional checklist: spec hygiene, ` +
  `wire-shape compat, capability gating, conformance coverage, governance ` +
  `(DCO / RFC window / CHANGELOG), SECURITY + BYOK/replay invariants, and ` +
  `INTEROP-MATRIX honesty. pass=false blocks the PR.`,
  { phase: 'NFR gate', label: 'nfr', schema: S.gate },
)
if (!nfr.pass) {
  log(`nfr BLOCKED: ${nfr.details}`)
  return { stoppedAt: 'nfr', reason: nfr.details, rfc: prd.rfcPath, changed: touched }
}
log('nfr: clear')

// ── Phase 10: /pr — branch from origin/main in an isolated worktree, open PR ─
let pr = null
if (openPr) {
  pr = await agent(
    `Use the /pr skill to open the openwop PR: detect the lane, branch from ` +
    `origin/main, generate the body from the diff, enforce DCO + Conventional ` +
    `Commits + CHANGELOG + the 8-step openwop:check pre-flight, and apply the ` +
    `openwop-spec label if the spec corpus is touched. Return the PR url and branch.`,
    {
      phase: 'Open PR',
      label: 'pr',
      isolation: 'worktree',   // fresh git worktree — never touch the shared checkout's state
      schema: {
        type: 'object',
        required: ['url', 'branch'],
        properties: { url: { type: 'string' }, branch: { type: 'string' } },
      },
    },
  )
  log(`pr: ${pr.url}`)
} else {
  log('pr: skipped — openPr=false, stopping at green tree')
}

return {
  rfc: prd.rfcPath,
  changeClass: plan.changeClass,
  filesChanged: touched.length,
  reviewClean: review.clean,
  uxReviewed: Boolean(ux),
  pr: pr?.url ?? null,
}
