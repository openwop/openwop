# `vendor.openwop.rust-hello` — reference WASM node pack

A minimal Rust → WebAssembly node pack that proves the RFC 0008 ABI v1 works end-to-end across an independent toolchain. The smallest possible pack that exercises every required ABI export (`openwop_abi_version`, `openwop_pack_name`, `openwop_node_count`, `openwop_node_id_at`, `openwop_alloc`, `openwop_free`, `openwop_node_invoke`) and at least one import (`openwop_log`).

## What it does

One node typeId: **`vendor.openwop.rust-hello.greet`**.

- **Input:** `{ "name": "<string>" }`
- **Output:** `{ "greeting": "Hello, <name>!" }`
- When `name` is omitted, defaults to `"world"`.
- Logs the greeting via `openwop_log` at level `info` (2) before returning.

## Build

Requires the Rust toolchain with the `wasm32-unknown-unknown` target:

```bash
rustup target add wasm32-unknown-unknown
cd examples/packs/rust-hello
cargo build --target wasm32-unknown-unknown --release
```

Output: `target/wasm32-unknown-unknown/release/rust_hello.wasm` (~5–10 KiB stripped).

## Use it from the in-memory reference host

The host scans `examples/packs/*/pack.json` at startup and loads every pack whose `runtime.language === "wasm"`. After `cargo build`, restart the host:

```bash
cd examples/hosts/in-memory
npm run start
# [openwop-host-in-memory] loaded WASM pack vendor.openwop.rust-hello (ABI v1) with 1 node type(s): vendor.openwop.rust-hello.greet
# [openwop-host-in-memory] listening on http://127.0.0.1:3737 (...)
```

Then exercise the node via a workflow whose first node uses the typeId `vendor.openwop.rust-hello.greet`. The conformance suite seeds `conformance-wasm-pack-roundtrip` for exactly this purpose:

```bash
curl -s -X POST http://127.0.0.1:3737/v1/runs \
  -H "Authorization: Bearer openwop-inmem-dev-key" \
  -H "Content-Type: application/json" \
  -d '{"workflowId":"conformance-wasm-pack-roundtrip","inputs":{"name":"openwop"}}'
```

Poll the run and look for the `node.completed` event whose `data.output.greeting` is `"Hello, openwop!"`.

## Implementation notes

### Packed-i64 return encoding

RFC 0008 §B defines `openwop_node_invoke` and friends with multi-value `(i32 i32)` returns. Stable Rust on `wasm32-unknown-unknown` does not emit native WASM multi-value by default. This pack uses the RFC-allowed packed-i64 alternative:

```
low 32 bits  = pointer
high 32 bits = length
```

The reference host loader detects packed-i64 vs multi-value at instantiation time and unpacks accordingly.

### Caller-owned allocation (RFC 0008 §E)

When this pack returns a (ptr, len), the host MUST call `openwop_free(ptr, len)` after reading. Every export here that returns a packed-i64 result has been allocated via the pack's exported `openwop_alloc`.

### Deliberately no JSON parser

The reference pack parses `inputs.name` by hand (looking for `"name":"..."`) to keep the WASM binary tiny. Production packs should use `serde_json` or similar. The binary at `-O s` opt-level with LTO + abort-on-panic strips to ~5–10 KiB; with serde it grows by ~100 KiB.

### No WASI

This pack uses no WASI imports. It declares only `openwop_log` under the `openwop` import namespace. Hosts that don't provide a WASI shim still load this pack correctly.

## Signing

Following `node-packs.md` §Signing, this pack will be signed with the project's Ed25519 root key when published to a registry. The `.wasm` bytes are signed as-is; the host verifies the signature before instantiation. Signing is out of scope for the local-development workflow above — when running from `examples/packs/`, the host trusts the filesystem.

## See also

- [`RFCS/0008-wasm-abi.md`](../../../RFCS/0008-wasm-abi.md) — the ABI spec this pack implements
- [`spec/v1/node-packs.md`](../../../spec/v1/node-packs.md) — pack manifest format + distribution
- [`examples/hosts/in-memory/src/wasm-loader.ts`](../../hosts/in-memory/src/wasm-loader.ts) — the loader that bridges this pack to the runtime
- [`conformance/fixtures/conformance-wasm-pack-roundtrip.json`](../../../conformance/fixtures/conformance-wasm-pack-roundtrip.json) — fixture that exercises the pack end-to-end
