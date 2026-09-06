# Connection Packs

> **Status: Draft · v2.0.0-rc (2026-09-03) · RFC 0177, RFC 0095.**

## Why this exists

A connection pack is a signed provider definition — the endpoints, scope catalog, and reach a connector's `auth.provider` string resolves against. v1 let two definitions claim one `provider.id` and picked between them silently by version. v2 makes the id unique per host and makes a collision fail closed. The manifest is `schemas/v2/connection-pack-manifest.schema.json`; installation and signing follow packs.md.

## Provider identity

A `provider.id` MUST be unique per host. Built-in provider definitions are the host's own pack for every rule in this document.

| Situation | Host behavior |
| --- | --- |
| Exactly one definition of bare id `P` | `P` resolves to it |
| An installed pack and a built-in both define `P` | the later registration MUST be refused with `connection_provider_conflict` |
| Two installed packs both define `P` | the later registration MUST be refused with `connection_provider_conflict` |
| No definition of `P` | the dependent connector or pack MUST be refused with `connection_provider_unresolved` |

A host MUST NOT choose between two claimants by comparing versions.

## The qualified form

A connector MAY name a provider by its qualified form `<packName>#<id>`. A qualified reference resolves only to the named pack's definition. A bare id resolves only when exactly one definition exists on the host.

## Resolution

A host advertising `connections.packsSupported` MUST resolve a connector's `auth: { type: "oauth2", provider: P }` (and any `host.oauth` invocation for `P`) against the definition selected above to obtain its endpoints and scope catalog. An unresolvable provider MUST be refused when the dependent connector or pack is registered. On a publish-path host, resolution MUST run after the idempotency short-circuit: a byte-identical re-publish of an installed pack MUST succeed even when resolution inputs have since changed.

## Errors

Both codes are in `spec/v2/errors.json`: `connection_provider_conflict` (two claimants for one bare id) and `connection_provider_unresolved` (no definition for the referenced id).
