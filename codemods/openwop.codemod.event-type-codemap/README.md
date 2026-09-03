# openwop.codemod.event-type-codemap

RFC 0171 §A.2 / rows `C4.3`, `C4.4`: renames run-event `type` values from the v1 vocabulary to the v2 vocabulary using `spec/v1/event-codemap.json` as the only source of the map (117 rows, 20 hand decisions). Any object with a dotted `type` is renamed at any depth; v2 names pass through; a reserved-prefix name with no row is refused; vendor types pass. Negative control: an already-v2 log is unchanged. Idempotent. The C.9 read-time adapter applies the same file.
