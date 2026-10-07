# RFC 0238: a host's front-end plugin boundary is observable

| Field             | Value                                                           |
| ----------------- | --------------------------------------------------------------- |
| **RFC**           | 0238                                                            |
| **Title**         | a host's front-end plugin boundary is observable                |
| **Status**        | `Accepted`                                                      |
| **Author(s)**     | David Tufts (@davidscotttufts)                                  |
| **Created**       | 2026-10-06                                                      |
| **Updated**       | 2026-10-07 — **`Active → Accepted`, provisional pending the RFC 0156 §B retrospective review** (STEWARD OVERRIDE of RFC 0147 §A.6, register row `not-reviewed`). Evidence tier: tier-1 — openwop-app, the steward's production host: its certified cut on published suite 2.45.23 at the protocol origin `api.openwop.dev` (`evidence/v2-host-bundles/openwop-workflow-engine.json`; build `commit:e33f3a19c`, signed `openwop-app-bundle-2`, 379 pass / 0 fail / 0 blocked, `openwop-discovery-core` and `openwop-core-standard` certified; openwop-app #4509 and #4568, ADR 0840) records the four `openwop.requirement.0238.ui-plugin.*` ids `executed-pass`. Its front end mounts plugins by the frame URL (§B.5). Gap G1 is closed on that cut. · 2026-10-06 — `Draft` → `Active`, comment window waived by the maintainer (2026-10-06: "bypass the 7 day period and proceed to active"), recorded as a STEWARD OVERRIDE of RFC 0147 §A.6 in MAINTAINERS.md. The facet, both operations, the fixture, the `packs.md` rules (word-neutral) and `v2-ui-plugin-boundary` ship in suite 2.45.23, proven against a double. · 2026-10-06 — filed `Draft` after an `/architect` ruling (2026-10-06). The 7-day comment window opens with the pull request and closes 2026-10-13. |
| **Affects**       | two new optional v2 operations, `GET /host/ui-plugins/{packName}/{pluginId}/frame` and `POST /host/ui-plugins/{packName}/{pluginId}/rpc` (`api/v2/openapi.yaml`, added in `scripts/derive-v2-api.py` as v2-only operations) · a new optional facet `uiPlugins.served` (`schemas/v2/capabilities.schema.json`) · a conformance fixture pack `ui-plugin-pack-narrow` · `spec/v2/core/packs.md` §Front-end plugin packs · the `witness` of the four `frontend-plugin-*` rows of `SECURITY/invariants.yaml` · a new v2 scenario |
| **Compatibility** | `additive` (COMPATIBILITY.md §2.4): two optional operations behind one optional facet, and one optional fixture. A host that advertises neither is bound exactly as today. |
| **Supersedes**    | —                                                               |
| **Superseded by** | —                                                               |

## Summary

Four protocol-tier SECURITY invariants guard front-end plugins: isolation from host context, deny-egress, the closed host-RPC allowlist, and no BYOK material across the boundary. Each is witnessed only through the v1 seam `POST /v1/host/sample/ui-plugin/rpc`. v1 reached end-of-support on 2026-10-04 and v2 mounts no plugin seam, so `conformance.md` §Witness class requires a normative observation path or demotion to SHOULD. This RFC mints the path. A host serves each plugin's frame document with its isolation and egress policy in response headers, and serves the plugin's `ui-plugin/1` calls at a normative dispatch operation. An operator-installed fixture pack makes the allowlist and the boundary testable.

## Motivation

**The corpus breaks its own witness rule.** `spec/v2/core/conformance.md` §Witness class: "A MUST whose only witness is `seam-gated` MUST either mint a normative observation path before the cut or be demoted to SHOULD." `frontend-plugin-isolation`, `frontend-plugin-egress`, `frontend-plugin-rpc-allowlist` and `frontend-plugin-no-byok` are `witness: seam-gated`, and their only behavioral legs (`frontend-plugin-packs.test.ts`) drive the v1 seam (`spec/v1/host-sample-test-seams.md` §17). Three are severity `critical`. Demoting them is not acceptable, and marking a protocol-tier invariant `unwitnessable` fails the corpus gate.

