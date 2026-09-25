# RFC 0201: Standard Webhooks as an opt-in companion signature scheme, with a signed delivery id, multi-signature rotation and endpoint verification

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0201                                                            |
| **Title**         | Standard Webhooks 1.0.0 as an opt-in, per-subscription companion signature scheme (`standard-webhooks-1`): a signed, retry-stable delivery id, multi-signature secret rotation, and endpoint verification for opted-in subscriptions only |
| **Status**        | `Accepted`                                                        |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-22                                                      |
| **Updated**       | 2026-09-22 — `Draft → Active` in the filing PR; **comment window waived** by the steward on 2026-09-22 under `GOVERNANCE.md` §"Sole-steward operation" — an explicit **steward override of RFC 0147 §A.6** (precedent: RFC 0194), which forbids bootstrap waiver language from shortening the window for an RFC of this risk class; it is outside the `MAINTAINERS.md` waiver grant, recorded there as an override, not as a routine waiver (this RFC affects **external effects** and **idempotency**); acceptance under this override is provisional and the §B review is owed (RFC 0156 register, `docs/WAIVER-RETROSPECTIVE-REGISTER.md`, row `not-reviewed`). · **Updated 2026-09-22 — amended per implementation review** (Status unchanged: the Falsifiability rows spell each requirement id in full, because `check-accepted-predicate` rule 4 extracts only full `openwop.requirement.*` ids and read the `…0201.` short forms as no id at all) · 2026-09-24 (`Active → Accepted`). **Accepted provisionally**: this RFC was made Active under the steward's override of RFC 0147 §A.6, so its RFC 0156 §B retrospective cross-organization review is still owed (`docs/WAIVER-RETROSPECTIVE-REGISTER.md` row reads `not-reviewed`); acceptance stays provisional until that review is recorded. Evidence tier: tier-1 — the v2 reference host (openwop-examples), a reference example and not a production host; single witness, the certified public v2-reference bundle on published suite 2.38.0 (`evidence/v2-host-bundles/openwop-host-v2-reference.json`, openwop#1542; build `commit:1157625f`, witness `669d926abf45`, 385 executed-pass / 0 fail / 0 blocked, relaxations `[]`, all three profiles certified). |
| **Affects**       | `spec/v1/webhooks.md` (new §"Standard Webhooks companion scheme"; §"Signature algorithm versioning" clarified) · `spec/v1/capabilities.md` §`webhooks.signatureAlgorithms` · `schemas/capabilities.schema.json` (`webhooks.secretRotation`) · `api/openapi.yaml` (`registerWebhook` body + 201; new `rotateWebhookSecret`) · `spec/v2/core/webhooks.md` (new §"Standard Webhooks") · `spec/v2/core/headers.md` via `scripts/derive-v2-api.py` · `spec/v2/facets/webhooks.schema.json` (+ generated `schemas/v2/capabilities.schema.json`) · `api/v2/openapi.yaml` + `spec/v2/path-manifest.json` · `schemas/v2/webhook-verification.schema.json` (new) · `spec/v2/errors.json` (`webhook_endpoint_unverified`) · `spec/v2/declaration.json` (`webhooks` facet `secretRotation`) · `SECURITY/invariants.yaml` (+2) · `SECURITY/threat-model-secret-leakage.md` · conformance (4 new scenarios) |
| **Compatibility** | `additive` per `COMPATIBILITY.md` §2.1 — every rule binds only a subscription that opted in at registration; see §Compatibility for the §4 row relied on |
| **Amends**        | RFC 0165 §C.1 and RFC 0171 §C.1 (the webhook header family and the `OpenWOP-*` naming rule gain one named exception); RFC 0176 §D.2 ("the cut adds no signature scheme" — still true of the cut; this RFC adds one after it, as a companion, not a replacement) |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

OpenWOP's webhook scheme `v1` signs `{timestamp}.{rawBody}`: the delivery carries no per-message id, nothing binds the id headers to the signature, a secret can only be rotated by deleting the subscription, and a registered URL receives POSTs with no proof its operator consented. Standard Webhooks 1.0.0 solves the first three and has an ecosystem of verification libraries. This RFC registers it as a **companion** scheme, `standard-webhooks-1`, that a subscriber opts into **per subscription at registration**. An opted-in delivery carries the five `OpenWOP-*` headers exactly as today (scheme `v1`) **plus** Standard Webhooks' own `webhook-id` / `webhook-timestamp` / `webhook-signature`. The RFC also defines what Standard Webhooks leaves open: when a signed delivery id is stable, how rotation is triggered, and an endpoint-verification handshake that runs **only** for opted-in registrations.

