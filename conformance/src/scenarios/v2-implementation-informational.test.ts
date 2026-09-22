/**
 * RFC 0208 §G — `implementation` gains an optional `url` (the operator's site:
 * A2A `AgentProvider.url`, MCP `Implementation.websiteUrl`) and stays a closed
 * object (`spec/v2/core/capabilities.md` §3.1). Target major 2; server-free —
 * the leg validates against the packaged `schemas/v2/capabilities.schema.json`
 * and never contacts a host.
 *
 * The §G SHOULD NOT ("a client SHOULD NOT change behaviour because of it or
 * authorize from it") binds consumers and is not witnessable from a host; it is
 * stated in the RFC's falsifiability table, not claimed here.
 *
 * @see spec/v2/core/capabilities.md §3.1
 * @see RFCS/0208-v2-a2a-mcp-operation-mappings.md §G
 */
import { describe, it, expect } from 'vitest';
import { v2Validator } from '../lib/v2.js';
import { req } from '../lib/requirement-ids.js';

export const HOST_CALLBACK_NOT_REQUIRED = 'server-free: validates documents against the packaged v2 capabilities schema';

const ID = 'openwop.requirement.0208.implementation-shape';
const DOC = 'spec/v2/core/capabilities.md §3.1 (RFC 0208 §G)';
const ROOT = { protocolVersions: ['2.0'], preferredVersion: '2.0' };

describe('RFC 0208 §G — v2-implementation-informational (server-free)', () => {
  it('implementation accepts name, version, vendor and url, and still rejects an unknown key', () => {
    const validate = v2Validator('capabilities');
    const good = validate({ ...ROOT, implementation: { name: 'conformance', version: '1.0.0', vendor: 'openwop', url: 'https://example.org' } });
    expect(good.ok, req(ID, DOC, `implementation.url (format uri) MUST validate beside name, version and vendor (${good.errors})`)).toBe(true);
    expect(validate({ ...ROOT, implementation: { name: 'conformance', homepage: 'https://example.org' } }).ok, req(ID, DOC, 'implementation stays closed: an unknown key (homepage) MUST fail validation')).toBe(false);
    expect(validate({ ...ROOT, implementation: { url: 'not a uri' } }).ok, req(ID, DOC, 'implementation.url is format uri: a non-URI MUST fail validation')).toBe(false);
  });
});
