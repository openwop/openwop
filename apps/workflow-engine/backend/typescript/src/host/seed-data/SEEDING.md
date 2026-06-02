# Seed data — the brand-authoring surface

This directory holds the demo **content** the reference host seeds for a
first-time visitor, kept as **data, not code** (the same principle as
myndhyve's `src/seeds/SEEDING.md`: *do not hard-code seed content in runtime
modules*). A white-label deployer re-skins the demo by editing these files —
not by hand-editing the seeding logic in `../demoSeed.ts`.

Proportionate to this host: there is **no generator script, Firestore, or
admin panel** (myndhyve's `.ts → JSON → Cloud Function → Firestore` pipeline).
The JSON here is consumed directly — `esbuild --bundle` inlines it into
`lib/index.js` at build time, and `demoSeed.ts` writes it through the durable
host-extension stores.

## Files

| File | Seeds | Consumed by |
|---|---|---|
| `demoAgents.json` | The five demo personas (roster entries), each with a role, board cards, schedules, and an org-chart position | `../demoSeed.ts` → `seedDemoAgents()` |

> The runnable workflow definitions a persona's portfolio points at live in
> `../demoWorkflows.ts` (executable node graphs, not brand content). Their
> human-facing `name`/`purpose` strings can be edited there.

## To re-brand the demo content

1. **Edit `demoAgents.json`** — change personas, descriptions, system
   prompts, card titles, schedule labels, department names. The shape is
   validated against the `SeedAgent` type in `demoSeed.ts` at compile time
   (`tsc`/CI), so a malformed edit fails the build.
   - **`autonomyLevel`** (optional, per persona): omit or `"auto"` to start
     heartbeat picks immediately; `"review"` ships the persona in the
     "agents propose, humans dispose" mode — its heartbeat queues a proposal
     to the approval inbox instead of running it. The stock seed ships **Nora**
     in `review` so the approval flow is demoable out of the box.
2. **Rebuild** the backend (`npm run build`) and redeploy — the JSON is
   bundled, so the new content ships with the image.

## To ship NO demo content (clean tenant)

Set the env var — no code edit, no rebuild:

```
OPENWOP_DEMO_SEED_ENABLED=false
```

`seedDemoAgents()` then returns `{ seeded: false, agents: 0 }` and writes
nothing. (Incremental Cloud Run env update; preserves all other config.)

## Idempotency

Seeding is **per-persona idempotent** and **non-destructive**: each persona is
created only if missing, so a re-seed never duplicates and never clobbers a
user's own edits. There is no version/hash gate (unlike myndhyve's workflow
content-hash gate) — the empty-roster check is the whole contract.
