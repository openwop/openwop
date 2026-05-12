//! Deliberately-misbehaving WASM node pack for openwop conformance.
//!
//! This pack exists ONLY to drive the positive-path assertion in
//! `conformance/src/scenarios/wasm-pack-memory-cap.test.ts`: it
//! deliberately allocates beyond the host's advertised
//! `capabilities.nodePackRuntimes.wasm.maxMemoryBytes`, forcing the
//! host to either trap or terminate the instance and emit
//! `cap.breached` with `kind: "wasm-memory"` per RFC 0008 §K.
//!
//! It is **fixture-only**: NOT signed for the registry, NOT included
//! in `core.openwop.*` publication, NOT advertised to clients.
//!
//! Implementation mirrors `examples/packs/rust-hello/src/lib.rs` for
//! the required RFC 0008 §B exports (ABI version, pack name, node
//! count, node id, alloc, free, invoke). The single node typeId is
//! `vendor.openwop.misbehaving.memory-bomb`. On invoke, it allocates
//! a 1 GiB buffer — far beyond the default 128 MiB host cap.

const ABI_VERSION: u32 = 1;
const PACK_NAME: &str = "vendor.openwop.misbehaving";

const NODE_TYPE_IDS: &[&str] = &["vendor.openwop.misbehaving.memory-bomb"];

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

// Module-level static the bomb writes through so LLVM can't dead-code-
// eliminate the allocation. Without this, opt-level=s + LTO optimizes
// an unused `Vec::with_capacity` away entirely because the buffer is
// never read.
static mut BOMB_WITNESS: u8 = 0;

#[no_mangle]
pub extern "C" fn openwop_node_invoke(_node_index: u32, _req_ptr: u32, _req_len: u32) -> i64 {
    // Deliberate cap breach: allocate + RESIZE 1 GiB. `resize` actually
    // touches the pages, forcing memory.grow to fire. When the WASM
    // memory's `maximum` is exceeded, the allocator panics; with
    // panic = "abort" in Cargo.toml that traps the module. The host's
    // loader catches the trap and emits cap.breached.
    //
    // We resize (not just `with_capacity`) and write a volatile byte
    // out to BOMB_WITNESS so the optimizer can't prove the
    // allocation is dead.
    let mut bomb: Vec<u8> = Vec::new();
    bomb.resize(1024 * 1024 * 1024, 0xAB);
    unsafe {
        core::ptr::write_volatile(core::ptr::addr_of_mut!(BOMB_WITNESS), bomb[0]);
    }

    // Unreachable — the allocation panics first. Kept so the function
    // signature stays valid if a future runtime accepts the
    // allocation (in which case the cap was lying).
    leak_string_as_packed(
        r#"{"outcome":"completed","output":{"unexpected":"allocation should have trapped"}}"#,
    )
}

// ─── Helpers (mirrors rust-hello) ─────────────────────────────────────────

fn leak_string_as_packed(s: &str) -> i64 {
    let bytes = s.as_bytes();
    let len = bytes.len() as u32;
    let mut buf: Vec<u8> = Vec::with_capacity(bytes.len());
    buf.extend_from_slice(bytes);
    let ptr = buf.as_mut_ptr() as u32;
    core::mem::forget(buf);
    ((len as i64) << 32) | (ptr as i64 & 0xffffffff)
}
