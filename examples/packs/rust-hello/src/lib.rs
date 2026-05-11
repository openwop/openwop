//! Reference WASM node pack for openwop (RFC 0008 ABI v1).
//!
//! Implements one node typeId:
//!   `vendor.openwop.rust-hello.greet` — takes `{ "name": "<string>" }`,
//!   returns `{ "greeting": "Hello, <name>!" }`.
//!
//! This pack exists to prove the WASM ABI works end-to-end across an
//! independent toolchain (Rust → wasm32-unknown-unknown). It is the
//! "rust-hello" of node packs: smallest possible thing that exercises
//! every required export and at least one import (`openwop_log`).
//!
//! ABI implementation notes:
//!
//! - Multi-value vs packed-i64 returns: stable Rust on
//!   `wasm32-unknown-unknown` does not emit native WASM multi-value by
//!   default. RFC 0008 §B allows packed-i64 as an alternative:
//!     low 32 bits = pointer; high 32 bits = length.
//!   This pack uses packed i64 throughout.
//!
//! - Memory ownership (RFC 0008 §E): caller-owned allocation. When the
//!   module returns a (ptr, len) result, the host MUST call
//!   `openwop_free(ptr, len)` after reading. When the host passes
//!   buffers via parameters, the module reads but does not free; the
//!   host frees the buffer it allocated.
//!
//! - No `_start` / no WASI. The pack uses no WASI imports; the host
//!   loader must not require WASI bindings.

// Uses std. `wasm32-unknown-unknown` supports a useful subset (no
// filesystem, no threads, no network) which is all this pack needs.
// Binary size remains ~10-20 KiB stripped with the release profile
// declared in Cargo.toml. Reference packs that need tighter size
// budgets can switch to `#![no_std]` + an explicit global allocator
// (dlmalloc, etc.).

// ─── Pack metadata ────────────────────────────────────────────────────────

const ABI_VERSION: u32 = 1;
const PACK_NAME: &str = "vendor.openwop.rust-hello";

// One node typeId, exposed at index 0.
const NODE_TYPE_IDS: &[&str] = &["vendor.openwop.rust-hello.greet"];

// ─── Required exports per RFC 0008 §B ─────────────────────────────────────

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
    // Initialize so the host writing to this buffer is well-defined.
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
pub extern "C" fn openwop_node_invoke(node_index: u32, req_ptr: u32, req_len: u32) -> i64 {
    let idx = node_index as usize;
    if idx >= NODE_TYPE_IDS.len() {
        return leak_string_as_packed(
            r#"{"outcome":"failed","error":{"code":"wasm_pack_unknown_node_index","message":"node_index out of range"}}"#,
        );
    }

    // Read the request JSON from host-allocated memory.
    let req_json = unsafe {
        let slice = core::slice::from_raw_parts(req_ptr as *const u8, req_len as usize);
        core::str::from_utf8(slice).unwrap_or("")
    };

    // Extract `inputs.name` from the JSON. We do this without a JSON
    // parser to keep the binary tiny — the request shape is fixed.
    let name = extract_inputs_name(req_json).unwrap_or_else(|| "world".to_string());

    // openwop_log invocation — exercises one host import per the RFC §G
    // requirement that imports are reachable.
    log_info(&format!("rust-hello greeting name={name}"));

    let greeting = format!(r#"{{"outcome":"completed","output":{{"greeting":"Hello, {}!"}}}}"#, escape_json(&name));
    leak_string_as_packed(&greeting)
}

// ─── Required imports (declared so the linker generates wasm imports) ──────

#[link(wasm_import_module = "openwop")]
extern "C" {
    fn openwop_log(level: u32, msg_ptr: u32, msg_len: u32);
}

fn log_info(msg: &str) {
    let bytes = msg.as_bytes();
    unsafe {
        openwop_log(2 /* info */, bytes.as_ptr() as u32, bytes.len() as u32);
    }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/// Leak a String onto the heap and return its (ptr, len) packed as i64
/// (low 32 bits = ptr, high 32 bits = len). The host MUST call
/// `openwop_free` on (ptr, len) after reading per RFC 0008 §E.
fn leak_string_as_packed(s: &str) -> i64 {
    let bytes = s.as_bytes();
    let ptr = openwop_alloc(bytes.len() as u32);
    unsafe {
        core::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr as *mut u8, bytes.len());
    }
    pack_ptr_len(ptr, bytes.len() as u32)
}

fn pack_ptr_len(ptr: u32, len: u32) -> i64 {
    ((len as i64) << 32) | (ptr as i64 & 0xffff_ffff)
}

/// Minimal hand-rolled extraction of `inputs.name` from a JSON request.
/// Looks for the substring `"name"` followed by `:` and a string value.
/// Sufficient for this reference pack; real packs use serde_json.
fn extract_inputs_name(req: &str) -> Option<String> {
    let key = "\"name\"";
    let key_start = req.find(key)?;
    let after_key = &req[key_start + key.len()..];
    let colon = after_key.find(':')?;
    let after_colon = &after_key[colon + 1..];
    let quote_start = after_colon.find('"')?;
    let value_start = quote_start + 1;
    let rest = &after_colon[value_start..];
    let quote_end = rest.find('"')?;
    Some(rest[..quote_end].to_string())
}

fn escape_json(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out
}
