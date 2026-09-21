# RFC 0196: `callbackUrl` is refused or delivered under the egress guard, and an embedded IPv4 address is judged as IPv4

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0196                                                            |
| **Title**         | `callbackUrl` is refused or delivered under the egress guard, and an embedded IPv4 address is judged as IPv4 |
| **Status**        | `Draft`                                                         |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-09-21                                                      |
| **Updated**       | 2026-09-21 (filed `Draft`; **the public comment window runs in full, to 2026-09-28** — RFC 0147 §A.6: this RFC affects external effects, so bootstrap waiver language MUST NOT shorten its window) |
| **Affects**       | `spec/v2/core/runs.md` (`createRun.callbackUrl`), `spec/v2/core/interrupt.md`, `spec/v2/core/webhooks.md` §SSRF, the `interrupt` family's facets, `spec/v1/rest-endpoints.md` (a pointer only), conformance |
| **Compatibility** | `additive` per `COMPATIBILITY.md`                               |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

`createRun.callbackUrl` is a member of the closed create body at both majors and specified nowhere; `interrupt.md`, which the OpenAPI description points to, never mentions it. Measured on three hosts, it gets three behaviours: one accepts it and ignores it, one refuses it, and one delivers a vendor-shaped approval request to it — with, until 2026-09-21, no egress guard on a request to a URL the caller chose. Separately, the webhook egress guard of the same hosts judged an IPv4-mapped IPv6 address by its dotted spelling, which a URL parser never emits, so loopback, cloud metadata and RFC 1918 passed. This RFC makes `callbackUrl`'s delivery discoverable, binds a delivering host to the webhook egress guard, and states that an address embedding IPv4 is judged by the IPv4 it embeds.

## Motivation

