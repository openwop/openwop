# `community.openwop-team.demo`

First **community-namespace** pack. Mixed shape (1 node + 1 agent) demonstrating that non-steward contributors can publish without OIDC infrastructure — manual Ed25519 signing only.

| Pack name | `community.openwop-team.demo` |
| Version | `0.1.0` |
| Engine | OpenWOP `>=1.0.0 <2.0.0` |
| Runtime | JavaScript (ESM), Node `>=20` |
| External deps | None |
| Signing | **Manual Ed25519** (not Sigstore) |
| License | **MIT** (SPDX-diversity vs the Apache-2.0 core packs) |

## Contents

### Node: `community.openwop-team.demo.uppercase`

Returns the input `text` string uppercased via `String.prototype.toUpperCase()`. Pure / replay-safe / `cacheable`. Smoke node — useful as a sentinel that a community-tier pack can be loaded alongside `core.*` packs in the same workflow.

### Agent: `community.openwop-team.demo.greeter`

| Field | Value |
|---|---|
| `persona` | `"Greeter"` |
| `modelClass` | `"general"` |
| `systemPrompt` | Inline — greets the user in a different language each turn, rotating through ~20 commonly-known languages |
| `toolAllowlist` | `[]` |
| `memoryShape` | Stateless (`{ scratchpad: false, conversation: false, longTerm: false }`) |
| `confidence.defaultThreshold` | `0.9` |

## Manual Ed25519 signing — verifier walkthrough

Why manual instead of Sigstore? Sigstore signs via short-lived OIDC tokens issued by the GitHub Actions runtime. That works for `core.*` packs published from steward CI. **Community contributors typically don't have a GHA workflow identity to sign with** — manual Ed25519 lets anyone with a keypair publish.

### Files

| Path | Purpose |
|---|---|
| `keys/community.openwop-team.pub.pem` | Public key (committed) |
| `keys/pack.json.sig` | Detached Ed25519 signature over canonical-JSON of `pack.json` (signing block excluded) |

### Verify the signature

```js
import { readFileSync } from 'node:fs';
import { createPublicKey, verify } from 'node:crypto';

function canonicalJson(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

const pack = JSON.parse(readFileSync('pack.json', 'utf8'));
const { signing, ...signedPart } = pack;
const canonical = Buffer.from(canonicalJson(signedPart));

const pubKey = createPublicKey({
  key: readFileSync('keys/community.openwop-team.pub.pem', 'utf8'),
  format: 'pem',
});
const sig = Buffer.from(
  readFileSync('keys/pack.json.sig', 'utf8').trim(),
  'base64',
);

const ok = verify(null, canonical, pubKey, sig);  // ed25519: algorithm=null
console.log(ok ? 'verified' : 'FAILED');
```

### Sign a new version

```js
import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// ... canonicalJson() as above ...
const pack = JSON.parse(readFileSync('pack.json'));
const { signing, ...signedPart } = pack;
const key = createPrivateKey({
  key: readFileSync('keys/community.openwop-team-PRIVATE.pem', 'utf8'),
  format: 'pem',
});
const sig = sign(null, Buffer.from(canonicalJson(signedPart)), key);
writeFileSync('keys/pack.json.sig', sig.toString('base64') + '\n');
```

## Operational note on the keypair

The keypair for this pack was generated for the v0.1.0 release. **The private key is NOT committed** — only the public key. For production publishing the operator must:

1. Generate a fresh Ed25519 keypair via `openssl genpkey -algorithm ed25519`
2. Commit ONLY the public key to `keys/community.openwop-team.pub.pem`
3. Store the private key in a secrets vault (1Password, AWS Secrets Manager, etc.)
4. Sign every released `pack.json` with the private key + commit the resulting signature
5. Mirror the public key at `packs.openwop.dev/keys/community.openwop-team.json` so verifiers without local repo access can fetch it

Rotation: per `spec/v1/registry-operations.md` §"Signing keys + rotation," publish a NEW key + sign new versions with the new key; old versions remain verifiable with their original signatures.

## Example workflow

```json
{
  "id": "demo",
  "nodes": [
    {
      "id": "shout",
      "typeId": "community.openwop-team.demo.uppercase",
      "inputs": { "text": "hello" }
    },
    {
      "id": "greet",
      "typeId": "core.chat",
      "agent": { "agentId": "community.openwop-team.demo.greeter" },
      "inputs": { "message": "say hi" }
    }
  ]
}
```

## Schemas

- [`schemas/uppercase.{config,input,output}.json`](./schemas/)
- Agent manifest validates against `schemas/agent-manifest.schema.json` (at repo root)

## See also

- [`spec/v1/node-packs.md`](../../spec/v1/node-packs.md) §"Signing"
- [`spec/v1/registry-operations.md`](../../spec/v1/registry-operations.md) §"Signing keys + rotation"
- [`docs/PACKS-MVP-PLAN.md`](../../docs/PACKS-MVP-PLAN.md)
- [`examples/node-pack-publishing/`](../../examples/node-pack-publishing/)
