# openwop.codemod.debug-bundle-seq

RFC 0171 row `C4.7`: renames the debug bundle's legacy `seq` event field to `sequence` at any depth inside an `events` array. Refuses an event carrying both with different values. Negative control: a bundle with only `sequence` is unchanged. Idempotent. A published bundle stays valid v1 evidence; this is for re-emission.
