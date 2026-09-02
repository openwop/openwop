# Retrospective review queue — the RFC 0147 high-risk cohort

> Published 2026-09-02 by RFC 0166 §D.2. Source of the cohort: `docs/RFC-0147-SELF-AUDIT.md` §A.6 ("Disposition: VIOLATED"). Outcome vocabulary: RFC 0156 §B (`ratified | corrective-rfc-required | provisional | withdrawn`; silence is not ratification). Default outcome `provisional` per `docs/WAIVER-AUDIT-2026-08-20.md` §6 recommendation #3. Read by `scripts/generate-assurance-status.mjs`.

RFC 0147 §A.6 requires a high-risk RFC — identity, authorization, isolation, idempotency, replay, external effects, certification — to complete its full public comment window. These five reached `Accepted` under the bootstrap waiver instead. Nothing here reverses that; this file makes the debt a queue with a slot per entry rather than a sentence in a self-audit. The reviewer slot stays empty until a second organization exists (`GOVERNANCE.md` §"Sole-steward operation"); until then every outcome is `provisional`, which means exactly what RFC 0156 §B says: not ratified, not withdrawn.

| RFC | High-risk surface | Window | Outcome | Reviewer (org) | Reviewed | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 0148 | certification | waived | `provisional` | — | — | Non-vacuous certification; bundle v2; per-`it` rows landed 1.153.0 (G3 closed at test granularity). |
| 0150 | idempotency, replay, external effects | waived | `provisional` | — | — | Layer-2 effect identity has zero implementers; the v2 C.6 child decides core vs extension. |
| 0152 | identity/authorization in A2A composition | waived | `provisional` | — | — | Legacy `a2a-0.3` retirement is v2 (C.8). |
| 0153 | identity/authorization in MCP composition | waived | `provisional` | — | — | Legacy MCP 2025-06-18 retirement is v2 (C.8). |
| 0154 | identity, authorization, provenance | waived | `provisional` | — | — | Actor chain now carried on runs by RFC 0165 §B.5; proof format per §C unchanged. |

**How an entry leaves the queue.** A reviewer from an organization other than the steward records `ratified` or `corrective-rfc-required` (with the corrective RFC's number) or `withdrawn`, dates it, and the row moves to the ledger in `docs/ASSURANCE-STATUS.md`. A `provisional` row is not evidence for any claim in `docs/ASSURANCE-STATUS.md` §Claims.
