# OpenWOP Interop Matrix

Which hosts implement OpenWOP, what each one claims, and the signed evidence behind the claim.

**How to read it.**
- A row is a **claim plus evidence**. The claim is what the host advertises at `/.well-known/openwop`. The evidence is a signed conformance bundle committed under [`evidence/v2-host-bundles/`](./evidence/v2-host-bundles/), which anyone can re-verify.
- A profile is **certified** only when the bundle shows every floor requirement of that profile witnessed, with nothing `blocked` (RFC 0148, RFC 0168). An unqualified "OpenWOP conformant" means `openwop-core-standard`.
- The five counts are the bundle's requirement rows: **pass / fail / blocked / inapplicable / skipped**. `inapplicable` means the host does not advertise that optional surface. It is not a failure.
- **Who runs it** uses the evidence tiers of `GOVERNANCE.md` §"Acceptance evidence tiers": tier 1 is the steward's own host, tier 2 a steward-affiliated host, tier 3 an independent organization. There is no tier-3 host yet.

The full measurement history (every per-deploy note, superseded row and per-capability table) is in [`docs/INTEROP-EVIDENCE-LOG.md`](./docs/INTEROP-EVIDENCE-LOG.md).

## v2 — the current major

Each row shows the host's newest certified bundle and the suite version that measured it. Verify any row with `node scripts/check-cut-gates.mjs --host-bundle <bundle>`, or the bundle's signature with `npx @openwop/openwop-conformance --verify <bundle> --host-key <key>`. Its Coexistence group reports `blocked` for a host that does not mount the conformance seams, since the fork and pack-ceiling legs run only through them. A host that has dropped v1 is excused the two overlap legs once it refuses the dropped major.

