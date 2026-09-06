# `portability` — extension (goals, export, import)

| Field | Value |
| --- | --- |
| **witness:** | `claims-check` |
| **technical:** | `experimental` |
| **adoption:** | `none` |
| **advertised as** | `extensions.<org>.portability` |
| **owning RFC** | RFC 0168 (decided in C.1 per RFC 0174 §E.2), RFC 0086/0087 (v1 text) |

> **Status: Draft · v2.0.0-rc (2026-09-03).** `/v1/goals`, `/v1/export`, `/v1/import` were absent from the v1 OpenAPI while `spec/v1/portability.md` and the goals prose described them (RFC 0174 §E.2 noted the decision belongs to C.1). Decided (Phase 3 plan §11): they do not enter `api/v2/openapi.yaml`; the export/import bundle (`schemas/v2/export-bundle.schema.json`, `bundleVersion` "2") and the goals surface are this extension, advertised under `extensions.<org>.portability`, with `spec/v1/portability.md` as the definition until a v2.x additive RFC lands their operations with a witness.
