(module
  (import "wasi_snapshot_preview1" "proc_raise" (func $p (param i32) (result i32)))
  (func (export "invoke") (param i32) (result i32)
    (call $p (i32.const 0))))