**`callbackUrl` (openwop#1449).** `api/openapi.yaml` and `api/v2/openapi.yaml` describe it as "Signed-token HITL callback URL (see `interrupt.md`)"; `runs.md` lists it among the closed `createRun` members; `interrupt.md` does not contain the word "callback". v2 mints signed resolve tokens (`interrupt.md` §Tokens) and specifies no channel by which a token reaches its holder — `callbackUrl` is that missing channel. Measured 2026-09-21:

| host | behaviour |
| --- | --- |
| v2 reference host | `201`, member not stored, nothing delivered |
| openwop-app | `400 validation_error`, `details.field: callbackUrl` |
| MyndHyve | on an approval interrupt, POSTs a signed approval request to it; now guarded (it was not) |

A client cannot tell these apart, and an outbound request to a caller-chosen URL is the surface `webhooks.md` §SSRF exists for.

**Embedded IPv4.** `webhooks.md` §SSRF requires refusing loopback, link-local, RFC 1918 and metadata destinations. The WHATWG URL parser normalises `https://[::ffff:127.0.0.1]/` to hostname `::ffff:7f00:1`. A guard that recognised only the dotted mapped form accepted it — measured on the steward's reference host at registration and at delivery (two POSTs reached a real loopback listener), and present in two other hosts' guards. Suite 2.35.0 already adds three hex-mapped probes to `0171.webhook-egress-refused` as enforcement of the existing MUST; this RFC writes the rule down and extends it to the other standard translation forms.

## Proposal

### §A `callbackUrl`

1. The `interrupt` family gains an optional boolean facet `interrupt.callbackDelivery`. A host advertises `true` only if it delivers to `callbackUrl`.
2. A host that does not advertise `interrupt.callbackDelivery: true` SHOULD refuse a `createRun` carrying `callbackUrl` with `400 validation_error` and `details.field: "callbackUrl"`. It MUST NOT advertise delivery it does not perform.
3. A host that advertises `interrupt.callbackDelivery: true` MUST apply the `webhooks.md` §SSRF guard to `callbackUrl`: at `createRun` it MUST refuse, with `400 validation_error` and `details.field: "callbackUrl"`, a URL the registration guard would refuse; at delivery it MUST re-validate every resolved address and MUST NOT follow a redirect.
4. The delivery's payload, timing and signing are host-defined in this revision; a later RFC may specify an interoperable shape. `interrupt.md` says so, and the OpenAPI description of `callbackUrl` points there.

### §B An address that embeds IPv4

5. An IPv6 address in the IPv4-mapped form (`::ffff:0:0/96`) MUST be judged, everywhere `webhooks.md` §SSRF applies, by the IPv4 address it embeds — whatever its spelling. (It is that IPv4 address; this states the existing rule.)
6. An IPv6 address that embeds IPv4 in another standard translation form — IPv4-compatible (`::/96`, other than `::` and `::1`), NAT64 (`64:ff9b::/96`) and 6to4 (`2002::/16`) — SHOULD be judged by the IPv4 address it embeds. A host SHOULD NOT deny those prefixes wholesale: an IPv6-only host behind DNS64 is legitimately handed `64:ff9b::<public IPv4>` for a public destination.
7. A host SHOULD refuse every destination that the IANA IPv4 and IPv6 Special-Purpose Address Registries mark not globally reachable, in addition to the classes `webhooks.md` §SSRF names.

**Positive examples.** `https://[64:ff9b::5db8:d822]/` (NAT64 of a public address) is accepted; a `callbackUrl` of `https://hooks.example.com/approve` is accepted by a host advertising delivery.

**Negative examples.** `https://[::ffff:7f00:1]/`, `https://[::ffff:a9fe:a9fe]/` (cloud metadata) and `https://[64:ff9b::7f00:1]/` are refused; a host advertising `interrupt.callbackDelivery: true` answering `201` to `callbackUrl: https://[::ffff:7f00:1]/hook` violates §A.3.

## Compatibility

**Additive.** §A.1 is a new optional facet; a host that does not advertise it is bound only by SHOULDs (§A.2) and by not claiming delivery it does not perform. §A.3 binds only an advertising host. §B.5 states an existing obligation (a mapped address *is* its IPv4 address); §B.6–§B.7 are SHOULDs. No field, endpoint or error meaning changes, and no `MUST` is relaxed. `callbackUrl` stays in the create body at both majors.

## Conformance

Lands when this RFC is `Active` (`check-rfc-status-coherence.mjs` rule 7).

- The existing `0171.webhook-egress-refused` probes already cover §B.5 (suite 2.35.0); a NAT64 loopback probe joins it as a SHOULD-level observation recorded in the row's detail, never as a failure.
- A new major-2 leg, gated on `interrupt.callbackDelivery: true`: `createRun` with `callbackUrl` naming loopback, cloud metadata and an IPv4-mapped loopback MUST each answer `400 validation_error` with `details.field: "callbackUrl"`. `inapplicable` where the facet is absent.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §A.1 / §A.2 advertisement is honest | nothing — whether a host delivers is visible only to a receiver the host chooses to call | — | unwitnessable — delivery happens only on an interrupt, to a URL the suite would have to expose publicly; the advertising half is checked by §A.3 on hosts that advertise |
| §A.3 a delivering host guards `callbackUrl` at create time | `400 validation_error`, `details.field: "callbackUrl"`, for a loopback / metadata / mapped-loopback `callbackUrl` | the suite, unaided, on a host advertising `interrupt.callbackDelivery: true` | witnessable — gated on the `interrupt.callbackDelivery` facet |
| §A.3 delivery-time re-validation, no redirects | nothing — a host's resolver and connector are not on the wire | — | unwitnessable — same reason as the reference-impl invariant `webhook-delivery-egress-revalidation` |
| §B.5 mapped IPv4 judged as IPv4 | `400 webhook_url_rejected` for `https://[::ffff:7f00:1]/` and siblings | the suite, unaided, gated on `webhooks` (`0171.webhook-egress-refused`) | witnessable — gated on the `webhooks` family |

## Alternatives considered

- **Remove `callbackUrl` at major 2.** v2.x is additive-only; one production host uses it.
- **Require every non-advertising host to refuse it.** Makes the reference host's current `201` a violation — a new MUST on existing behaviour, which `COMPATIBILITY.md` §3 allows only as a safety fix with a 90-day window; a non-delivering host has no egress exposure to fix.
- **Specify the delivery shape now.** No second host delivers; a shape specified from one vendor's payload would be that vendor's shape. The likely shape — an `interrupt.requested` delivery under the webhook rules carrying `{ token, expiresAt }`, authenticated by the receiver calling `GET /interrupts/{token}` — is recorded here for the later RFC.
- **Deny NAT64 and 6to4 wholesale.** Breaks IPv6-only hosts behind DNS64.

## Unresolved questions

1. The interoperable delivery shape (§A.4) — deferred until a second host delivers.
2. Whether §B.6 should become a MUST once hosts report its cost.

## Implementation notes (non-normative)

The v2 reference host judges egress by address since openwop-examples#67 (bytes, embedded IPv4 unmapped, only globally reachable allowed). It accepts and ignores `callbackUrl` today and will refuse it (§A.2) when this RFC is `Active`. MyndHyve guards `callbackUrl` at create time and at delivery (its #460); openwop-app refuses it.

## Acceptance criteria

- [ ] The public comment window has run in full (to 2026-09-28) and the RFC is `Active`.
- [ ] Spec text merged: `runs.md`, `interrupt.md`, `webhooks.md` §SSRF, the facet in the `interrupt` family's declaration.
- [ ] The §A.3 leg ships in a published suite.
- [ ] A committed host bundle from a host advertising `interrupt.callbackDelivery: true` carries the §A.3 row at `executed-pass` — or the RFC records that no host advertises it.

## References

- openwop#1449; RFC 0147 §A.6; `spec/v2/core/webhooks.md` §SSRF; `spec/v2/core/interrupt.md` §Tokens; IANA IPv4 / IPv6 Special-Purpose Address Registries; RFC 6052 (NAT64), RFC 3056 (6to4), RFC 4291 §2.5.5 (IPv4-mapped / -compatible).
