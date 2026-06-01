(module
  (import "wasi_snapshot_preview1" "sock_connect" (func $s (param i32 i32) (result i32)))
  (func (export "invoke") (param i32) (result i32)
    (call $s (i32.const 0) (i32.const 0))))
