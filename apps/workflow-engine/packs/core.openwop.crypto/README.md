# core.openwop.crypto

Pure cryptographic primitives that workflow authors reach for: hashing, HMAC, AEAD encryption, signing, JWT, TOTP, x509 parsing. Built entirely on `node:crypto` (Node 20+ — zero npm deps).

These nodes are **pure with respect to keys passed in via inputs**. They are NOT a key store. If you need long-lived signing keys, resolve them via the host secret resolver (see `spec/v1/auth.md` and `node-packs.md` §"Per-node `requiresSecrets[]`") and pass them in as inputs.

Webhook signature verification (Stripe / GitHub / Slack style) lives in `core.openwop.http` as `http.webhook.verify` — this pack provides the raw HMAC primitive it composes on top of.

## TypeIds

| typeId | role | purpose |
|---|---|---|
| `core.crypto.hash` | pure | sha-256 / sha-384 / sha-512 / sha-1 / md5 / blake2b512. |
| `core.crypto.hmac-sign` | pure | HMAC-SHA-256/384/512 sign. Hex or base64 output. |
| `core.crypto.hmac-verify` | pure | Constant-time HMAC verify against a provided signature. |
| `core.crypto.aead-encrypt` | pure | AES-256-GCM / ChaCha20-Poly1305 encrypt with optional AAD. |
| `core.crypto.aead-decrypt` | pure | Authenticated decrypt; rejects tampered ciphertext. |
| `core.crypto.sign` | pure | Asymmetric sign (Ed25519, RS256, ES256). |
| `core.crypto.verify` | pure | Asymmetric verify. |
| `core.crypto.jwt-mint` | pure | Mint a JWT (HS256/384/512, RS256, ES256, EdDSA). |
| `core.crypto.jwt-verify` | pure | Verify a JWT including `exp`/`nbf`/`iss`/`aud` claim checks. |
| `core.crypto.totp-generate` | pure | RFC 6238 TOTP code generator. |
| `core.crypto.totp-verify` | pure | TOTP verify with configurable drift window. |
| `core.crypto.x509-parse` | pure | Parse a PEM x509 cert and return issuer / subject / SAN / fingerprint / validity. |
| `core.crypto.x509-verify-chain` | pure | Verify a leaf cert chains to one of N trust roots. |

## Replay & caching

All nodes are `cacheable`. Workflows that compute the same hash/HMAC twice get the same result by construction. AEAD encryption is non-deterministic by design (random nonce) — re-running re-encrypts.

## Compliance posture

Algorithms exposed are the IETF-recommended modern set; deprecated algorithms (SHA-1, MD5) are kept available behind an explicit `algorithm` choice for legacy interop but are flagged in spec docs. RSASSA-PKCS1-v1_5 is offered as `RS256`; PSS is `PS256`. Curve selection: `P-256` for ES256, `Ed25519` for EdDSA.