## Motivation

**Four gaps, measured against the text.** (Review slice D, F1; verify-CD D-F1, CONFIRMED.)

| Gap | Where the corpus stands | Standard Webhooks 1.0.0 |
| --- | --- | --- |
| The delivery id is unsigned and per-subscription | `spec/v1/webhooks.md` §Headers: `X-openwop-Webhook-Id` is "the recipient subscription's id"; the signed bytes are `{X-openwop-Timestamp}.{rawBody}`. v2 `webhooks.md` §Headers is the same. Dedup keys on the tuple `(webhookId, runId, sequence)`, read out of the body | §"Signature scheme": "the message's: ID, timestamp and body are concatenated … `msg_id.timestamp.payload`". §"Webhook metadata": the id "remains the same no matter how many times a webhook that has failed is retried. The ID is often used as an idempotency key" |
| No zero-downtime rotation | v1 §"Secret rotation": "The current spec does not define a secret-rotation flow. To rotate, delete the subscription and create a new one" | §"Webhook headers": "The signature header is a space delimited list of signatures … to support zero downtime secret rotation" |
| No receiver ecosystem | v1 §"Why this exists" chose the Stripe/GitHub pattern "for … toolchain compatibility", but the `sha256=<hex>` header is OpenWOP-specific | libraries in many languages read exactly `webhook-id`, `webhook-timestamp`, `webhook-signature` (e.g. `libraries/javascript/src/index.ts`, which strips `whsec_`, base64-decodes the key and verifies each space-separated `v1,` entry) |
| No consent from the endpoint | a tenant member can point a subscription at any public `https://` URL. The egress guard (v2 `webhooks.md` §Egress) protects the **host's** network, not a third party's endpoint | **silent.** Standard Webhooks 1.0.0 defines no endpoint-verification step (checked 2026-09-22; the spec text is identical at tag `v1.0.0` and on `main`) |

**The fourth gap is OpenWOP's own argument, not an upstream one.** A registration is a standing instruction for the host to POST to a URL the caller chose, for every matching event, with retries (v2 §Durability makes retries a MUST). Without consent, a member of any tenant can aim that traffic at a victim. The victim receives signed POSTs it cannot verify and never asked for, and the host's durable retries amplify each one. The egress guard does not help, because the victim is a legitimate public destination. The only party that can prove consent is the endpoint. This RFC does **not** cite the MCP Triggers & Events working-group sketch, which describes a similar handshake: it is a draft that says it does "not represent official MCP specifications", and RFC 0147 §A.10 forbids resting a claim on it.

**Why this is not a replacement for `v1`.** v2 `webhooks.md` binds four things in place today: the facet "MUST list `v1`"; "A host MUST send all five" `OpenWOP-*` headers with `OpenWOP-Signature-Algorithm: v1`; "A subscriber MUST reject an unrecognized `OpenWOP-Signature-Algorithm` value"; and the scheme is defined only for `v1`. A host that switched a live subscription to a new algorithm would break every subscriber that obeys the third rule (architect P3-C2). So the new scheme rides **alongside** `v1` in the same delivery, and only on subscriptions whose owner asked for it.

## Proposal

### §A The scheme and its name

