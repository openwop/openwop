(module
  (import "env" "memory" (memory 1))
  (func (export "invoke") (param i32) (result i32)
    (i32.store (i32.const 0x7ffffff0) (i32.const 1))
    (i32.const 0)))
