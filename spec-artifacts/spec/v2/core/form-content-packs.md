# Form Content Packs

> **Status: Draft · v2.0.0-rc (2026-09-03) · RFC 0177, RFC 0137.**

## Why this exists

A form-content pack ships declarative form templates a host renders in its own chrome. v1 templates had no conditional visibility, no localization, and no validation beyond `required` and `format`. v2 adds all three by reusing constructs the corpus already defines. The manifest is `schemas/v2/form-content-pack-manifest.schema.json`; installation and signing follow packs.md.

## Conditional visibility

A field MAY carry `when: <EdgeCondition>`. The grammar is the `WorkflowEdge.condition` object `{ type, left, right }` of `schemas/v2/workflow-definition.schema.json`, with the operator set of workflow-chain-packs.md §"Edge conditions": `type` is one of `expression`, `equals`, `notEquals`, `contains`, `regex`, `truthy`, `falsy`; `truthy` and `falsy` take `left` only. A host MUST evaluate `when` with its edge-condition semantics and MUST NOT accept any other expression language for visibility.

```jsonc
{ "id": "region", "type": "select", "label": "Region",
  "when": { "type": "equals", "left": "fields.shipping", "right": "international" } }
```

## Localized strings

`label`, `title`, and `description` are localized strings. A host MUST select the rendered language by the locale-selection and fallback rules of i18n.md, and MUST treat every rendered string as untrusted: escaped for the target surface, never interpreted as markup, script, or a template directive.

## Validation

| Constraint | Applies to | Rule |
| --- | --- | --- |
| `required` | any type | the value MUST be present |
| `format` | `text`, `longtext` | one of `email`, `uri`, `date`, `date-time`, `time`, or `x-<format>` |
| `minLength` | `text`, `longtext` | a host MUST reject a shorter value |
| `min`, `max` | `number` | a host MUST reject a value outside the closed range |
| `pattern` | `text`, `longtext` | a host MUST reject a non-matching value |

The five spec-reserved `format` values are the core set. A host that recognizes a format SHOULD apply it; one that does not MUST ignore it and accept plain text. A host MUST ignore `format` on any type other than `text` or `longtext`.
