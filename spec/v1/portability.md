# OpenWOP Spec v1 — Agent-Platform Portability

> **Status: Stable · v1.x (RFC 0098, `Accepted`; graduated 2026-09-03 under RFC 0174 §D.1 — the banner's own predicate had fired).** Normative spec for the portable agent-platform export bundle and the tenant import contract. Capability-gated on `capabilities.portability`. Keywords MUST, SHOULD, MAY follow [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119). See `auth.md` for the status legend. This doc graduates `Draft → Stable` when RFC 0098 reaches `Accepted`.

## Why this exists

Two real journeys have no protocol home today. **(1) Cross-host / tenant migration** — reference hosts implement a private "promote my anonymous sandbox into my signed-in tenant" step (cookie + OIDC coupled); an operator cannot script it, an A2A peer cannot reason about it, and there is no way to move an estate *between* OpenWOP hosts at all. **(2) Competitor import** — the market's onboarding wedge is "bring your existing setup"; a new OpenWOP host wants the same wedge but there is no portable bundle for "an agent platform's reusable estate."

openwop already standardizes every *piece* of the estate (agents 0070, packs 0003/0013, templates 0027, connections 0045/0095, schedules 0052, roster/org-chart 0086/0087) and the *identity* an import must land on (RFC 0048), plus the **secret invariants** an import must honor (RFC 0046/0079). What is missing is the **bundle that composes those pieces** and the **import contract** that maps them onto a destination identity *safely*. The *adapter* that reads a competitor's proprietary export and emits an openwop bundle stays a host/tooling concern; this doc pins the bundle shape, the import endpoint, the dry-run, and the invariants.

## The export bundle

An `ExportBundle` (`schemas/export-bundle.schema.json`) carries `bundleVersion: "1"`, a `source` (origin + informational `originPrincipal`), and `items[]`. Each item has a `kind` (`agent | pack | prompt-template | connection-ref | schedule | roster | org-chart`), a bundle-local `ref`, optional `dependsOn` edges, and a `payload` shaped by the kind's existing schema. The bundle carries **no secret values** — `connection-ref` items carry only refs/provider ids.

Hosts advertise `export`, `import`, the supported `kinds`, and `dryRun` under `capabilities.portability`.

## Normative requirements

1. **No credential material.** An export bundle **MUST NOT** contain credential values. `connection-ref` items carry only refs/provider ids (RFC 0046/0079); the importer **MUST** report unbound refs in `secretsToRebind` and **MUST NOT** invent or transfer secret material. A host **MUST** reject an imported bundle whose payload carries a literal credential value with a secret-value rejection (`422`). (SECURITY invariant `export-bundle-no-credential-material`.)
2. **Mandatory dry-run.** Import **MUST** offer a dry-run when `portability.import` is advertised (`portability.dryRun` **MUST** be true): `POST /import?dryRun=true` **MUST NOT** write and **MUST** return the plan it would execute.
3. **Idempotent + ordered.** Import **MUST** be idempotent: re-applying the same bundle re-resolves to `skipped`/`updated`, never duplicate-creates. Items **MUST** be applied in `dependsOn` topological order; a cycle is a `422`.
4. **Re-ownership.** All imported entities **MUST** be re-owned to the caller's RFC 0048 identity at the destination; `source.originPrincipal` is informational only and **MUST NOT** grant any access.
5. **Executable behavior.** Imported agents/packs that are *executable behavior* **SHOULD** route through RFC 0043 install policy (and **MAY** be staged as RFC 0096 proposals rather than activated directly).

## Endpoints + events

The host serves portability as a host-extension (see `host-sample-test-seams.md`), promotable to the normative `/v1/*` at graduation:

| Method + path | Purpose |
|---|---|
| `GET /export[?kinds=]` | Emit an export bundle for the caller's tenant/workspace (RFC 0048). |
| `POST /import?dryRun=true` | **Plan**: validate, resolve dependency order, return an `ImportPlan` (creates/updates/skips/conflicts + unbound credential refs) **without writing**. |
| `POST /import` | **Apply**: execute the plan idempotently; returns an `ImportResult` per item (`created \| updated \| skipped \| failed`) + `secretsToRebind`. |

One additive, content-free event is emitted (gated on the capability): `import.applied` (`run-event-payloads.schema.json`) — counts + refs only, never item payloads or secret values. The existing host-private anon→user migration remains valid: its response is a subset of the `ImportResult` aggregate.

## Open spec gaps

| Gap | Disposition |
|---|---|
| Normative `/v1/export` + `/v1/import` endpoints in `api/openapi.yaml` | Deferred to graduation (pre-authored near `Active → Accepted`, per the RFC 0086 precedent). Floor surface is the host-extension seam. |
| Competitor adapters (e.g. an external-platform → openwop bundle reader) | Out of scope — host/tooling concern. The protocol pins only the bundle shape + import contract. |
| SDK methods (`export`/`import` group) | Tracked in `openwop-sdks`; not part of the spec-corpus floor. |

## References

- `schemas/export-bundle.schema.json`
- `capabilities.md` §`portability`
- `RFCS/0098-agent-platform-portability-export-bundle-and-import.md`
- `RFCS/0048` identity · `RFCS/0046`/`RFCS/0079` credential provenance · `RFCS/0043` install policy
- `conformance/src/scenarios/export-bundle-portability.test.ts`