**The one host that serves plugins already dispatches server-side.** openwop-app is the only matrix host advertising `uiPlugins`. Its browser bridge forwards every `ui-plugin/1` `postMessage` to a production endpoint, `POST /v1/host/openwop-app/ui-plugin/rpc` (tenant-scoped, always mounted), which runs the real dispatcher. The behaviour exists. It is reachable only at a vendor path the suite does not know.

**Two things the vendor path does not show.**

1. **The manifest half of the allowlist.** `packs.md` requires refusing a method outside *both* allowlists: the plugin's declared `hostApi` and the host's. openwop-app's server checks only the host's set, because the request does not say which plugin is calling. The manifest half lives in browser code.
2. **Isolation and egress.** openwop-app enforces both in its front end: an `iframe` with `sandbox="allow-scripts"` and an `srcdoc` that injects a deny-egress `<meta>` policy. An HTTP observer sees neither.

## Proposal

### §A. The facet

`uiPlugins` gains one optional member:

```json
"uiPlugins": { "isolation": "cross-origin-iframe", "served": true }
```

- `served: true` means the host serves §B and §C for every plugin it has installed.
- A host advertising `uiPlugins` SHOULD advertise `served`.

### §B. The frame document

`GET /host/ui-plugins/{packName}/{pluginId}/frame` (`getUiPluginFrame`), v2 only.

1. A host advertising `uiPlugins.served` MUST serve it for each installed plugin. A plugin that is not installed, or a host without the facet, answers `404 not_found`.
2. The `200` is the HTML document the host mounts for the plugin (`text/html`). It is the document the plugin actually runs in, not a description of it.
3. **Isolation (`frontend-plugin-isolation`).** When `uiPlugins.isolation` is `cross-origin-iframe`, the response MUST carry a `Content-Security-Policy` whose `sandbox` directive admits `allow-scripts` and MUST NOT admit `allow-same-origin`. The directive gives the document an opaque origin however it is embedded, so the header is the isolation property, not a hint about it.
4. **Egress (`frontend-plugin-egress`).** The same policy MUST set `default-src 'none'`, and its `connect-src` MUST admit nothing beyond the plugin's declared `connectSrc`. A plugin with none gets no `connect-src` source.
5. The host MUST mount plugins only through this document. Mounting the same bytes another way, such as an `srcdoc` with a weaker policy, is the defect this observation path exists to catch.
6. Scope: the frame carries no tenant data and no credential, so it is readable with `manifest:read`.

### §C. The dispatch operation

`POST /host/ui-plugins/{packName}/{pluginId}/rpc` (`dispatchUiPluginRequest`), v2 only.

1. A host advertising `uiPlugins.served` MUST serve it, through the same dispatcher its plugin boundary uses. A plugin that is not installed answers `404 not_found`.
2. The request body is `{ "message": <ui-plugin/1 request> }` (`schemas/v2/ui-plugin-message.schema.json`). A body that does not validate answers `400 validation_error`.
3. Any validated request answers `200` with the `ui-plugin/1` response envelope. A refused call is `ok: false` inside that envelope, never an HTTP error.
4. **Allowlist (`frontend-plugin-rpc-allowlist`).** A `method` outside the plugin's declared `hostApi`, or outside the advertised `uiPlugins.hostApi`, MUST return `{ ok: false, error: { code: "method_not_allowed" } }` and MUST NOT execute.
5. **Authority.** The call runs as the caller and is authorized per method, exactly as the equivalent artifact operation would be. The operation grants nothing the caller's credential does not already hold.
6. **No BYOK (`frontend-plugin-no-byok`).** No response, including `error.message`, may carry resolved credential material.

### §D. The conformance fixture

`conformance/fixtures/frontend-plugin-packs/` gains `ui-plugin-pack-narrow`: a frontend-plugin pack with one plugin, `narrow`, declaring `hostApi: ["artifact.read"]` and no `connectSrc`. It comes with an artifact, `ui-plugin-narrow-artifact`, whose stored content references the BYOK canary `openwop-conformance-canary-secret` (`fixtures.md`).

1. An operator MAY install the pack through the host's normal install path, signing it with a key the host trusts for this pack only. That trust MUST be an explicit operator act and MUST NOT be on by default. No conformance signing key is distributed.
2. The operator also creates `ui-plugin-narrow-artifact`, readable by the conformance credential.
3. The pack is never advertised in discovery `fixtures`, which names workflow fixtures (RFC 0233 §D.3).

