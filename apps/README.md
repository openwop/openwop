# OpenWOP Reference Applications

End-to-end deployable sample applications built on the published OpenWOP v1.x protocol. Each subdirectory is a runnable, production-shaped template — not a single-file demo (those live under `examples/`) and not a normative reference host (those live under `examples/hosts/`).

## What lives here vs. elsewhere

| Tier | Where | What it is |
|---|---|---|
| **Spec** | `spec/v1/`, `RFCS/`, `schemas/`, `api/` | Normative wire contract |
| **SDKs** | `sdk/{typescript,python,go}/` | Client libraries |
| **Reference hosts** | `examples/hosts/{in-memory,sqlite,postgres,python}/` | Conformance-test targets; minimal HTTP servers per storage adapter |
| **Examples** | `examples/{tiny-workflow,streaming-client,…}` | Single-file demos that consume a host |
| **Reference applications** | `apps/` (this directory) | Full vertical-slice deployable templates: BE + FE + Dockerfile + auth + storage + observability |

A reference application is a **starting template**, not production-hardened code. Use it to learn the wiring, then fork or rewrite for your deployment.

## Available samples

| Sample | What it demonstrates | Status |
|---|---|---|
| [`workflow-engine/`](./workflow-engine/) | TypeScript Cloud Run-shape backend + React frontend wiring run lifecycle, SSE streams, all 4 interrupt kinds, BYOK with strip-on-persist, OTel under `openwop.*`, pack consumption with SRI + Ed25519 | Initial |

## Conventions

- Each `apps/<sample>/` has its own `README.md` + `ARCHITECTURE.md`.
- Backends live under `apps/<sample>/backend/<language>/`; current samples ship `typescript/`. Future contributions can add `python/` or `go/`.
- Frontends live under `apps/<sample>/frontend/<framework>/`; current samples ship `react/`. Future contributions can add `vue/`, `svelte/`, etc.
- Sample dependencies (Express, Vite, sqlite, etc.) are local to the sample — they do not affect the root spec corpus or any other tier.
- Sample CI pass/fail does not gate spec releases; samples track the SDK version they were last verified against.

## Boundary discipline

The same host-extension namespace rule from `spec/v1/host-extensions.md` applies inside `apps/`:

- Anything sample-specific (a stub auth provider, a demo pack) lives under `local.*` or `sample.*` namespaces, never under `core.*` or `openwop.*`.
- Frontends MUST consume backends only via the published SDK and the wire contract — never through backend-internal imports.
- Backends MUST NOT import frontend code.

## Contributing a new sample

1. Open an issue describing the deployment archetype the sample targets (Cloud Run, AWS Lambda, Fly.io, Kubernetes, …) and what BE/FE stack you propose.
2. Land the sample under `apps/<your-sample-name>/` following the structure above.
3. Add a row to the table in this README.
4. Add the sample's README to the root `README.md` Document Index.
