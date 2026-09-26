# Node-pack runtimes

> **Status: Stable · RFC 0008.**
> **Normative home:** `nodePackRuntimes`.

## Why this exists

v2 carried this family only by pointing at `spec/v1/node-packs.md`. This is its v2 contract, and it lets a `remote` pack name its MCP server by an inline MCP Registry record instead of a bare URL. The shape is `$defs/Runtime` in `schemas/v2/node-pack-manifest.schema.json`.

## Languages

`runtime.language` is one of `javascript`, `python`, `go`, `wasm`, `wasm-component`, `remote`. `entry` is a path inside the tarball, or, for `remote`, the URL of an MCP server the host calls as an MCP client. A host MAY refuse a language it cannot execute, at workflow registration and with `unsupported_runtime`.

## WASM

A host that loads `wasm` packs MUST advertise `nodePackRuntimes.wasm` with at least one `abiVersions[]` entry (RFC 0008), and MUST reject at load a pack whose `openwop_abi_version()` is not listed. When it advertises `maxMemoryBytes` it MUST enforce it and emit `cap.breached` with `kind: "wasm-memory"` on a breach. `nodePackRuntimes.wasmComponent` advertises `wasm-component` loading; its interfaces are reserved for a later RFC.

## The MCP registry record

RFC 0203 (`Accepted`): a `remote` runtime MAY carry `mcpServer`, an inline subset of an MCP Registry `server.json` (schema `2025-12-11`): `name`, `description`, `version`, optional `title`, `websiteUrl` and `repository`, and exactly one `remotes[]` entry of `type: "streamable-http"` with an `https://` URL. It has no `packages[]`, `headers`, `variables` or `_meta`, so it carries no install instruction and no credential. `mcpServer` under any other language, or an `entry` that differs from `remotes[0].url`, makes the manifest invalid (`pack_validation_failed`). The record is by value; this contract defines no registry lookup. A host SHOULD NOT treat `name` as a verified identity: an inline record carries no proof of namespace ownership. A host that authenticates to the server does so through the node's `requiredCredentials` or `auth`.
