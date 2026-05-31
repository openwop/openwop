(module
  (func (export "invoke") (param i32) (result i32)
    (loop $l (br $l))
    (i32.const 0)))
