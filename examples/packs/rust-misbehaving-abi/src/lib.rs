//! Deliberately-misbehaving WASM node pack for openwop conformance.
//!
//! This pack exists ONLY to drive the positive-path assertion in
//! `conformance/src/scenarios/wasm-pack-abi-version-rejection.test.ts`:
//! it declares ABI version 999 — far beyond any host's supported
//! range — forcing the host's loader to refuse instantiation per
//! RFC 0008 §H. A host that's correctly enforcing the ABI contract
//! MUST NOT register this pack's typeIds and MUST NOT include its
//! pack name in `capabilities.nodePackRuntimes.wasm.loadedPacks[]`.
//!
//! It is **fixture-only**: NOT signed for the registry, NOT included
//! in `core.openwop.*` publication, NOT advertised to clients.
//!
//! Implementation mirrors `examples/packs/rust-hello/src/lib.rs` for
//! the required RFC 0008 §B exports — except `openwop_abi_version()`
//! returns 999 instead of 1.

const ABI_VERSION: u32 = 999;
const PACK_NAME: &str = "vendor.openwop.misbehaving-abi";

const NODE_TYPE_IDS: &[&str] = &["vendor.openwop.misbehaving.abi-bomb"];

#[no_mangle]
pub extern "C" fn openwop_abi_version() -> u32 {
    ABI_VERSION
}

#[no_mangle]
pub extern "C" fn openwop_pack_name() -> i64 {
    leak_string_as_packed(PACK_NAME)
}

#[no_mangle]
pub extern "C" fn openwop_node_count() -> u32 {
    NODE_TYPE_IDS.len() as u32
}

#[no_mangle]
pub extern "C" fn openwop_node_id_at(index: u32) -> i64 {
    let idx = index as usize;
    if idx >= NODE_TYPE_IDS.len() {
        return 0;
    }
    leak_string_as_packed(NODE_TYPE_IDS[idx])
}

#[no_mangle]
pub extern "C" fn openwop_alloc(size: u32) -> u32 {
    let mut buf: Vec<u8> = Vec::with_capacity(size as usize);
    buf.resize(size as usize, 0);
    let ptr = buf.as_mut_ptr() as u32;
    core::mem::forget(buf);
    ptr
}

#[no_mangle]
pub extern "C" fn openwop_free(ptr: u32, size: u32) {
    if ptr == 0 || size == 0 {
        return;
    }
    unsafe {
        let _ = Vec::from_raw_parts(ptr as *mut u8, size as usize, size as usize);
    }
}

#[no_mangle]
pub extern "C" fn openwop_node_invoke(_node_index: u32, _req_ptr: u32, _req_len: u32) -> i64 {
    // Unreachable in practice — the host's loader rejects this module
    // at load time because `openwop_abi_version()` returns 999. If a
    // misbehaving host somehow gets here, return a recognizable
    // failure so the conformance test can flag the bug.
    leak_string_as_packed(
        r#"{"outcome":"failed","error":{"code":"wasm_pack_unexpected_invoke","message":"misbehaving-abi pack should not be invoked — host failed to reject ABI v999 at load time"}}"#,
    )
}

// ─── Helpers (mirrors rust-hello + rust-misbehaving-memory) ──────────────────

fn leak_string_as_packed(s: &str) -> i64 {
    let bytes = s.as_bytes();
    let len = bytes.len() as u32;
    let mut buf: Vec<u8> = Vec::with_capacity(bytes.len());
    buf.extend_from_slice(bytes);
    let ptr = buf.as_mut_ptr() as u32;
    core::mem::forget(buf);
    ((len as i64) << 32) | (ptr as i64 & 0xffffffff)
}
