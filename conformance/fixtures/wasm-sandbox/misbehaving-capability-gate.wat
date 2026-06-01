(module
  (import "openwop" "privileged" (func $p (param i32) (result i32)))
  (func (export "invoke") (param i32) (result i32)
    (call $p (local.get 0))))