### §E. Prose

`packs.md` §Front-end plugin packs binds a host with `uiPlugins.served` to mount plugins only from `getUiPluginFrame` and to serve `dispatchUiPluginRequest`. The operations' OpenAPI descriptions carry §B.3–§B.4 and §C.2–§C.6, and so `headers.md`. The kernel budget was full, so the edit is word-neutral: it trims three illustrative phrases in `packs.md`.

### §F. Conformance

A new scenario, `v2-ui-plugin-boundary`, gated on `uiPlugins.served`:

1. **isolation** (`openwop.requirement.0238.ui-plugin.frame-isolated`): with `isolation: cross-origin-iframe`, the fixture's frame carries a `sandbox` directive with `allow-scripts` and without `allow-same-origin`.
2. **egress** (`openwop.requirement.0238.ui-plugin.frame-deny-egress`): the same policy sets `default-src 'none'` and admits no `connect-src` source.
3. **allowlist** (`openwop.requirement.0238.ui-plugin.rpc-allowlist`): `artifact.write` and `host.navigate` (in the `ui-plugin/1` enum, not declared) each return `method_not_allowed`. `host.exec` (outside the enum) is not executed: `400` per §C.2, or a refusal. `artifact.read` of the fixture artifact returns `ok: true`, the control.
4. **no-byok** (`openwop.requirement.0238.ui-plugin.no-byok`): no `artifact.read` or `artifact.write` response contains canary material (`lib/canaries.ts`).

Dispositions: no `served` ⇒ every leg `inapplicable`. The §D fixture not installed (`404`) ⇒ every leg `inapplicable`: no operation lists installed plugins, so the fixture is the only plugin the suite can name. An `isolation` other than `cross-origin-iframe` ⇒ leg 1 `inapplicable` (§Decisions 3).

The four invariant rows move from `seam-gated` to `witnessable-gated`, and the seam count in `docs/witness-baseline.json` falls.

### Falsifiability — one row per normative requirement

| Requirement | Observable — what an outside party sees | Who can cause the condition | Verdict |
| --- | --- | --- | --- |
| §B.3 a cross-origin-iframe plugin's frame is sandboxed without same-origin — `openwop.requirement.0238.ui-plugin.frame-isolated` | the frame's `Content-Security-Policy` `sandbox` directive | the operator, by installing a plugin (the §D fixture or any other) | witnessable — executed-pass required on a host bundle |
| §B.4 the frame denies egress beyond declared `connectSrc` — `openwop.requirement.0238.ui-plugin.frame-deny-egress` | `default-src 'none'` and the `connect-src` sources | the operator, by installing the §D fixture | witnessable — executed-pass required on a host bundle |
| §C.4 a method outside either allowlist is refused unexecuted — `openwop.requirement.0238.ui-plugin.rpc-allowlist` | `method_not_allowed` for `artifact.write` and `host.exec`; `ok: true` for `artifact.read` | the operator, by installing the §D fixture | witnessable — executed-pass required on a host bundle |
| §C.6 no response carries credential material — `openwop.requirement.0238.ui-plugin.no-byok` | no canary value in any dispatch response | the operator, by installing the §D fixture and provisioning the canary | witnessable — executed-pass required on a host bundle |
| §B.5 plugins are mounted only through the frame document | none from outside: how a browser page embeds a frame is not on the wire | nobody, from outside | unwitnessable — embedding happens in the host's own page; §B.3's `sandbox` directive holds wherever the document is mounted |

## Compatibility

`additive`.

- Two optional v2 operations behind one optional facet, one fixture, four requirement ids.
- No existing field, endpoint, error code or rule changes. `method_not_allowed` keeps its meaning.
- A host advertising `uiPlugins` without `served` is bound exactly as today. Its four invariants record `inapplicable` with the reason.

## Alternatives considered

1. **Demote the four MUSTs to SHOULD** (`conformance.md` §Witness class allows it). Rejected: three are critical, and plugins are registry-distributed third-party code.
2. **Re-tier them `reference-impl`**, witnessed by the host's own browser tests. Rejected: it moves verification into one host's CI, which no third party runs.
3. **Keep the seam as the only witness.** Rejected: §Witness class forbids it for a MUST, and the seam count is a ratchet.
4. **Drive a headless browser from the suite.** It would observe the real `iframe` attribute. Rejected: the suite is a black-box HTTP client with no runtime dependencies, and a browser would not see a server-side dispatcher anyway.
5. **A host-global dispatch path without the plugin in it**, like openwop-app's vendor path. Rejected: the manifest half of the allowlist is then unobservable (§Motivation).

