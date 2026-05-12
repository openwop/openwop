# `vendor.openwop.misbehaving` — Deliberately-Misbehaving Pack

Fixture-only WASM node pack for openwop conformance. Exists to drive the
positive-path assertion in
[`conformance/src/scenarios/wasm-pack-memory-cap.test.ts`](../../../conformance/src/scenarios/wasm-pack-memory-cap.test.ts):
exceeds the host's advertised memory ceiling so the host MUST emit
`cap.breached` with `kind: "wasm-memory"` per
[RFC 0008 §K](../../../RFCS/0008-wasm-abi.md#k-resource-limits).

## Status

**NOT for registry publication.** This pack is exclusively a conformance
fixture. Excluded from `core.openwop.*` selective-publication tooling.

## Build

```bash
cargo build --release --target wasm32-unknown-unknown
```

Output: `target/wasm32-unknown-unknown/release/rust_misbehaving_memory.wasm`
(~10 KiB stripped). The `.cargo/config.toml` sets
`--max-memory=67108864` so the wasm module's memory section has a hard
64 MiB ceiling — required so the host can actually trap the over-cap
allocation.

## How it misbehaves

Single node typeId `vendor.openwop.misbehaving.memory-bomb` calls
`Vec::resize(1024 * 1024 * 1024, 0xAB)` on invoke. Rust's wasm32
allocator (dlmalloc) calls `memory.grow` repeatedly; once the wasm
module's memory section maximum (1024 pages × 64 KiB = 64 MiB) is
reached, `memory.grow` returns -1, the allocator returns null, Rust's
alloc-error-handler runs, `panic = "abort"` traps the module with
`unreachable`.

A volatile write to `BOMB_WITNESS` defeats dead-code elimination so the
allocation MUST happen at runtime (opt-level=s + LTO would otherwise
optimize an unused `Vec` away entirely).

## Expected host behavior

Per RFC 0008 §K, the host MUST:

1. Catch the WASM trap.
2. Classify it as a memory-cap breach (the reference loader probes
   `memory.grow(memoryPagesMax)` after the trap — if grow returns -1
   the module is at its ceiling).
3. Emit `cap.breached` with `kind: "wasm-memory"`, `limit:` and
   `observed:` byte counts, `nodeId`.
4. Mark the node and run as `failed` with code `wasm_cap_breached`.

The conformance scenario asserts all four points end-to-end against the
`conformance-wasm-pack-memory-cap-breach` fixture.

## See also

- [`examples/packs/rust-hello/`](../rust-hello) — the well-behaved
  reference pack this one is the evil twin of.
- [RFC 0008 §K](../../../RFCS/0008-wasm-abi.md#k-resource-limits) —
  normative resource-limit contract.
- [`schemas/run-event-payloads.schema.json`](../../../schemas/run-event-payloads.schema.json)
  `#/$defs/capBreached` — the wire shape of the `cap.breached` payload
  (kind enum extended 2026-05-12 to include `wasm-memory`,
  `wasm-fuel`, `wasm-execution-time`).
