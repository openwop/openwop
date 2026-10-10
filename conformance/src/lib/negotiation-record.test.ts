import { describe, it, expect } from 'vitest';
import { askedVersion, inboundServed, judgeInboundRecord, judgeListed, judgeRequested, EVENT } from './negotiation-record.js';

const ok = (fs: readonly { ok: boolean }[]): boolean => fs.every((f) => f.ok);

describe('negotiation-record (RFC 0242)', () => {
  it('askedVersion reads the A2A header and the MCP header, _meta or initialize', () => {
    expect(askedVersion('a2a', [{ headers: { 'a2a-version': '1.0' } }])).toBe('1.0');
    expect(askedVersion('a2a', [{ headers: {} }])).toBeNull();
    expect(askedVersion('mcp', [{ headers: { 'mcp-protocol-version': '2026-07-28' } }])).toBe('2026-07-28');
    expect(askedVersion('mcp', [{ headers: {}, params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' } } }])).toBe('2026-07-28');
    expect(askedVersion('mcp', [{ headers: {}, params: { protocolVersion: '2025-06-18' } }])).toBe('2025-06-18');
  });

  it('judgeRequested fails when requested is absent or differs', () => {
    expect(judgeRequested({ requested: '1.0' }, '1.0').ok).toBe(true);
    expect(judgeRequested({}, '1.0').ok).toBe(false);
    expect(judgeRequested({ requested: '0.3' }, '1.0').ok).toBe(false);
  });

  it('judgeListed binds only when an inbound surface is advertised, and needs the durable row', () => {
    const inbound = { a2a: { agentCardUrl: 'https://h/.well-known/agent-card.json' } };
    expect(inboundServed({}).a2a).toBe(false);
    expect(inboundServed({ mcp: { serverMount: { transports: ['streamable-http'] } } }).mcp).toBe(true);
    expect(judgeListed(inbound).ok).toBe(false);
    expect(judgeListed({ ...inbound, hostEvents: { types: [{ type: 'x.y', delivery: 'durable' }] } }).ok).toBe(false);
    expect(judgeListed({ ...inbound, hostEvents: { types: [{ type: EVENT, delivery: 'ephemeral' }] } }).ok).toBe(false);
    expect(judgeListed({ ...inbound, hostEvents: { types: [{ type: EVENT, delivery: 'durable' }] } }).ok).toBe(true);
  });

  it('judgeInboundRecord needs a matching durable runless record with the right outcome', () => {
    const good = { type: EVENT, delivery: 'durable', payload: { protocol: 'a2a', outcome: 'accepted', version: '1.0', requested: '1.0', at: 't' } };
    const want = { protocol: 'a2a' as const, named: '1.0', outcome: 'accepted' as const };
    expect(ok(judgeInboundRecord([good], want))).toBe(true);
    expect(ok(judgeInboundRecord([], want))).toBe(false);
    expect(ok(judgeInboundRecord([{ ...good, payload: { ...good.payload, requested: '0.3' } }], want))).toBe(false);
    expect(ok(judgeInboundRecord([{ ...good, delivery: 'ephemeral' }], want))).toBe(false);
    expect(ok(judgeInboundRecord([{ ...good, runId: 'r1' }], want))).toBe(false);
    expect(ok(judgeInboundRecord([good], { ...want, outcome: 'refused' }))).toBe(false);
    expect(ok(judgeInboundRecord([{ ...good, payload: { ...good.payload, protocol: 'mcp' } }], want))).toBe(false);
  });
});
