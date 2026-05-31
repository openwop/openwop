(module
  (import "openwop" "fetch" (func $fetch (param i32) (result i32)))
  (func (export "invoke") (param i32) (result i32) (call $fetch (local.get 0))))
