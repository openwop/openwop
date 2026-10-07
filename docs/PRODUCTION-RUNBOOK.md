# Production Runbook

> Informative. An operator checklist for running an OpenWOP v2 host that claims the `production` profile. It adds no obligation. The normative bar is [`spec/v2/core/conformance.md`](../spec/v2/core/conformance.md) §"Production profile" (RFC 0009).

`production` is a behavioral contract, not a string in your discovery document. This page is the checklist for meeting it. If you are building a host from scratch, start with [`IMPLEMENTER-PATH.md`](./IMPLEMENTER-PATH.md); this page assumes the basics work.

Configuration names (environment variables, file paths) are host-specific. Example and reference hosts, with their own operator READMEs, live in [openwop/openwop-examples](https://github.com/openwop/openwop-examples).

---

## What `production` requires

From `conformance.md` §"Production profile", a host claiming it:

1. passes `openwop-core-standard`, publishes the suite version and command it ran, and documents every optional profile it claims;
2. serves the events channel or poll, and should serve both ([`events.md`](../spec/v2/core/events.md));
3. persists run state and event logs outside process memory, replayable after a restart, including recovery of stale claims;
4. tolerates at least five retries of one `Idempotency-Key` within its retention window ([`idempotency.md`](../spec/v2/core/idempotency.md));
5. logs run id, tenant or project id, terminal status, error code and correlation id for each run, and should export the `openwop.*` OpenTelemetry spans and metrics.

And its three facets:

| Facet | What you operate |
| --- | --- |
| `backpressure` | At capacity, answer `503 service_unavailable` with `Retry-After`. Omit the header for a hold longer than 24 hours. |
| `retention` | Document event-log retention, at least 7 days for snapshots and events unless the host is labelled development-only. An expired run answers `404 not_found` or `410 run_expired`, preferably `410` when you know it expired. |
| `debugBundle` | Debug bundles ([`schemas/v2/debug-bundle.schema.json`](../schemas/v2/debug-bundle.schema.json)) redact secrets and tokens and mark truncation explicitly. Document your truncation limits. |

### Durability is evidence, not a flag

[`persistence.md`](../spec/v2/core/persistence.md) §"Durable acceptance and recovery" binds every host that accepts work: make accepted work durable in the same transaction as its record, separate liveness from duration bounds, **declare a recovery bound per enforcing mechanism**, dedupe duplicate delivery, and drive poison work to a terminal state.

A durability rung (`durable-single-instance`, `durable-multi-instance`, `multi-region-qualified`) is claimed only with the evidence RFC 0158 §D names, from tests in which a process was actually terminated. Discovery carries no rung; the certification bundle does ([`conformance.md`](../spec/v2/core/conformance.md) §"Bundle v3").

---

## Verify the claim

Run the suite in behavioral mode against the deployed host ([`conformance/README.md`](../conformance/README.md) has the full flag reference):

```bash
npx @openwop/openwop-conformance \
  --base-url https://your-host.example.com \
  --api-key "$OPENWOP_CONFORMANCE_KEY" \
  --target-major 2 \
  --require-behavior
```

`--certify` writes a signed bundle you can publish as evidence. Any profile you do not implement must be declared as an opt-out; never let a soft-skipped scenario stand in for one you claim. A `blocked` row denies certification ([`conformance.md`](../spec/v2/core/conformance.md) §"Certification"), so preflight every opt-in surface before you cut a bundle.

Scenarios to watch for this profile include `v2-production-backpressure`, `audit-log-integrity` and `audit-checkpoint-signature` (when you advertise `auditLogIntegrity`), and the scenario for each authentication lane you advertise.

---

## Limits to advertise honestly

`limits` and its run-level clamps are defined in [`runs.md`](../spec/v2/core/runs.md). Advertise what you actually enforce:

| Limit | What it controls |
| --- | --- |
| `limits.maxNodeExecutions` | Node starts per run; a breach emits `cap.breached` and fails with `recursion_limit_exceeded`. |
| `limits.maxRunDurationMs` | Wall clock per run from `run.started`; a breach fails with `run_timeout`. |
| `limits.maxLoopIterations` | Orchestrator turns; a breach fails with `loop_limit_exceeded`. |
| `limits.envelopesPerTurn`, `clarificationRounds`, `schemaRounds` | Per-turn, per-task and per-envelope caps. |

Your in-flight cap, the point at which `backpressure` starts answering `503`, is a host setting. Choose it from load testing, not a guess.

---

## Observability

- Export OpenTelemetry traces and metrics under the `openwop.*` namespace.
- Propagate W3C Trace Context on onward hops as [`interop.md`](../spec/v2/core/interop.md) §"Trace context" describes. Trace context is never an authorization input.
- Emit one structured log line per terminal run with the fields `production` requires.

---

## Routine checks

| Check | How |
| --- | --- |
| Backpressure | Track the `503` rate against your in-flight cap. |
| Retention | Confirm runs past the window answer `410 run_expired` or `404`, and that the sweeper runs on schedule. |
| Audit checkpoints | If you advertise `auditLogIntegrity`, check checkpoint cadence against `checkpointIntervalEntries` and `checkpointIntervalSeconds`, and verify an exported checkpoint set from an independent machine with `node scripts/verify-audit-checkpoints.mjs <bundle>`. |
| Webhooks | Watch dead-letter volume; receivers verify signatures ([`webhooks.md`](../spec/v2/core/webhooks.md)). |
| Stream longevity | Run `node conformance/soak/sse-longevity.mjs` for 10 to 30 minutes; alert when the longest quiet gap exceeds your heartbeat interval or reconnects occur. |
| Load | Run `node conformance/soak/load-profile.mjs` against a non-production replica before each release; compare create-run latency percentiles with the previous release. |
| Conformance drift | Re-run the behavioral suite on a schedule and after every deploy. |

---

## See also

- [`SECURITY-OPERATOR-GUIDE.md`](./SECURITY-OPERATOR-GUIDE.md): the security surfaces to turn on.
- [`IMPLEMENTER-PATH.md`](./IMPLEMENTER-PATH.md): getting started.
- [`spec/v2/core/conformance.md`](../spec/v2/core/conformance.md): the profile, bundle v3 and certification.
- [`INTEROP-MATRIX.md`](../INTEROP-MATRIX.md): what each known host advertises and has evidenced.
