(module
  (global $g (mut i32) (i32.const 0))
  (func (export "bump") (result i32)
    (global.set $g (i32.add (global.get $g) (i32.const 1)))
    (global.get $g))
  (func (export "read") (result i32) (global.get $g)))
