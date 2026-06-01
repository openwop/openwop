(module
  (import "wasi_snapshot_preview1" "environ_get" (func $e (param i32 i32) (result i32)))
  (func (export "invoke") (param i32) (result i32)
    (call $e (i32.const 0) (i32.const 0))))
