/**
 * grpc-transport — `spec/v1/grpc-transport.md` advertisement-shape scenario
 * (capability-gated on `capabilities.grpc`; the schema block lands with
 * RFC 0094 §H on this branch).
 *
 * SHAPE-ONLY by design: this scenario validates the advertised
 * `capabilities.grpc` block against the doc's MUSTs without dialing gRPC
 * (the suite ships no gRPC client — see grpc-transport.md §Implementation
 * notes). The end-to-end legs (GetCapabilities equivalence, run
 * round-trip, error-envelope mapping, auth metadata) are listed in
 * grpc-transport.md §Conformance and stay future work for a host-side
 * gRPC harness.
 *
 * Gated via `behaviorGate('openwop-grpc-transport', grpc !== undefined)`
 * — soft-skip when the block is absent (absent ⇒ no gRPC transport,
 * which is conformant), hard-fail under `OPENWOP_REQUIRE_BEHAVIOR=true`
 * unless honestly opted out (root-first family read per RFC 0073).
 *
 * Asserted MUSTs (grpc-transport.md §"Field semantics"):
 *   - `supported` is a boolean;
 *   - `service` is the canonical `openwop.v1.Engine` for v1;
 *   - `tls` ∈ {"required", "optional", "disabled"};
 *   - `endpoint`, when present, is a `grpc://` or `grpcs://` URI;
 *   - when `supported: true`, root `supportedTransports` includes
 *     `"grpc"` ("presence required when gRPC is exposed");
 *   - a production-profile claimant (root `production` block advertised)
 *     MUST set `tls: "required"`.
 *
 * @see spec/v1/grpc-transport.md §"Field semantics" + §Conformance
 * @see RFCS/0094-wire-shape-reconciliation.md §H
 */

import { describe, it, expect } from 'vitest';
import { driver } from '../lib/driver.js';
import { behaviorGate } from '../lib/behavior-gate.js';
import { capabilityFamily } from '../lib/discovery-capabilities.js';
import { req } from '../lib/requirement-ids.js';
import { softSkip } from '../lib/soft-skip.js';

const HTTP_SKIP = !process.env.OPENWOP_BASE_URL;

const TLS_VALUES = ['required', 'optional', 'disabled'];
const V1_SERVICE = 'openwop.v1.Engine';

interface GrpcCap {
  readonly supported?: unknown;
  readonly endpoint?: unknown;
  readonly service?: unknown;
  readonly tls?: unknown;
}

describe.skipIf(HTTP_SKIP)('grpc-transport: advertisement shape (grpc-transport.md §Field semantics)', () => {
  it('an advertised capabilities.grpc block satisfies every doc MUST', async () => {
    const res = await driver.get('/.well-known/openwop');
    if (res.status !== 200) return softSkip('blocked', 'precondition not met — `res.status !== 200` returned early (seam, prior step, or fixture unavailable)');
    const grpc = capabilityFamily<GrpcCap>(res.json, 'grpc');
    if (!behaviorGate('openwop-grpc-transport', grpc !== undefined)) return;

    expect(
      typeof grpc!.supported,
      req('openwop.it.grpc-transport.an-advertised-capabilities-grpc-block-satisfies-every-doc-must', 'grpc-transport.md §Field semantics', 'capabilities.grpc.supported MUST be a boolean'),
    ).toBe('boolean');

    expect(
      grpc!.service,
      req('openwop.it.grpc-transport.an-advertised-capabilities-grpc-block-satisfies-every-doc-must', 'grpc-transport.md §Field semantics', 'v1 hosts MUST use the canonical service name openwop.v1.Engine'),
    ).toBe(V1_SERVICE);

    expect(
      TLS_VALUES,
      req('openwop.it.grpc-transport.an-advertised-capabilities-grpc-block-satisfies-every-doc-must', 
        'grpc-transport.md §Field semantics',
        `capabilities.grpc.tls MUST be one of ${TLS_VALUES.join(' / ')} (got ${String(grpc!.tls)})`,
      ),
    ).toContain(grpc!.tls);

    if (grpc!.endpoint !== undefined) {
      expect(
        typeof grpc!.endpoint === 'string' && /^grpcs?:\/\/.+/.test(grpc!.endpoint),
        req('openwop.it.grpc-transport.an-advertised-capabilities-grpc-block-satisfies-every-doc-must', 
          'grpc-transport.md §Field semantics',
          `capabilities.grpc.endpoint MUST be a grpc:// (cleartext) or grpcs:// (TLS) URI (got ${String(grpc!.endpoint)})`,
        ),
      ).toBe(true);
    }

    if (grpc!.supported === true) {
      const transports = capabilityFamily<unknown>(res.json, 'supportedTransports');
      expect(
        Array.isArray(transports) && transports.includes('grpc'),
        req('openwop.it.grpc-transport.an-advertised-capabilities-grpc-block-satisfies-every-doc-must', 
          'grpc-transport.md §Field semantics',
          'supportedTransports MUST include "grpc" when the gRPC surface is exposed',
        ),
      ).toBe(true);
    }

    // Production-profile claimants MUST require TLS on the gRPC listener.
    const production = capabilityFamily<unknown>(res.json, 'production');
    if (production !== undefined && grpc!.supported === true) {
      expect(
        grpc!.tls,
        req('openwop.it.grpc-transport.an-advertised-capabilities-grpc-block-satisfies-every-doc-must', 
          'grpc-transport.md §Field semantics',
          'production hosts MUST set capabilities.grpc.tls: "required"',
        ),
      ).toBe('required');
    }
  });
});
