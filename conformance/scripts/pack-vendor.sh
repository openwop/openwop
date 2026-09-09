#!/usr/bin/env bash
# prepack — suite 2.0.0 (RFC 0168 §D.2). The contract (api/, schemas/) is the
# @openwop/spec-artifacts peer package and is NOT vendored into this tarball any
# more (the 1.138.1 drift mechanism, removed). Two things are written:
#   1. schemas/CORPUS-STAMP.json — a COPY of the peer's stamp, kept at the path
#      hosts already read for provenance (RFC 0145 G2; the in-memory host derives
#      `contractProvenance` from it). postpack removes it.
#   2. dist/spec-artifacts.lock.json — { version, stampSha256 } of the peer this
#      suite is packed against; src/lib/corpus-stamp.ts refuses to run when the
#      installed peer differs (exact pin, RFC 0168 §D.2).
set -euo pipefail
cd "$(dirname "$0")/.."
PEER="../spec-artifacts"
[ -f "$PEER/CORPUS-STAMP.json" ] || { echo "pack-vendor.sh: $PEER/CORPUS-STAMP.json missing — run node scripts/generate-spec-artifacts.mjs --write" >&2; exit 1; }
rm -rf ./schemas ./api
mkdir -p ./schemas ./dist
cp "$PEER/CORPUS-STAMP.json" ./schemas/CORPUS-STAMP.json
node - <<'NODE'
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync } = require('node:fs');
const stamp = JSON.parse(readFileSync('../spec-artifacts/CORPUS-STAMP.json', 'utf8'));
const stampSha256 = createHash('sha256').update(JSON.stringify({ package: stamp.package, version: stamp.version, files: stamp.files })).digest('hex');
writeFileSync('dist/spec-artifacts.lock.json', JSON.stringify({ package: stamp.package, version: stamp.version, stampSha256 }, null, 2) + '\n');
console.log(`pack-vendor.sh: locked @openwop/spec-artifacts@${stamp.version} (${stampSha256.slice(0, 12)}); stamp copied to schemas/`);
NODE