1. The algorithm id is **`standard-webhooks-1`**. It denotes the **symmetric** (HMAC-SHA256) scheme of Standard Webhooks **1.0.0** ([spec](https://github.com/standard-webhooks/standard-webhooks/blob/v1.0.0/spec/standard-webhooks.md), "Version: 1.0.0", Apache-2.0; https://www.standardwebhooks.com). The asymmetric `v1a` (ed25519) scheme is not part of this id (UQ1).
2. **The `v1` collision.** Standard Webhooks prefixes each signature with the *signature identifier* `v1` (`webhook-signature: v1,<base64>`, §"Signature scheme" table). OpenWOP's scheme id `v1` names a different scheme. The two tokens live in disjoint places: the Standard Webhooks token appears **only** inside a `webhook-signature` value, and the OpenWOP id appears **only** in `OpenWOP-Signature-Algorithm`, the `X-openwop-*` counterpart, `signatureAlgorithms[]`, and registration bodies. A host **MUST NOT** write `standard-webhooks-1` into `OpenWOP-Signature-Algorithm`. A subscriber **MUST NOT** read a `v1,` entry of `webhook-signature` as the OpenWOP scheme, or the reverse. On every delivery, opted-in or not, `OpenWOP-Signature-Algorithm` stays `v1`, so the v2 "reject an unrecognized algorithm" rule never fires on an opted-in delivery.
3. A host **MAY** list `standard-webhooks-1` in `webhooks.signatureAlgorithms[]` (v1 capabilities, v2 facet). A host that lists it **MUST** also list `v1`, as both majors already require.

### §B Per-subscription opt-in at registration

4. `registerWebhook` (v1 `POST /v1/webhooks`, v2 `POST /webhooks`) gains an optional request field, `signatureAlgorithms: string[]`. Absent means `["v1"]`, which is today's behaviour, byte for byte.
5. When the field is present, it **MUST** contain `v1` and **MUST NOT** repeat a value. Each value **MUST** be listed in the host's own `signatureAlgorithms[]`. Otherwise the host **MUST** refuse with `400 validation_error`.
6. When the field lists `standard-webhooks-1`, the request **MUST** carry `secret` in the Standard Webhooks symmetric form `whsec_<base64>`, where the base64 decodes to 24–64 bytes (§"Signature scheme" table: "Random. Between 24 bytes (192 bits) and 64 bytes (512 bits) … prefixed with `whsec_`"). Otherwise the host **MUST** refuse with `400 validation_error`. The subscriber supplies the secret so that it can authenticate the verification request in §D. The host **MUST NOT** return the secret in any response. v1's host-minted, returned-once secret remains the behaviour for subscriptions that do not opt in.
7. The `201` response **MUST** carry `signatureAlgorithms`, the list the dispatcher will apply, whenever the request carried the field. This is the registration-time contract that v1 §"Signature algorithm versioning" already promises ("registration response carries the algorithm the dispatcher will use") and that no response shape carried until now.
8. **A subscription that did not opt in is unaffected by every rule in this RFC.** Its deliveries **MUST NOT** carry `webhook-*` headers, and its registration **MUST NOT** be verified (§D.13).

### §C Delivery to an opted-in subscription

9. Every delivery **MUST** carry, unchanged, every header the host sends today: all five `OpenWOP-*` headers under scheme `v1` and, through the overlap, the `X-openwop-*` family. It **MUST** also carry:

| Header | Value |
| --- | --- |
| `webhook-id` | the delivery's message id (§C.10) |
| `webhook-timestamp` | Unix seconds at signing; **MUST** equal `OpenWOP-Timestamp` |
| `webhook-signature` | one or more space-separated entries `v1,<base64(HMAC-SHA256(key, "{webhook-id}.{webhook-timestamp}.{rawBody}"))>` |

   `key` is the base64 decoding of the secret after the `whsec_` prefix is removed. `rawBody` is the exact bytes delivered. The `v1` scheme's HMAC key stays the secret string as issued, so one secret keys both schemes, which Standard Webhooks permits (§"Migrating to Standard Webhooks": "You can even reuse existing webhook signing secrets").
10. **The signed delivery id (idempotency).** `webhook-id` **MUST** match `^[A-Za-z0-9_-]{16,128}$`, which excludes `.` because Standard Webhooks requires the id and timestamp not to "include any `.`". It **MUST** be identical on every attempt of one delivery, meaning one `(webhookId, runId, sequence)`, including an attempt made after the host restarts. It **MUST** differ between any two distinct deliveries, whether they differ by event or by subscription. It **MUST NOT** be derived from the secret. A branch fork's events are new facts with a new `runId` and get new ids; a replay fork delivers nothing (v2 §Replay). Because the id is inside the signed bytes, a receiver that dedups on `webhook-id` dedups on an authenticated value, not on a header anyone on the path could rewrite.
11. `OpenWOP-Webhook-Id` keeps its meaning (the subscription id) and **MUST NOT** be set to the `webhook-id` value.
12. **Receiver.** A subscriber that opted in **SHOULD** verify with the Standard Webhooks recipe (§"Verifying signatures": constant-time compare, timestamp tolerance, `webhook-id` as idempotency key). A subscriber that does so **MUST** apply the ±5 minute tolerance that v1 and v2 §Verification already set, which is also the reference library's default. It **MAY** instead verify the `v1` headers; both signatures cover the same body.

### §D Endpoint verification, for opted-in registrations only

13. Before it answers `201` to a registration that lists `standard-webhooks-1`, the host **MUST** send one verification request to `url`:
    - `POST`, `Content-Type: application/json`, body `{ "type": "openwop.webhook.verification", "challenge": "<c>" }`, where `c` is a fresh base64url value of at least 128 bits of entropy (`schemas/v2/webhook-verification.schema.json`, `$id` also served for v1);
    - `webhook-id`, `webhook-timestamp` and `webhook-signature` computed as in §C.9 with the supplied secret. It carries **no** `OpenWOP-Event-Type`, because it is not a delivery and no subscriber may mistake it for one;
    - under the **same egress rules as a delivery**: re-resolve, validate every address, pinned connect, no redirects (v2 §Egress; v1 §"Delivery-time egress validation").
14. The host **MUST** refuse the registration with `400 webhook_endpoint_unverified` and persist no subscription unless it receives a `2xx` response within 10 seconds whose body parses as JSON and whose `challenge` equals `c`. A redirect, a non-`2xx`, an empty `2xx`, a wrong or missing `challenge`, and a timeout are all refusals. The host **MUST NOT** retry the verification request inside one registration.
15. A registration that does **not** list `standard-webhooks-1` **MUST NOT** be verified. Making verification unconditional would reject registrations that succeed today, which is COMPATIBILITY §4 "stricter validation" and needs a 90-day safety-fix window (architect P3-C3). This RFC does not take that step (UQ3).
16. Idempotency is unchanged. A same-key duplicate returns the cached outcome without re-verifying: the cached `201` for a success, or the cached `400 webhook_endpoint_unverified` for a refusal. `idempotency.md` treats both a `2xx` and a non-retryable `4xx` as final outcomes, and the new error row is `retriable: false`. A client that has fixed its endpoint retries with a new key.
17. A host **SHOULD** rate-limit opted-in registrations per tenant. Each registration costs the named endpoint exactly one request, and a host **MUST NOT** send more.

### §E Multi-signature secret rotation

18. A host **MAY** advertise `webhooks.secretRotation: { overlapSeconds }` (integer, 60–604800). A host that advertises it **MUST** serve `rotateWebhookSecret`, at v2 `POST /webhooks/{webhookId}/rotate-secret` and v1 `POST /v1/webhooks/{webhookId}/rotate-secret?tenantId=…`, with body `{ "secret": "whsec_…" }` (§B.6 form). Tenant checks are exactly those of `unregisterWebhook` (v2: `403 id_tenant_mismatch` checked before lookup; v1: `403` when the caller is not a member). An unknown subscription gets `404`. A subscription that did not opt in gets `400 validation_error`: its `v1`-only header carries a single signature and cannot overlap. A host that does not advertise the facet **MUST** answer `404 not_found`.
19. The response is `200 { rotatedAt, previousSecretExpiresAt }`, where `previousSecretExpiresAt = rotatedAt + overlapSeconds`. It carries no secret.
20. From `rotatedAt` until `previousSecretExpiresAt`, `webhook-signature` **MUST** carry one entry under the new secret and one under the previous secret (§"Webhook headers": "signed both using the current key, and using an old key (for a set period of time)"). `OpenWOP-Signature` **MUST** stay on the previous secret during the overlap and move to the new one at `previousSecretExpiresAt`. After that instant, the previous secret **MUST NOT** sign anything. A second rotation inside an overlap retires the oldest secret immediately, so at most two entries are ever sent.
21. Rotation does not re-verify the endpoint, because the URL has not changed.

### §F Header namespace

22. `webhook-id`, `webhook-timestamp` and `webhook-signature` keep Standard Webhooks' names. They are **not** mapped into `OpenWOP-*`. RFC 0171 §C.1 says "Standard headers keep their standard names", and Standard Webhooks says its headers "should be prefixed with `webhook-` and follow the exact naming as below". The only reason to adopt the profile is that unmodified receivers and libraries verify it, and renamed headers would verify nowhere. RFC 0171 §C.1 and the generated `spec/v2/core/headers.md` §"Webhook delivery headers" name these three as the one exception. They appear only on deliveries to, and the verification request for, opted-in subscriptions. The v1 `X-openwop-*` family is unaffected.

### v1 text (proposed, `spec/v1/webhooks.md`)

A new §"Standard Webhooks companion scheme (RFC 0201)" after §"Signature algorithm versioning", carrying §A–§F above with v1 paths and header families. One sentence is added to §"Signature algorithm versioning":

> A *companion* scheme, one whose headers are sent in the same delivery beside an unchanged `v1` signature (`standard-webhooks-1`, RFC 0201), is not "delivering under a new scheme": it needs no dual delivery, and `X-openwop-Signature-Algorithm` stays `v1`.

§"Secret rotation" gains: "A host advertising `capabilities.webhooks.secretRotation` offers zero-downtime rotation for subscriptions that opted into `standard-webhooks-1` (RFC 0201 §E); delete-and-recreate remains the only rotation for every other subscription." `spec/v1/capabilities.md` §`webhooks.signatureAlgorithms` gains: "`standard-webhooks-1` (RFC 0201) MAY also be listed, beside `"v1"`."

### v2 text (proposed, `spec/v2/core/webhooks.md`, new § after §Verification; 215 words)

> ## Standard Webhooks
>
> `standard-webhooks-1` names the symmetric scheme of Standard Webhooks 1.0.0 (RFC 0201). Its in-header `v1,` token is that standard's, not the OpenWOP scheme id `v1`; neither is read as the other, and `OpenWOP-Signature-Algorithm` stays `v1`.
>
> **Opt-in.** A subscription carries the scheme only when `registerWebhook` sends `signatureAlgorithms` listing it and `v1`, with a `secret` of the form `whsec_<base64 of 24–64 bytes>`; otherwise, or when the host does not advertise the id, `400 validation_error`. The `201` echoes the applied list. Every other subscription is unchanged.
>
> **Endpoint verification.** Before answering `201`, the host MUST send the request of `schemas/v2/webhook-verification.schema.json` to `url` under §Egress, signed as below, and MUST refuse `400 webhook_endpoint_unverified`, persisting nothing, unless a `2xx` arrives within 10 s whose JSON `challenge` equals the one sent. A host MUST NOT verify a subscription that did not opt in.
>
> **Delivery.** Each delivery to an opted-in subscription adds `webhook-id`, `webhook-timestamp` (equal to `OpenWOP-Timestamp`) and `webhook-signature`: space-separated `v1,<base64 HMAC-SHA256>` entries over `{webhook-id}.{webhook-timestamp}.{rawBody}`, keyed by the decoded secret. `webhook-id` matches `^[A-Za-z0-9_-]{16,128}$`, MUST be identical on every attempt of one `(webhookId, runId, sequence)` and MUST differ across them.
>
> **Rotation.** A host advertising `webhooks.secretRotation` serves `rotateWebhookSecret`. For `overlapSeconds` after a rotation, `webhook-signature` MUST carry one entry per secret and `OpenWOP-Signature` stays on the previous secret; afterwards only the new secret signs.

Two further edits: the §Surfaces request cell becomes `{ url, events[], secret?, tags?, signatureAlgorithms? }`, and the generator line for `headers.md` §"Webhook delivery headers" appends: "On a subscription that opted into Standard Webhooks (webhooks.md), that standard's `webhook-id`, `webhook-timestamp` and `webhook-signature`, which keep their standard names (RFC 0201 §F)." Detail that the budget does not count (the rotation body, tenant checks, the verification body) lives in `api/v2/openapi.yaml` descriptions and the new schema.

**Examples.** *Positive:* a delivery with `OpenWOP-Signature-Algorithm: v1`, `OpenWOP-Signature: sha256=…`, `webhook-id: msg_2KWPBgLlAfxdpx2AI54pPJ85f4W`, `webhook-timestamp: 1674087231` (equal to `OpenWOP-Timestamp`), and `webhook-signature: v1,K5oZ…= v1,Xq9…=` during an overlap. *Negative:* `OpenWOP-Signature-Algorithm: standard-webhooks-1` (§A.2). A `webhook-id` that changes between the first attempt and its retry (§C.10). A `201` for an opted-in registration whose endpoint answered `200 {}` (§D.14). `webhook-*` headers on a subscription registered without `signatureAlgorithms` (§B.8).

## Compatibility

**Additive** (COMPATIBILITY §2.1), relying on the §4 row "new normative requirement on a previously-undefined behavior". The behaviours this RFC defines are registration-time algorithm selection (promised by v1 but never shaped), a per-message id, rotation, and the verification step, and none of them had any definition before. Every MUST binds only a subscription whose registration carried `signatureAlgorithms` listing `standard-webhooks-1`. Clause by clause:

- **Registration bodies are closed** (`additionalProperties: false`, both OpenAPI documents). A body carrying `signatureAlgorithms` fails today, so accepting it is looser validation. No body that succeeds today is refused, and none is verified (§B.8, §D.15).
- **Discovery.** The facet `items.enum` grows from `["v1"]` to `["v1","standard-webhooks-1"]`, with `contains: {const: "v1"}` added so the existing "MUST list `v1`" becomes schema-enforced. Every discovery document valid before remains valid after. Precedent treats optional-property and inline-enum growth as additive in v2.x (RFC 0183, 0186, 0188; architect P3 "v2 growth rule"). `webhook-sig-algorithm.test.ts` asserts `includes('v1')` and is unaffected.
- **Deliveries.** Nothing changes on a non-opted subscription, and on an opted-in one every existing header keeps its value. `OpenWOP-Signature-Algorithm` stays `v1` on every delivery, so no subscriber's "reject an unrecognized algorithm" rule can fire.
- **Errors.** `webhook_endpoint_unverified` is a new row in the registry-backed `spec/v2/errors.json` (v2 `overview.md` §0 growth rule). v1 uses the same code string. Refusals on the new field use the existing `validation_error`.
- **New operation.** `rotateWebhookSecret` is gated on a new optional facet. A host that does not advertise the facet answers `404`, as RFC 0188 §A.5 does for its read.
- **No v1 MUST is relaxed.** The v1 dual-delivery SHOULD is clarified as not applying to a companion scheme (§v1 text). Its purpose, that no subscriber is ever handed a signature it cannot read, holds because `v1` is always present.
- **Certification.** No new requirement id enters a floor or a profile predicate. The `webhooks` family keeps `floorScenarios: []`. This keeps the RFC out of RFC 0147 §A.6's certification class. It remains in the external-effects and idempotency classes, hence the override recorded in `Updated`.

## Conformance

The receiver is the suite-owned HTTP receiver that `webhook-signed-delivery.test.ts` and `v2-webhook-durable-delivery.test.ts` already use (`conformance/src/lib/webhook-receiver.ts`, fronted by `OPENWOP_WEBHOOK_RECEIVER_URL`). It gains an **echo**, a **no-echo** and a **wrong-echo** verification mode. Every leg is gated on the host listing `standard-webhooks-1`. A host that does not list it records `inapplicable`. A host whose egress guard rejects the loopback receiver records `blocked`, as today. The scenario files are listed in the implementation plan.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §B.8 / §D.15 a non-opted subscription is untouched | `openwop.requirement.0201.opt-in-only`: a registration **without** `signatureAlgorithms` against the **no-echo** receiver gets `201`. Its deliveries carry no `webhook-*` header, and the receiver saw no verification request | the suite, gated on the id being listed | witnessable — gated. A host that verifies or adds headers for everyone fails it |
| §B.5–§B.7 the opt-in is validated and echoed | `openwop.requirement.0201.registration-validated`: `["standard-webhooks-1"]` without `v1` → `400 validation_error`. A non-`whsec_` or 8-byte secret → `400`. A valid opt-in gets a `201` echoing `signatureAlgorithms` | the suite, gated | witnessable — gated |
| §A.2 / §C.9 the delivery is dual-signed, and the Standard Webhooks signature covers the id | `openwop.requirement.0201.delivery-signed`: on an opted-in delivery, the five `OpenWOP-*` headers verify under `v1` with `OpenWOP-Signature-Algorithm: v1`. At least one `webhook-signature` entry verifies over `id.ts.body` with the decoded secret. `webhook-timestamp` equals `OpenWOP-Timestamp`. **Sabotage control:** recomputing with a different id does **not** match, so a host that signs `ts.body` under the `webhook-signature` header fails | the suite, gated | witnessable — gated |
| §C.10 the id is stable across retries and distinct across deliveries | `openwop.requirement.0201.message-id-stable`: the receiver answers `500` to the first two attempts per `(webhookId, runId, sequence)`. Every attempt for one key carries one `webhook-id`, and two sequences carry two ids. A per-attempt random id fails the first half, and a constant id fails the second | the suite, gated (retries are a v2 MUST; at v1 they need the RFC 0083 `durable` mode) | witnessable — gated. At v1, `inapplicable` without `webhooks.durable` |
| §C.10 the id survives a host restart | nothing a black-box suite can cause without a restart hook | a host, only through the RFC 0158 test hook `POST /host/durability/kill` | witnessable — seam-gated. `inapplicable` where the hook is not mounted |
| §D.13–§D.14 endpoint verification refuses without consent | `openwop.requirement.0201.endpoint-verification`: **no-echo** and **wrong-echo** → `400 webhook_endpoint_unverified`, and a following run produces **zero** deliveries to that URL. **echo** → `201`. The verification request verifies under §C.9 with the supplied secret and carries no `OpenWOP-Event-Type`. A host that returns `201` and verifies afterwards fails | the suite, gated | witnessable — gated |
| §D.14 no redirect is followed during verification | the receiver answers `307` to a second receiver. The registration is refused, and the second receiver sees nothing | the suite, gated | witnessable — gated |
| §E.18–§E.20 rotation overlaps, then retires | `openwop.requirement.0201.secret-rotation`: after rotation, the next delivery's `webhook-signature` has exactly two entries, one verifying under each secret, and `OpenWOP-Signature` verifies under the previous secret. If `overlapSeconds` is within the suite's wait cap, a delivery after `previousSecretExpiresAt` carries one entry, under the new secret | the suite, gated on `webhooks.secretRotation` | witnessable — gated. The post-overlap leg is `partial-witness:` when `overlapSeconds` exceeds the cap, **not** `executed-pass` |
| §E.18 rotation is tenant-checked | a foreign-tenant `webhookId` → `403 id_tenant_mismatch` (v2) before lookup | the suite, gated | witnessable — gated |
| §B.6 the host never returns the secret | no response body of `registerWebhook` or `rotateWebhookSecret` contains the supplied secret or its decoded bytes | the suite, gated | witnessable — gated (a negative read over two known bodies, which can fail) |
| §C.12 receiver-side tolerance | nothing: receiver behaviour is not the host's wire | — | unwitnessable (receiver-side). The host's half is §C.9 |
| §D.17 registrations are rate-limited | nothing a suite can attribute | — | unwitnessable (SHOULD, host policy) |

**Invariants added** (`SECURITY/invariants.yaml`, tier `protocol`): `webhook-endpoint-verification-opt-in` (§D, tests: the endpoint-verification scenario, both majors) and `webhook-message-id-stable` (§C.10, tests: the message-id scenario). The threat-model entry in `SECURITY/threat-model-secret-leakage.md` records the flooding-by-registration vector, and it states that the `whsec_` secret is logged only by its `secretFingerprint`, as v1 already requires.

## Alternatives considered

- **Replace `v1` with Standard Webhooks (a new `OpenWOP-Signature-Algorithm` value).** This breaks every subscriber that obeys v2's "reject an unrecognized algorithm" MUST, and the facet's "MUST list `v1`". It is breaking, not additive (architect P3-C2(a)(b)).
- **Rename the headers into `OpenWOP-*`** (`OpenWOP-Message-Id`, `OpenWOP-Message-Signature`). The headers would conform to RFC 0171 §C.1, but no Standard Webhooks library would verify them, and interop with those libraries is the only benefit of the profile. §F takes the one named exception instead.
- **Dual delivery (one POST per scheme)**, as v1's SHOULD envisioned for a replacement scheme. This doubles every delivery and every retry for no subscriber benefit, and it gives the receiver two ids for one event, which defeats §C.10.
- **Mandatory endpoint verification for every subscription.** This closes the flooding vector for everyone, but it rejects registrations that succeed today, which makes it a safety-fix needing a 90-day window (architect P3-C3). Recorded as UQ3.
- **Host-minted secret with asynchronous verification** (`201 pending`, deliveries held until verified). The endpoint could then check the signature on the challenge, but this adds a subscription state machine and forces a decision about which held events are durable. The client-supplied secret (§B.6) gives the same property synchronously.
- **Do nothing.** The id stays unsigned, rotation stays a delete, and the flooding vector stays open with no opt-in path to close it.

## Unresolved questions

1. **`v1a` (ed25519).** Standard Webhooks' asymmetric scheme is the future Ed25519 that v1 `webhooks.md` names, but it needs a public-key distribution rule ("Do not blindly trust signatures produced by untrusted public keys"). Left for a separate id (`standard-webhooks-1-ed25519`) and RFC.
2. **Should `rotateWebhookSecret` also exist for `v1`-only subscriptions**, with `OpenWOP-Signature` staying single-valued? No overlap is possible there without a grammar change. Left out.
3. **Verification for every subscription.** Worth a safety-fix RFC with a 90-day window once one host has run the opt-in form. Not proposed here.
4. **Should the RFC 0188 dead-letter record carry `webhook-id`?** It would let a subscriber correlate a dead-lettered delivery with the ids it has already seen. It is an optional field on a closed schema, so it would be additive, but it is deferred to keep this RFC's surface small.
5. **Should a Standard Webhooks `410 Gone` disable the subscription** (§"Delivery success and failure")? v2's durability rules treat `410` as a failure to retry. Changing that is a separate delivery-policy question.

## Implementation notes (non-normative)

See the companion implementation plan (not committed with the RFC). The v2 core word delta is about +238, with no families homed. That is under the +300 ceiling and over the +0 target; see gap G1.

## Acceptance criteria

- [x] `Active` — 2026-09-22, by steward override of RFC 0147 §A.6 (the window was waived, not run; see `Updated`).
- [x] Spec text (v1 + v2), facet/schema/OpenAPI/path-manifest/errors changes, generator line, both invariants, and the four scenarios merged in one suite minor, published only after this RFC's review debt is recorded (RFC 0195 precedent). — merged in the 2.36.0 suite minor, published 2026-09-23; the RFC's §B row was already in `docs/WAIVER-RETROSPECTIVE-REGISTER.md` at the `v2.36.0` tag (`not-reviewed`).
- [x] `Accepted`: a committed host bundle carries `openwop.requirement.0201.opt-in-only`, `.delivery-signed`, `.message-id-stable` and `.endpoint-verification` at `executed-pass`, with nothing relaxed. A second host, or `.secret-rotation`, strengthens the evidence but is not required at tier-1. — the certified public v2-reference bundle on published suite 2.38.0 (`evidence/v2-host-bundles/openwop-host-v2-reference.json`, openwop#1542; build `commit:1157625f`, witness `669d926abf45`, 385 executed-pass / 0 fail / 0 blocked, relaxations `[]`, all three profiles certified): `.opt-in-only`, `.delivery-signed`, `.message-id-stable`, `.endpoint-verification`, `.registration-validated` and `.secret-rotation` all `executed-pass`.
- [x] Amended-by rows added to RFC 0165 and RFC 0171 (the implementation PR, `feat/rfc-0201-standard-webhooks`).
- [x] `docs/WAIVER-RETROSPECTIVE-REGISTER.md` row `0201 … not-reviewed`, and `MAINTAINERS.md` waiver row marked **STEWARD OVERRIDE of RFC 0147 §A.6** (both landed with the filing PR).
- [x] CHANGELOG entry (the implementation PR).

## References

- Standard Webhooks 1.0.0, `spec/standard-webhooks.md` at tag `v1.0.0` (fetched 2026-09-22; identical on `main`): §"Webhook metadata", §"Signature scheme", §"Webhook headers", §"Verifying signatures", §"Migrating to Standard Webhooks"; reference library `libraries/javascript/src/index.ts` (key = base64-decode after `whsec_`; 5-minute tolerance).
- `spec/v1/webhooks.md` §Headers, §"Signature algorithm versioning", §"Secret rotation", §"Delivery-time egress validation"; `spec/v2/core/webhooks.md` §Surfaces, §Headers, §Verification, §Durability, §Egress; `spec/v2/core/headers.md`; RFC 0165 §C.1; RFC 0171 §C.1; RFC 0173 §B; RFC 0176 §D.2; RFC 0188; RFC 0158 (restart hook); RFC 0147 §A.6, §A.10.
- Review `openwop-mcp-a2a-review.md` slice D F1 and §4 "Where upstream is stronger"; `review/verify-CD.md` D-F1; `review/arch-P3.md` P3-C2, P3-C3, P3-H9.