| Host | Who runs it | Suite (cut) | pass / fail / blocked / inapplicable / skipped | Certified profiles | Evidence tier | Bundle |
| --- | --- | --- | --- | --- | --- | --- |
| **`openwop-host-v2-reference@2.0.0-rc.1`** — the v2 reference example ([`examples/hosts/v2-reference`](https://github.com/openwop/openwop-examples/tree/main/examples/hosts/v2-reference)) | Steward, reference example (tier 1). Built from `spec/v2/core/`. | 2.45.29 (2026-10-09, build `bb1a42d6`) | 524 / 0 / 0 / 263 / 10 | `openwop-discovery-core` · `openwop-core-standard` · `openwop-conformance-seams-v2` | `self` | [`openwop-host-v2-reference.json`](./evidence/v2-host-bundles/openwop-host-v2-reference.json) |
| **`myndhyve@a4ee6491`** — MyndHyve `workflow-runtime`, production at `api.myndhyve.ai` | Steward-affiliated, production (tier 2) | 2.45.25 (2026-10-08, build `a4ee6491`) | 397 / 0 / 0 / 389 / 17 | `openwop-discovery-core` · `openwop-core-standard` | `self` | [`myndhyve.json`](./evidence/v2-host-bundles/myndhyve.json) |
| **`openwop-workflow-engine@0.1.0`** — openwop-app, production at `app.openwop.dev` (protocol origin `api.openwop.dev`) | Steward, production (tier 1) | 2.45.30 (2026-10-10, build `7643ddb8e`) | 423 / 0 / 0 / 371 / 11 | `openwop-discovery-core` · `openwop-core-standard` | `self` | [`openwop-workflow-engine.json`](./evidence/v2-host-bundles/openwop-workflow-engine.json) |

Notes on the rows:
- The `@<version>` in each host cell is the label the v1 end-of-support clock recorded when it anchored ([`evidence/v1-end-of-support.json`](./evidence/v1-end-of-support.json)). The bundle carries the host's current version and build.
- **openwop-app** serves v2 only: its newest bundle advertises `protocolVersions: ["2.0"]`. It certified `openwop-conformance-seams-v2` on a 0%-traffic side revision of its production image, with the seams switched on ([`openwop-workflow-engine-side-rev-rfc0199-2.42.2.json`](./evidence/v2-host-bundles/openwop-workflow-engine-side-rev-rfc0199-2.42.2.json), suite 2.42.2). Production does not expose the seams.
- **MyndHyve** is closed source. Its bundle is verified against the key its live discovery document publishes.
- **Evidence tier** is the bundle's own field (RFC 0148). Every bundle here is `self`: the host operator cut it.
- Older and side bundles for each host stay under [`evidence/v2-host-bundles/`](./evidence/v2-host-bundles/), named `<host>-<suite>[-<scope>].json`.

## v1 reference examples

v1 reached end of support on 2026-10-04 ([RFC 0234](./RFCS/0234-maintainer-set-v1-end-of-support.md)); `spec/v1/` is frozen. Four reference examples in `openwop-examples` still serve the v1 wire and have no v2 bundle. Each was last measured at suite 1.130.0.

| Host | Repo / Path | Evidence |
| --- | --- | --- |
| **In-memory** (reference example) | [`examples/hosts/in-memory`](https://github.com/openwop/openwop-examples/tree/main/examples/hosts/in-memory) | [`conformance.md`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/in-memory/conformance.md) |
| **SQLite** (reference example) | [`examples/hosts/sqlite`](https://github.com/openwop/openwop-examples/tree/main/examples/hosts/sqlite) | [`conformance.md`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/sqlite/conformance.md) |
| **Python in-memory** (reference example) | [`examples/hosts/python`](https://github.com/openwop/openwop-examples/tree/main/examples/hosts/python) | [`conformance.md`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/python/conformance.md) |
| **Postgres** (reference example) | [`examples/hosts/postgres`](https://github.com/openwop/openwop-examples/tree/main/examples/hosts/postgres) | [`conformance-full.md`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/postgres/conformance-full.md) |

Each claims `openwop-discovery-core`; Postgres also claims the `production` profile. The full profile list is in each host's evidence file and in the [evidence log](./docs/INTEROP-EVIDENCE-LOG.md).

## Capabilities by host

Optional capabilities each production host has advertised and demonstrated. The certified v2 bundles above are the authoritative current state; this table is a summary, and the dated evidence for every cell is in the [evidence log](./docs/INTEROP-EVIDENCE-LOG.md).

✓ advertised and witnessed · ◐ implemented but not advertised, or only partly witnessed · ✗ ruled out by the host · — not implemented · n/m not measured

| Capability | RFC | openwop-app | MyndHyve |
| --- | --- | :-: | :-: |
| Durable single-instance rung | 0158 | ✓ | ✓ |
| Poison work terminates in bounded attempts | 0158 §C.8 | ✓ | n/m |
| Replay side-effect suppression (`recorded-outcome`) | 0140 | ✓ | — |
| Host-initiated fan-out on a replay fork is an external effect | replay.md | ✓ | ◐ (deployed; the suite cannot observe it there) |
| Compensation and partial failure | 0151, 0157 | ✓ | — |
| Memory profile | 0080 | ✓ | ✓ |
| Agent platform profile | 0085 | n/m | ✓ |
| Connection packs | 0095 | ✓ | ✓ |
| Connection-pack provider `vendor` grouping | 0123 | ✓ | — |
| Multi-turn conversation primitive | 0005 | ✓ | ✓ |
| Multi-party group conversation | 0101 | ✓ | — |
| Localized content | 0103 | ✓ | ✓ |
| Parallel sub-workflow fan-out and join | 0118 | ✓ | ✓ |
| Per-item input for data-parallel dispatch | 0126 | ✓ | ✓ |
| Per-run parameter deferral | 0124 | ✓ | ✗ |
| Streaming and CDC trigger sources | 0127 | ✓ | ✗ |
| Self-hosted runner | 0122 | ✓ | ✓ |
| Self-hosted / OpenAI-compatible providers | 0108 | ✓ | — |
| Portable prompt-prefix cache | 0116 | ✓ | — |
| Subscription-reuse provider auth | 0121 | ◐ (refusal rail only) | — |
| Anonymous-actor authorization | 0132 | ✓ | — |
| Purpose-propagation labels | 0128 | ✓ | ✗ (opt-out) |
| SAML ⟷ SCIM subject linking | 0159, 0163 | ✓ | ◐ (SAML only) |
| Front-end plugin packs | 0117, 0119 | ✓ | — |
| A2UI surface deltas | 0114 | ◐ (not advertised) | — |

## Composition partners

The suite's MCP and A2A probes run against reference implementations of the neighbouring protocols. [A2A vs MCP vs OpenWOP](https://openwop.dev/comparisons/a2a-openwop-mcp/) explains how the three layers compose.

| Partner | Reference implementation | Result |
| --- | --- | --- |
| **MCP** | `@modelcontextprotocol/sdk@1.29.0`, all three transports | ✓ round-trip passes |
| **A2A** | `@a2a-js/sdk@0.3.13` reference peer (measured before v2). The v2 A2A 1.0 legs run against the suite's own fake peer. | ✓ round-trip passes |

## Add A Host

The full path is [`docs/IMPLEMENTER-PATH.md`](docs/IMPLEMENTER-PATH.md); build against [`docs/IMPLEMENT-CORE.md`](docs/IMPLEMENT-CORE.md).

1. Implement the **v2** wire contract in `spec/v2/core/`. `spec/v2/profiles.json` lists every scenario in the `openwop-core-standard` floor, so the bar is known before you start.
2. Seed the fixtures the floor needs (`conformance-noop`, `conformance-cancellable`, `conformance-delay`) and advertise them at `/.well-known/openwop`.
3. Run the suite: `npx @openwop/openwop-conformance --base-url <url> --api-key <key> --target-major 2 --require-behavior`. With `--require-behavior`, an advertised behaviour the suite cannot observe fails instead of being skipped.
4. Cut a signed bundle: add `--certify bundle.json --bundle-version 3 --host-build commit:<sha> --signing-key <pem> --signing-key-id <id>`, and publish the matching public key in your discovery document's `signingKeys[]`.
5. Open a PR that adds your bundle under `evidence/v2-host-bundles/` and your row to the v2 table above. `scripts/check-cut-gates.mjs --host-bundle <bundle>` reports `blocked` on the matrix-row check until that row exists; that is expected on a first submission.

Your evidence is your own signed bundle, and nothing in this path needs the steward's permission. A host run by an independent organization is tier 3, the evidence tier the project does not have yet.

## See Also

- [`docs/INTEROP-EVIDENCE-LOG.md`](./docs/INTEROP-EVIDENCE-LOG.md) — the full measurement history.
- [`conformance/README.md`](./conformance/README.md) — how to run the suite.
- [`spec/v2/profiles.json`](./spec/v2/profiles.json) — the v2 profile floors.
