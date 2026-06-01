(module
  (import "wasi_snapshot_preview1" "fd_read" (func $fd_read (param i32 i32 i32 i32) (result i32)))
  (func (export "invoke") (param i32) (result i32)
    (call $fd_read (i32.const 0) (i32.const 0) (i32.const 0) (i32.const 0))))
