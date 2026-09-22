/**
 * Self-test for `trace-context.ts` (RFC 0207). The carrier verdict is what
 * turns a host's outbound request into a pass or a fail, so each branch of the
 * D4 rule is pinned here — including the two that a lenient implementation
 * gets wrong: a header-only request PASSES, and a well-formed value from a
 * freshly minted trace FAILS.
 */
import { describe, it, expect } from 'vitest';
import { makeTraceparent, parseTraceparent, classifyCarriers, mcpMetaTraceparent, a2aMetadataTraceparent } from './trace-context.js';

const T = '4bf92f3577b34da6a3ce929d0e0e4736';
const OTHER = 'a'.repeat(32);
const tp = (trace: string, span = '00f067aa0ba902b7') => `00-${trace}-${span}-01`;
const MCP = { inMessage: 'params._meta.traceparent' };

describe('trace-context: traceparent grammar (W3C §3.2)', () => {
  it('makeTraceparent is valid and fresh', () => {
    const a = makeTraceparent(); const b = makeTraceparent();
    expect(parseTraceparent(a.header)?.traceId).toBe(a.traceId);
    expect(a.traceId).not.toBe(b.traceId);
  });
  it('accepts a version-00 value, and a future version with trailing fields', () => {
    expect(parseTraceparent(tp(T))).toEqual({ version: '00', traceId: T, parentId: '00f067aa0ba902b7', flags: '01' });
    expect(parseTraceparent(`01-${T}-00f067aa0ba902b7-01-extra`)?.traceId).toBe(T);
  });
  it('rejects malformed values', () => {
    for (const bad of ['garbage', '', tp(T).toUpperCase(), tp('0'.repeat(32)), tp(T, '0'.repeat(16)), `ff-${T}-00f067aa0ba902b7-01`, `${tp(T)}-x`, `00-${T.slice(0, 16)}-00f067aa0ba902b7-01`, 42, null]) {
      expect(parseTraceparent(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('trace-context: the D4 carrier verdict', () => {
  it('neither carrier fails', () => {
    expect(classifyCarriers(undefined, undefined, T, MCP).ok).toBe(false);
  });
  it('header-only passes with detail header-only', () => {
    expect(classifyCarriers(undefined, tp(T), T, MCP)).toEqual({ ok: true, detail: 'header-only' });
  });
  it('in-message only and both pass', () => {
    expect(classifyCarriers(tp(T), undefined, T, MCP)).toEqual({ ok: true, detail: 'in-message' });
    expect(classifyCarriers(tp(T), tp(T, '1111111111111111'), T, MCP)).toEqual({ ok: true, detail: 'both' });
  });
  it('a fresh trace fails in either carrier', () => {
    expect(classifyCarriers(tp(OTHER), undefined, T, MCP).ok).toBe(false);
    expect(classifyCarriers(undefined, tp(OTHER), T, MCP).ok).toBe(false);
    expect(classifyCarriers(tp(T), tp(OTHER), T, MCP).ok).toBe(false);
  });
  it('a malformed present carrier fails', () => {
    expect(classifyCarriers('garbage', tp(T), T, MCP).ok).toBe(false);
  });
});

describe('trace-context: carrier extraction', () => {
  it('only the unprefixed _meta key counts', () => {
    expect(mcpMetaTraceparent({ _meta: { traceparent: tp(T) } })).toBe(tp(T));
    expect(mcpMetaTraceparent({ _meta: { 'io.example/traceparent': tp(T) } })).toBeUndefined();
    expect(mcpMetaTraceparent(null)).toBeUndefined();
  });
  it('the A2A carrier is Message.metadata.openwop.traceparent, not request metadata', () => {
    expect(a2aMetadataTraceparent({ params: { message: { metadata: { openwop: { traceparent: tp(T) } } } } })).toBe(tp(T));
    expect(a2aMetadataTraceparent({ params: { metadata: { openwop: { traceparent: tp(T) } }, message: {} } })).toBeUndefined();
  });
});
