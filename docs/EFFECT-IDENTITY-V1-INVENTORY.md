# Effect-Identity v1 Inventory (RFC 0150 §E, gap G1, UQ1)

> **Status: Measurement (non-normative), 2026-08-12.** RFC 0150 §E requires existing histories to keep their recipe version and forbids readers from recomputing v1 IDs with v2 rules, with migration tooling to inventory persisted v1 records. Gap G1 and UQ1 ask what is actually deployed. This document answers that from the code, not from assumption.

## Why this had to be measured first

RFC 0150 §B replaces the Layer-2 identity formula. How expensive that is depends entirely on how much persisted state uses the current recipe — G1 calls the inventory "absent", and §E's dual-read/migration machinery is sized against it. It also bears on disclosure: the defect's severity in practice depends on whether anything implements the affected path.

## The current recipe, and the contradiction inside it

`idempotency.md` §"Layer 2" defines:

```text
invocationId = sha256(runId || ':' || nodeId || ':' || attempt || ':' || providerKey)
```

with `attempt` documented as "zero-based retry attempt counter for the side effect". The same document then says, of a transient-503 retry:

> "Layer 2's `invocationId` is **identical**, so the second call either short-circuits (cache hit) or hits OpenAI's own idempotency cache via the injected header."

It cannot be identical — `attempt` incremented. And §"Provider header injection" says the engine SHOULD inject that `invocationId` as the provider's `Idempotency-Key`. So a host implementing the recipe as written sends a **different** key to Stripe or OpenAI on each retry, defeating the provider-side deduplication the same paragraph invokes as the safety net. The worked example hardcodes `attempt: 0`, which is why the contradiction survived review.

## What is actually deployed

| Surface | Layer-2 recipe implemented? | Persisted v1 records |
|---|---|---|
| `openwop-examples` reference hosts (in-memory, sqlite, python) | **No** — zero occurrences of `invocationId` anywhere in the repo | none |
| `openwop-app` (tier-1 reference app) | **No** — `routes/runs.ts` mentions `invocationId` only in a header comment citing the spec | none |

**No host implements the Layer-2 formula, so no host persists a v1 recipe key.** G1's inventory is empty and UQ1 is answered: nothing is deployed against the current recipe.

## The one real provider-idempotency implementation independently arrived at §B's design

`openwop-app` does send outbound provider idempotency keys — to Stripe, on refunds. It does not derive them from the spec's formula. Every call site uses a stable business identifier:

```
commerce-refund:${orderId}
commerce-partial-refund:${orderId}:${refundKey}
refund:${orderId}
```

**No `attempt` component.** A retry produces the same key, Stripe deduplicates, and no second charge-back occurs.

This is the most useful thing in the inventory. The only production code path that actually needed retry-stable provider identity **ignored the spec's recipe and implemented RFC 0150 §B's principle instead** — a logical identifier assigned once per effect, stable across transport retries. It diverged from the spec at precisely the point the spec is wrong, and it had to, because following the spec would have produced duplicate refunds.

§B currently rests on argument. This is adoption evidence for it: an independent implementation reaching the same design under real consequences.

## Consequences

1. **Migration cost is zero.** §E's dual-read machinery, v1 inventory tooling, and retention policy (G5) have nothing to operate on today. That removes them from the critical path — but only while it stays true. **The moment any host implements Layer-2 as written, it acquires the defect and this window closes.**
2. **The duplicate-effect path is theoretical, not live.** The defect is real in the specification and would be real in any conforming implementation, but no deployed system currently follows the affected recipe. That is what makes public-window disclosure appropriate rather than embargo: there is no exploitable production path to protect, and RFC 0150 already describes the defect publicly.
3. **G6's CVE-class triage should record this.** The impact assessment is "severe if implemented, currently unimplemented", not "severe and live".

## What this does not settle

- Whether any **third-party** host implements Layer-2. `INTEROP-MATRIX.md` records no non-steward host, so there is nothing to survey, but absence of a record is not proof of absence.
- The replay semantic-digest half (§C). This inventory covers effect identity only; the digest recipe's deployment footprint is a separate question, and `replay.md`'s cache-key rules may be implemented where the Layer-2 formula is not.
- Whether `openwop-app`'s Stripe key derivation satisfies §B's full contract (it is a business identifier, not the `logicalInvocationOrdinal` shape §B specifies) — it embodies the principle, not the wire format.

## References

- RFC 0150 §§B, E, gap G1, UQ1, G6
- `spec/v1/idempotency.md` §"Layer 2: Activity-level idempotency", §"Provider header injection"
- `docs/CERTIFICATION-BUNDLE-INVENTORY.md` — same inventory-before-migration pattern for RFC 0148 §D
