;; vendor.openwop.misbehaving-abi — reports ABI version 999, which no host lists.
;; RFC 0008 §B exports, hand-written so no Rust toolchain is needed. Strings are
;; returned packed as (len << 32) | ptr. Built by ../build.mjs.
(module
  (memory (export "memory") 16)
  (global $heap (mut i32) (i32.const 1120))
  (data (i32.const 1024) "vendor.openwop.misbehaving-abi")
  (data (i32.const 1062) "vendor.openwop.misbehaving.abi-bomb")
  (func (export "openwop_abi_version") (result i32) (i32.const 999))
  (func (export "openwop_pack_name") (result i64) (i64.or (i64.shl (i64.const 30) (i64.const 32)) (i64.const 1024)))
  (func (export "openwop_node_count") (result i32) (i32.const 1))
  (func (export "openwop_node_id_at") (param $i i32) (result i64)
    (if (result i64) (i32.eqz (local.get $i)) (then (i64.or (i64.shl (i64.const 35) (i64.const 32)) (i64.const 1062))) (else (i64.const 0))))
  (func (export "openwop_alloc") (param $size i32) (result i32)
    (local $p i32)
    (local.set $p (global.get $heap))
    (global.set $heap (i32.add (global.get $heap) (i32.and (i32.add (local.get $size) (i32.const 15)) (i32.const -16))))
    (local.get $p))
  (func (export "openwop_free") (param $ptr i32) (param $size i32))
  (func (export "openwop_node_invoke") (param $node i32) (param $ptr i32) (param $len i32) (result i64)
    ;; Never reached: a conforming host refuses the pack at load because ABI
    ;; version 999 is not in its advertised nodePackRuntimes.wasm.abiVersions.
    unreachable)
)
