# Runbook: republish the core agent packs with their prompt bodies

**Audience:** the openwop registry operator (holds the `openwop-team-1` signing key + a registry publish token). **Status:** pending — hand-off from PR #295.

## Why

`build-pack-tarball.mjs` historically dropped agent `systemPromptRef` bodies from the tarball (`prompts/` was not bundled). The three published `core.openwop.agents.*` packs therefore shipped **without** their prompt, so an RFC 0003 §C fail-loud installing host (MyndHyve, during the RFC 0074 proof) correctly rejects them.

- **#295 fixed the bundler + added guards** (`prompts/*.md|.txt` now ships; build-time fail-loud; the `check-pack-prompt-refs` CI guard). So every *future* build is correct.
- This runbook re-publishes the three **already-published** packs so the live registry artifacts carry their prompts. It is a **registry operation** (sign + `PUT` to the live registry), not a repo edit — the `registry/v1/` tree is a server-published snapshot.

Affected packs (each declares `systemPromptRef: prompts/<name>.md`, present in source, absent from the published `1.0.0.tgz`):

| Pack | Source prompt |
|---|---|
| `core.openwop.agents.deep-research` | `prompts/deep-research.md` |
| `core.openwop.agents.react` | `prompts/react.md` |
| `core.openwop.agents.supervisor` | `prompts/supervisor.md` |

## Key decision: patch-bump, do NOT overwrite 1.0.0

Published versions are **immutable** — `publish-pack.mjs` returns `409 version_conflict` if you re-`PUT` `1.0.0` with different content (now-larger tarball + new integrity + new signature). So **bump each pack to `1.0.1`** (the `1.0.0` tarball was defective). Consumers — including MyndHyve — then reference `@1.0.1`.

> If the registry policy instead permits a corrective content-replace of `1.0.0` (operator's call), skip the version bump and publish `1.0.0`; everything else below is identical. Default: patch-bump.

## Prerequisites

- `openwop-team-1` private key at `~/.openwop-keys/openwop-team-1.private.pem` (the actual signer of the `core.openwop.*` packs — see `check-registry-signer-consistency`).
- `OPENWOP_PACK_REGISTRY_URL` (e.g. `https://packs.openwop.dev`) and `OPENWOP_PACK_PUBLISH_KEY` (bearer/Firebase ID token of a publisher-authorized account).
- Repo at the post-#295 `main` (bundler fix present).

## Steps

```bash
PACKS="core.openwop.agents.deep-research core.openwop.agents.react core.openwop.agents.supervisor"

# 1. Patch-bump each pack's manifest version 1.0.0 -> 1.0.1.
for p in $PACKS; do
  node -e 'const f=process.argv[1];const j=require(f);j.version="1.0.1";
    require("fs").writeFileSync(f, JSON.stringify(j,null,2)+"\n");
    console.log(j.name,"->",j.version)' "packs/$p/pack.json"
done

# 2. Build SIGNED tarballs (openwop-team-1). The bundler now ships prompts/*.md
#    and FAILS if a declared systemPromptRef is missing — so a green build is proof.
for p in $PACKS; do
  node scripts/build-pack-tarball.mjs --pack "$p" --signed \
    --key ~/.openwop-keys/openwop-team-1.private.pem --key-id openwop-team-1 \
    --out dist/packs
done

# 3. Sanity — confirm the built tarball now contains prompts/.
for p in $PACKS; do
  echo "== $p =="
  node -e 'const z=require("zlib"),fs=require("fs");const t=z.gunzipSync(fs.readFileSync(process.argv[1]));
    let o=0,n=[];while(o+512<=t.length){const nm=t.slice(o,o+100).toString().replace(/\0.*/,"");if(!nm)break;n.push(nm);
    const s=parseInt(t.slice(o+124,o+136).toString().replace(/\0.*/,"").trim()||"0",8);o+=512+Math.ceil(s/512)*512;}
    console.log("prompts/ present:", n.some(x=>x.startsWith("prompts/")))' \
    "dist/packs/$p-1.0.1.tgz"
done

# 4. Dry-run publish (prints the PUT plan; no writes).
node scripts/publish-pack.mjs --all --dist dist/packs --dry-run

# 5. Publish for real (requires the two env vars).
node scripts/publish-pack.mjs --all --dist dist/packs
```

## Post-publish verification

```bash
# Fetch the new tarball + confirm prompts/ present and the signature verifies.
curl -fsSL "$OPENWOP_PACK_REGISTRY_URL/v1/packs/core.openwop.agents.deep-research/-/1.0.1.tgz" \
  | gunzip | tar -tf - | grep prompts/
```

- Re-run `node scripts/check-registry-signer-consistency.mjs` against the refreshed snapshot — the new `1.0.1` index/manifest must keep `signingKeyId: openwop-team-1`.
- A mirror dry-run (e.g. MyndHyve's `mirror-openwop-packs.cjs --pack core.openwop.agents.deep-research`) should now resolve the prompt and **not** fail-loud-reject.

## Downstream (MyndHyve, after republish)

Once `@1.0.1` is live, MyndHyve can swap the RFC 0074 proof off the `private.myndhyve.conformance-agent` stand-in onto the real `core.openwop.agents.deep-research@1.0.1` (approve `@1.0.1` for `ws-openwop-conformance`, un-approve the inert `@1.0.0`) — a small MyndHyve prod write, on the operator's go. Until then the private-pack proof stands and the inert packs are harmless.