## Decisions

An `/architect` review decided these on 2026-10-06.

1. **Path under `/host`.** `/ui-plugins` would be a new top-level segment, and openwop-app already serves `/ui-plugins` as a browser route (`check-manifest-top-level-segments`; `versioning.md` §5). `/host` is already a manifest segment.
2. **Scope.** The frame reads with `manifest:read`. The dispatch is authorized per method as the caller (§C.5), so no new scope is minted.
3. **Other isolation mechanisms.** `wasm`, `process`, `container`, `vm` and `x-host-*` have no HTTP-visible boundary. For those hosts, leg 1 is `inapplicable` and the invariant keeps its seam witness on a side revision. No matrix host ships one.
4. **The fixture is operator-trusted, not default-trusted** (§D.1), because frontend-plugin packs MUST verify their signature and fail closed.
5. **The always-on schema legs** of `frontend-plugin-packs.test.ts` read only the corpus and belong in `src/coherence/` (`conformance.md` §Two products). That file is a major-1 scenario on the frozen v1 tree, so the move is tracked separately (gap G3) rather than made here.

## Implementation notes (non-normative)

- **openwop-app:** it already runs the dispatcher server-side. The work is (a) mounting it at the normative path with the plugin identity, so the manifest half of the allowlist is enforced server-side; (b) serving the frame document with the policy in headers, and mounting the `iframe` from that URL instead of an `srcdoc`; (c) installing the §D fixture under explicit operator trust.
- **Sequencing.** Draft → Active with the facet, operations, fixture, prose and the scenario, proven against a double. openwop-app then serves both operations, and its certified production cut is the acceptance evidence.

## Acceptance criteria

- [x] `Active`: the comment window was waived on the record (maintainer, 2026-10-06; MAINTAINERS.md) with §B and §C unchanged in substance.
- [x] The facet is in the v2 schema (`spec/v2/facets/uiPlugins.schema.json`); both operations are in `api/v2/openapi.yaml`; the fixture is catalogued in `fixtures.md`; `packs.md` carries the rules; `CHANGELOG.md` records it.
- [x] `v2-ui-plugin-boundary` ships in 2.45.23 over `lib/ui-plugin-boundary-witness.ts`. Each leg fails on its sabotage in the self-test double (12 cases): `allow-same-origin`, no `sandbox`, an open `default-src`, an undeclared `connect-src`, an undeclared method executed, a method outside the enum executed, the declared method refused, canary material in a response. A host without `served`, or without the fixture, records `inapplicable` on every leg.
- [x] The four invariant rows read `witnessable-gated`; the seam-gated count falls from 93 to 89.
- [x] `Accepted`: a host advertising `uiPlugins.served`, with the §D fixture installed, records the four `openwop.requirement.0238.*` ids `executed-pass` on a certified bundle. *(2026-10-07: openwop-app's certified cut on published suite 2.45.23, build `commit:e33f3a19c`, at `api.openwop.dev`. A first cut at `d38aa0277` failed `rpc-allowlist`: the fixture artifact sat behind a plan paywall for the conformance tenant, a host fault fixed in openwop-app #4568.)*

## References

- `spec/v2/core/conformance.md` §Witness class, §Two products; `spec/v2/core/packs.md` §Front-end plugin packs; `spec/v1/host-sample-test-seams.md` §17.
- RFC 0117 (front-end plugin packs), RFC 0119 (isolation amendment), RFC 0130 (canvas preview), RFC 0233 (the observation-path pattern this follows), RFC 0234 (v1 end-of-support).
- `SECURITY/invariants.yaml` `frontend-plugin-isolation`, `frontend-plugin-egress`, `frontend-plugin-rpc-allowlist`, `frontend-plugin-no-byok`; `conformance/src/scenarios/frontend-plugin-packs.test.ts`.
- Registers: [`gaps`](./registers/0238-ui-plugin-observation-path.gaps.md), [`risks`](./registers/0238-ui-plugin-observation-path.risks.md).
