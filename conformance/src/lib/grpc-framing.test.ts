/**
 * Unit tests for `grpc-framing.ts` — gRPC HTTP/2 message framing.
 *
 * @see grpc-framing.ts
 */

import { describe, it, expect } from 'vitest';
import { frameMessage, unframeMessages } from './grpc-framing.js';

describe('grpc-framing: frameMessage', () => {
  it('prepends a 5-byte header to a single payload', () => {
    const payload = new Uint8Array([0xab, 0xcd, 0xef]);
    const framed = frameMessage(payload);
    expect(framed.byteLength).toBe(8);
    expect(framed[0]).toBe(0); // identity compression
    expect(framed[1]).toBe(0);
    expect(framed[2]).toBe(0);
    expect(framed[3]).toBe(0);
    expect(framed[4]).toBe(3); // length = 3
    expect(framed[5]).toBe(0xab);
    expect(framed[6]).toBe(0xcd);
    expect(framed[7]).toBe(0xef);
  });

  it('frames a zero-length payload as a 5-byte header alone', () => {
    const framed = frameMessage(new Uint8Array(0));
    expect(framed.byteLength).toBe(5);
    expect(framed[0]).toBe(0);
    expect(framed[4]).toBe(0);
  });

  it('encodes lengths > 256 in big-endian order', () => {
    const payload = new Uint8Array(300);
    const framed = frameMessage(payload);
    // length = 300 = 0x0000012C, big-endian: 00 00 01 2C
    expect(framed[1]).toBe(0);
    expect(framed[2]).toBe(0);
    expect(framed[3]).toBe(1);
    expect(framed[4]).toBe(0x2c);
  });
});

describe('grpc-framing: unframeMessages', () => {
  it('parses a single frame', () => {
    const payload = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const framed = frameMessage(payload);
    const messages = unframeMessages(framed);
    expect(messages.length).toBe(1);
    expect(Array.from(messages[0]!)).toEqual([0x01, 0x02, 0x03, 0x04]);
  });

  it('parses multiple concatenated frames', () => {
    const a = frameMessage(new Uint8Array([0xaa, 0xab]));
    const b = frameMessage(new Uint8Array([0xbb]));
    const c = frameMessage(new Uint8Array([0xcc, 0xcd, 0xce, 0xcf]));
    const combined = new Uint8Array(a.byteLength + b.byteLength + c.byteLength);
    combined.set(a, 0);
    combined.set(b, a.byteLength);
    combined.set(c, a.byteLength + b.byteLength);
    const messages = unframeMessages(combined);
    expect(messages.length).toBe(3);
    expect(Array.from(messages[0]!)).toEqual([0xaa, 0xab]);
    expect(Array.from(messages[1]!)).toEqual([0xbb]);
    expect(Array.from(messages[2]!)).toEqual([0xcc, 0xcd, 0xce, 0xcf]);
  });

  it('parses an empty buffer as zero frames', () => {
    expect(unframeMessages(new Uint8Array(0))).toEqual([]);
  });

  it('throws on truncated header', () => {
    // Only 3 bytes of a 5-byte header.
    const buf = new Uint8Array([0, 0, 0]);
    expect(() => unframeMessages(buf)).toThrow(/frame truncated/i);
  });

  it('throws on truncated payload', () => {
    // 5-byte header declares 10 bytes of payload but only 4 follow.
    const buf = new Uint8Array([0, 0, 0, 0, 10, 1, 2, 3, 4]);
    expect(() => unframeMessages(buf)).toThrow(/payload truncated/i);
  });

  it('throws on unsupported compression flag', () => {
    // Flag = 1 → compression negotiated, which we don't implement.
    const buf = new Uint8Array([1, 0, 0, 0, 0]);
    expect(() => unframeMessages(buf)).toThrow(/compression flag/i);
  });

  it('round-trips: frame → unframe yields original payload', () => {
    const original = new Uint8Array([0x0a, 0x05, 0x68, 0x65, 0x6c, 0x6c, 0x6f]); // protobuf "hello"
    const framed = frameMessage(original);
    const unframed = unframeMessages(framed);
    expect(unframed.length).toBe(1);
    expect(Array.from(unframed[0]!)).toEqual(Array.from(original));
  });
});
