/**
 * gRPC HTTP/2 message framing primitive — Track 11 OTLP/gRPC.
 *
 * gRPC over HTTP/2 wraps each protobuf message in a 5-byte frame
 * prefix:
 *
 *   ┌──────────┬───────────────────────┬─────────────────────┐
 *   │ 1 byte   │ 4 bytes               │ N bytes             │
 *   │ flags    │ length (big-endian)   │ payload             │
 *   └──────────┴───────────────────────┴─────────────────────┘
 *
 * `flags` is `0x00` for uncompressed (the only mode we implement).
 * `0x01` indicates a per-message compression scheme negotiated via
 * the `grpc-encoding` header; we reject this since the conformance
 * collector advertises identity encoding only.
 *
 * Multiple frames MAY be concatenated in a stream; for OTLP Export
 * unary calls the request and response both carry exactly one frame.
 *
 * Pure stdlib — no `@grpc/grpc-js` dependency. Matches the
 * zero-new-deps stance of `otlp-protobuf.ts` (the hand-rolled
 * decoder for the OTLP message bodies).
 *
 * @see https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md
 */

/** Length-prefix a single protobuf payload with the gRPC 5-byte frame. */
export function frameMessage(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(5 + payload.byteLength);
  out[0] = 0; // compression flag — identity
  // Big-endian 32-bit length
  out[1] = (payload.byteLength >>> 24) & 0xff;
  out[2] = (payload.byteLength >>> 16) & 0xff;
  out[3] = (payload.byteLength >>> 8) & 0xff;
  out[4] = payload.byteLength & 0xff;
  out.set(payload, 5);
  return out;
}

/**
 * Parse one or more gRPC-framed messages from a concatenated buffer.
 * Throws if any frame uses a compression scheme we don't implement,
 * or if the buffer truncates mid-frame.
 */
export function unframeMessages(buf: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let i = 0;
  while (i < buf.byteLength) {
    if (i + 5 > buf.byteLength) {
      throw new Error(
        `gRPC frame truncated: need 5-byte header at offset ${i}, have ${buf.byteLength - i}`,
      );
    }
    const flag = buf[i]!;
    if (flag !== 0) {
      throw new Error(
        `gRPC frame at offset ${i} has compression flag ${flag}; only identity (0) is supported`,
      );
    }
    const len =
      ((buf[i + 1]! << 24) >>> 0) |
      ((buf[i + 2]! << 16) >>> 0) |
      ((buf[i + 3]! << 8) >>> 0) |
      buf[i + 4]!;
    const payloadStart = i + 5;
    const payloadEnd = payloadStart + len;
    if (payloadEnd > buf.byteLength) {
      throw new Error(
        `gRPC frame payload truncated: declared length ${len} at offset ${i + 1}, but only ${buf.byteLength - payloadStart} bytes remain`,
      );
    }
    out.push(buf.subarray(payloadStart, payloadEnd));
    i = payloadEnd;
  }
  return out;
}
