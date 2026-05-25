# OpenWOP Implementation Certification

> GOV-4 from `plans/openwop-protocol-gap-closure-plan.md`. How a host author publishes a conformance claim that third parties can audit, reproduce, and pin to a commit hash.

There is no central certifying body. The protocol's "certification" is **reproducible mechanical evidence + a public row in the interop matrix**. A claim is credible because anyone can run the same conformance suite against your host and get the same result.

This page is the protocol-side contract for what a credible claim looks like.

---

## What you publish

To claim a conformance posture, your host's repo MUST publish:

### 1. A `conformance.md` (or equivalent) evidence file

One file per host implementation. Required fields:

```markdown
# <Host Name> — Conformance Evidence

> Suite version: `@openwop/openwop-conformance@<version>`
> Measured: <ISO-8601 date>
> Host commit: <full sha>
> Strict mode: <yes/no>
> Opt-outs: <comma-separated profile names if any>

## Profile claims

- openwop-core
- openwop-stream-sse
- (etc.)

## Pass / fail / skip / todo

| | Count |
|---|---:|
| Passed | <N> |
| Failed | <N> |
| Skipped | <N> |
| Todo | <N> |
| Total | <N> |

## Command

```bash
OPENWOP_BASE_URL=<your-test-url> \
OPENWOP_API_KEY=<your-test-key> \
OPENWOP_REQUIRE_BEHAVIOR=true \
OPENWOP_OPTED_OUT_PROFILES=<opt-outs> \
npx openwop-conformance
```

## Notes (optional)

Per-failure rationale, known flakes, host-specific seam env vars (e.g.,
OPENWOP_TEST_TRIGGER_COMPACTION=true for RFC 0012 conformance).
```

The Postgres reference host's [`conformance-full.md`](../examples/hosts/postgres/conformance-full.md) is the canonical reference shape.

### 2. A row in [`INTEROP-MATRIX.md`](../INTEROP-MATRIX.md)

PR your row to this repo's `INTEROP-MATRIX.md`. Required columns:

| Column | What it carries |
|---|---|
| Host name | The product / project name (not a marketing slogan). |
| Positioning | One sentence: who is this host for? |
| Source pointer | Repo URL or `examples/hosts/*/` path. |
| Profiles claimed | Exact strings from your `capabilities.auth.profiles[]` + capability advertisements. |
| Scale tier | `minimal` / `production` / `high-throughput` per [`spec/v1/scale-profiles.md`](../spec/v1/scale-profiles.md). |
| `openwop-production` claim | Claimed / Not claimed — be honest. Don't claim if you don't pass the production-profile scenarios. |
| Evidence pointer | URL or relative path to your `conformance.md`. |

Maintainer review verifies the claim chain end-to-end:
- Your `conformance.md` cites a real suite version.
- The opt-outs in your command match your profile-not-claimed declarations.
- The pass count is consistent with the scenario count at the suite version you cited.
- Strict-mode profiles you claim pass under strict mode (no honest-opt-out leakage).

### 3. A pinned commit hash

Your claim is anchored to your host's commit at measurement time. PRs that update an existing row should bump the pinned commit + remeasure.

---

## Profile claim rules

The honesty principle is unbreakable:

1. **Advertise only what you implement.** Strict-mode conformance is the ground-truth gate. If you advertise `openwop-auth-mtls` and your transport doesn't actually verify client certs, your scenario fails.
2. **Opt out honestly.** Profiles you choose NOT to implement go in `OPENWOP_OPTED_OUT_PROFILES`. Strict mode treats opt-outs as PASS (logged as "honest opt-out"), so minimal hosts can still hit strict-mode green. Advertising AND opting out the same profile surfaces a warning — fix one side.
3. **`openwop-production` is more than a profile string.** It's a behavioral contract (RFC 0009): backpressure 503 + retention sweep + claim acquisition + audit-log integrity + every claimed auth profile under strict mode. Don't claim it lightly.

See [`docs/PROFILE-DECISION-GUIDE.md`](./PROFILE-DECISION-GUIDE.md) for which profiles to claim in what order.

---

## Maintenance

A conformance row decays. Maintain it:

- **Re-measure on suite minor bumps.** New conformance scenarios land additively; your old pass count may shift. Re-run the suite and bump your row's pinned commit + suite version.
- **Re-measure on host commits that touch the wire surface.** Any change to your host's discovery, auth, run lifecycle, event log, or pack consumption SHOULD trigger a re-measurement.
- **Document known flakes.** If a scenario passes in isolation but fails under full-suite parallel execution, document it in your `conformance.md` notes (per the Postgres host's `webhook-signed-delivery` precedent).
- **Don't game opt-outs.** A `non_testability_rationale` exists for invariants that cannot be mechanically verified; profile opt-outs exist for profiles you choose not to implement. Don't use opt-outs to mask a real bug.

---

## Badge convention (optional, GOV-3 follow-up)

Hosts MAY display a conformance badge linking to their `conformance.md`. Canonical badge URL pattern (when GOV-3 lands the hosted leaderboard):

```
https://openwop.dev/badges/<hostId>/<suite-version>.svg
```

Until the hosted leaderboard ships, hosts MAY produce a static SVG and host it in their own repo per the badge-generation convention embedded in `site/src/build.mjs`.

---

## What this is NOT

- **Not a vendor seal.** Anyone can run the conformance suite; anyone can publish a row. The credibility is in the mechanical evidence, not in an authority.
- **Not a security audit.** The conformance suite checks protocol behavior; it does NOT replace the external security audit at `SECURITY/external-audit-engagement.md`.
- **Not a runtime certification.** OpenWOP doesn't certify performance, scalability, or SLA — just protocol conformance.

---

## See also

- [`docs/IMPLEMENTER-PATH.md`](./IMPLEMENTER-PATH.md) — full path from "what is OpenWOP" to "row in INTEROP-MATRIX".
- [`docs/PROFILE-DECISION-GUIDE.md`](./PROFILE-DECISION-GUIDE.md) — which profiles to claim.
- [`docs/KNOWN-LIMITS.md`](./KNOWN-LIMITS.md) — what's not yet covered.
- [`examples/hosts/postgres/conformance-full.md`](../examples/hosts/postgres/conformance-full.md) — canonical `conformance.md` shape.
- [`INTEROP-MATRIX.md`](../INTEROP-MATRIX.md) — public host roster.
- [`conformance/coverage.md`](../conformance/coverage.md) §"Capability-gated scenarios" — which scenarios light up per advertised capability.
