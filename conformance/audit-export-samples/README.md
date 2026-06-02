# Audit-checkpoint export samples

Static sample bundles in the export shape produced by
`examples/hosts/postgres/src/audit-export.ts` and consumed by the out-of-band
verifier `scripts/verify-audit-checkpoints.mjs` (the CF-11 cross-host
re-anchoring tool, per `spec/v1/auth-profiles.md §"Audit-log integrity"`).

- **`valid.json`** — a well-formed bundle with two checkpoints whose Ed25519
  signatures verify against the embedded `signingKey.publicKeyPEM`. The verifier
  MUST exit `0`.
- **`tampered.json`** — identical to `valid.json` except one byte of the second
  checkpoint's signature is flipped, so it no longer verifies. The verifier MUST
  exit non-zero (tamper detected).

`openwop:check` (step 7) runs the verifier against both and fails if the valid
bundle is rejected or the tampered bundle is accepted — a regression guard on the
verifier itself. These are fixtures, not workflow definitions, so they live here
rather than under `conformance/fixtures/` (which `fixtures-valid.test.ts`
validates against `workflow-definition.schema.json`).

Regenerate after a verifier shape change with a one-off Ed25519 keygen + sign
(see the commit that introduced this dir).
