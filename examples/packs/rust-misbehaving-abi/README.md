# `vendor.openwop.misbehaving-abi` — Deliberately-Misbehaving Pack (ABI mismatch)

Fixture-only WASM node pack for openwop conformance. Exists to drive
the positive-path assertion in
[`conformance/src/scenarios/wasm-pack-abi-version-rejection.test.ts`](../../../conformance/src/scenarios/wasm-pack-abi-version-rejection.test.ts):
declares an ABI version (999) no OpenWOP host supports, forcing the
host's loader to refuse instantiation per
[RFC 0008 §H](../../../RFCS/0008-wasm-abi.md#h-abi-version-handshake).

## Status

**NOT for registry publication.** Conformance fixture only. Excluded
from `core.openwop.*` selective-publication tooling. The sibling
deliberately-misbehaving pack
[`rust-misbehaving-memory`](../rust-misbehaving-memory) covers the
memory-cap positive path.

## Build

```bash
cargo build --release --target wasm32-unknown-unknown
```

Output: `target/wasm32-unknown-unknown/release/rust_misbehaving_abi.wasm`
(~5-8 KiB stripped).

## How it misbehaves

`openwop_abi_version()` returns 999 instead of the v1 the host
supports. Per RFC 0008 §H, the host's loader MUST check this value
before any other exports and refuse to register the pack when it's
outside the host's advertised `abiVersions[]`.

The other RFC 0008 §B exports (`openwop_pack_name`, `openwop_node_count`,
`openwop_node_id_at`, `openwop_alloc`, `openwop_free`,
`openwop_node_invoke`) are present and well-formed so that a
misbehaving host that *skips* the ABI check would dispatch to
`openwop_node_invoke`, which returns a recognizable failure code
(`wasm_pack_unexpected_invoke`) to surface the bug.

## Expected host behavior

Per RFC 0008 §H, a conformant host MUST:

1. Read `openwop_abi_version()` at instantiation.
2. Compare against the host's advertised
   `capabilities.nodePackRuntimes.wasm.abiVersions[]`.
3. If the declared version is not in that list: refuse to register
   the pack. Log the rejection. Do NOT add the pack's typeIds to the
   host's node registry.
4. Advertise the rejection observably: `capabilities.nodePackRuntimes.wasm.loadedPacks[]`
   MUST NOT include `vendor.openwop.misbehaving-abi`. (Well-behaved
   packs that load successfully ARE included.)

The conformance scenario asserts (4) end-to-end against the
in-memory reference host, which advertises `loadedPacks[]` when at
least one WASM pack is loaded.

## See also

- [`examples/packs/rust-hello/`](../rust-hello) — the well-behaved
  reference pack this one is the evil twin of.
- [`examples/packs/rust-misbehaving-memory/`](../rust-misbehaving-memory)
  — the other deliberately-misbehaving pack (exercises §K memory cap).
- [RFC 0008 §H](../../../RFCS/0008-wasm-abi.md#h-abi-version-handshake)
  — normative ABI-version contract.
