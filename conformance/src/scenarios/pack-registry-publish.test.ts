/**
 * Pack-registry publish scenarios — `node-packs.md` §"PUT /v1/packs/{name}/-/{version}.tgz".
 *
 * The 19-code error catalog for the publish endpoint, recorded as
 * `it.todo()` scenarios that document the publish contract until OpenWOP
 * defines a test-mode registry namespace.
 *
 * Why placeholders:
 *
 *   The publish path is gated on `packs:publish` scope (see auth.md) plus
 *   a binary tarball upload. Round-trip scenarios from a black-box suite
 *   would either:
 *     1. Require the suite's `OPENWOP_API_KEY` to carry super-admin / publish
 *        scope on the host under test — gives the suite the ability to
 *        stomp on the real catalog, NOT acceptable for v1.
 *     2. Require a host-provided test-mode `/v1/packs-test/*` namespace
 *        that mirrors the real surface but writes to an isolated catalog —
 *        this surface doesn't exist in the spec yet.
 *
 *   Until option 2 is specified, the scenarios below document the
 *   error-code contract so they become runnable once the isolated surface
 *   exists.
 *
 * @see node-packs.md §"PUT /v1/packs/{name}/-/{version}.tgz"
 * @see auth.md §"`packs:publish` scope"
 * @see schemas/node-pack-manifest.schema.json
 */

import { describe, it } from 'vitest';

describe('pack-registry-publish: URL / scope error catalog (deferred — no test-mode surface)', () => {
  it.todo('PUT with a name that doesn\'t match `core.*` / `vendor.*` / `community.*` / `private.*` MUST return 400 invalid_pack_scope — public registries (packs.openwop.dev) MUST additionally refuse `private.*` and `local.*`');

  it.todo('PUT with a single-segment URL pack name MUST return 400 invalid_pack_name (URL pack-name doesn\'t match the reverse-DNS pattern at all)');

  it.todo('PUT with a non-semver URL version MUST return 400 invalid_version');
});

describe('pack-registry-publish: body-shape error catalog (deferred — no test-mode surface)', () => {
  it.todo('PUT with a JSON body (instead of tarball bytes) MUST return 400 invalid_body — body is not a Buffer / not octet-stream-shaped');

  it.todo('PUT with an empty body MUST return 400 invalid_body');
});

describe('pack-registry-publish: tarball extraction error catalog (deferred — no test-mode surface)', () => {
  it.todo('PUT with a body that isn\'t a valid gzip stream MUST return 400 tarball_gunzip_failed');

  it.todo('PUT with decompressed bytes exceeding the registry\'s cap (recommended default: 50 MB) MUST return 400 tarball_too_large');

  it.todo('PUT with no `pack.json` at the tarball root MUST return 400 tarball_manifest_missing');

  it.todo('PUT with `pack.json` exceeding the registry\'s per-file cap (recommended default: 256 KB) MUST return 400 tarball_manifest_too_large');

  it.todo('PUT with `pack.json` that isn\'t valid JSON MUST return 400 tarball_manifest_not_json');

  it.todo('PUT with `manifest.runtime.entry` declaring a path that isn\'t in the tarball MUST return 400 tarball_entry_missing');

  it.todo('PUT with an entry source exceeding the registry\'s per-file cap (recommended default: 5 MB) MUST return 400 tarball_entry_too_large');

  it.todo('PUT with a tarball entry whose name contains `..` or otherwise escapes the pack root MUST return 400 tarball_path_traversal');

  it.todo('PUT with a tar stream that the parser can\'t read past the gzip layer MUST return 400 tarball_tar_parse_failed');
});

describe('pack-registry-publish: manifest contents error catalog (deferred — no test-mode surface)', () => {
  it.todo('PUT with a `pack.json` that fails schema validation MUST return 400 invalid_manifest — detail message includes the failing path');

  it.todo('PUT with `manifest.name` and/or `manifest.version` differing from the URL params MUST return 400 manifest_mismatch — registries MAY emit the granular pair (`manifest_name_mismatch` / `manifest_version_mismatch`); clients MUST handle either');

  it.todo('PUT with server-computed SHA-256 not matching `X-Pack-Sha256` (when supplied) MUST return 400 pack_integrity_failure');

  it.todo('PUT with `runtime.language` value not accepted by the registry MUST return 400 unsupported_runtime');
});

describe('pack-registry-publish: authorization + conflict (deferred — no test-mode surface)', () => {
  it.todo('PUT without `packs:publish` scope or namespace claim MUST return 403 forbidden');

  it.todo('PUT for an existing (name, version) with DIFFERENT content MUST return 409 conflict — registries MAY emit `version_conflict`; either form is spec-allowed');

  it.todo('PUT for an existing (name, version) with IDENTICAL sha256 content MUST return 200 OK with the existing record (idempotent re-publish)');
});

describe('pack-registry-publish: unpublish window (deferred — no test-mode surface)', () => {
  it.todo('DELETE /v1/packs/{name}/-/{version} for a version older than the registry\'s unpublish window (default 72h) MUST return 400 unpublish_window_expired — use the yank flow for security incidents past the window');
});

describe('pack-registry-publish: signature endpoint pairing (deferred — no test-mode surface)', () => {
  it.todo('after a PUT with a `signing.signatureRef` blob in the tarball, GET /v1/packs/{name}/-/{version}.sig MUST return the persisted signature (200 with bytes OR 302 to a signed URL)');

  it.todo('after a PUT WITHOUT a signature blob, GET /v1/packs/{name}/-/{version}.sig MUST return 404 signature_not_available');

  it.todo('after a YANK, GET /v1/packs/{name}/-/{version}.sig MUST return 404 signature_not_available — yanked tarballs MUST NOT serve their signatures (consumers shouldn\'t be verifying against known-bad packs)');
});
