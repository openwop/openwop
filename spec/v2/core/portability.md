# Portability

> **Status: Stable.**
> **Normative home:** `portability`.

## Why this exists

A tenant's reusable estate moves between hosts as one export bundle, and lands on the destination under the importing caller's identity. This document states the bundle and the rules an importer follows. An adapter that turns another platform's export into a bundle is host tooling.

## The export bundle

An `ExportBundle` (`schemas/v2/export-bundle.schema.json`) carries `bundleVersion: "2"`, a `source` (its origin and an informational `originPrincipal`) and `items[]`. Each item has:

- a `kind`: `agent`, `pack`, `prompt-template`, `connection-ref`, `schedule`, `roster` or `org-chart`;
- a bundle-local `ref` and optional `dependsOn` edges;
- a `payload` shaped by that kind's own schema.

## The `portability` record

- **`export`** — the host emits a bundle for the caller's tenant or workspace, optionally limited to some `kinds`.
- **`import`** — the host applies a bundle.
- **`kinds`** — the item kinds the host exports and imports.
- **`dryRun`** — import offers a plan preview that writes nothing. A host advertising `import` MUST advertise `dryRun: true`.

## Import rules

- **No credential material.** A bundle MUST NOT contain credential values: a `connection-ref` item carries only references and provider ids. The importer MUST report unbound references in `secretsToRebind` and MUST NOT invent or transfer secret material. A host MUST reject with `422` an imported bundle whose payload carries a literal credential value.
- **Dry run.** When `import` is advertised, import MUST offer a dry run. A dry run MUST NOT write, and MUST return the plan it would execute: creates, updates, skips, conflicts and unbound credential references.
- **Idempotent.** Import MUST be idempotent: re-applying a bundle resolves each item to `skipped` or `updated`, never to a duplicate create.
- **Ordered.** Items MUST be applied in `dependsOn` topological order. A cycle is a `422`.
- **Re-owned.** Every imported entity MUST be re-owned to the caller's Subject at the destination ([identity.md](identity.md) §1). `source.originPrincipal` is informational and MUST NOT grant any access. Host-scoped handles are re-minted as [identity.md](identity.md) §5 requires.
- **Executable behavior.** An imported agent or pack that is executable behavior SHOULD pass through the host's install policy ([RFC 0043](https://github.com/openwop/openwop/blob/main/RFCS/0043-registry-and-extension-policy.md)), and MAY be staged as a proposal ([RFC 0096](https://github.com/openwop/openwop/blob/main/RFCS/0096-reviewable-learning-skill-proposal-lifecycle.md)) instead of being activated.

Applying an import returns an outcome per item — `created`, `updated`, `skipped` or `failed` — plus `secretsToRebind`.

## The `import.applied` event

An applied import emits `import.applied` (`schemas/v2/run-event-payloads.schema.json`). A host MUST NOT emit it unless it advertises `portability`. It carries counts and references only, never item payloads or secret values.

## Routes

No protocol path is defined for export or import: a host serves them on routes of its own. A host-private migration from an anonymous sandbox into a signed-in tenant fits this contract, because its response is a subset of the import outcome.

*Sources: RFC 0043, RFC 0096, RFC 0098.*
