/**
 * Ambient declarations for the JS pack modules consumed by
 * `test/untrusted-marker.test.ts`.
 *
 * The reference pack runtime ships as plain ESM `.mjs` with JSDoc type
 * hints (no emitted `.d.ts`). The test treats each node delegate as
 * `(ctx) => Promise<{ status: string; outputs: Record<string, unknown> }>`
 * which is the lowest-common-denominator pack-runtime contract from
 * `spec/v1/node-packs.md` §"Node delegate signature." A real per-node
 * type would mirror each delegate's JSDoc shape; this ambient is just
 * enough to typecheck the test imports without `@ts-expect-error`.
 */

declare module '*/packs/core.openwop.ai/index.mjs' {
  type PackCtx = Record<string, unknown>;
  type PackOutcome = { status: string; outputs: Record<string, unknown> };
  export function chatCompletion(ctx: PackCtx): Promise<PackOutcome>;
  export function structuredOutput(ctx: PackCtx): Promise<PackOutcome>;
  export function embeddings(ctx: PackCtx): Promise<PackOutcome>;
  export function classify(ctx: PackCtx): Promise<PackOutcome>;
  export function extract(ctx: PackCtx): Promise<PackOutcome>;
  export function transform(ctx: PackCtx): Promise<PackOutcome>;
}

declare module '*/packs/core.openwop.mcp/index.mjs' {
  type PackCtx = Record<string, unknown>;
  type PackOutcome = { status: string; outputs: Record<string, unknown> };
  export function invokeTool(ctx: PackCtx): Promise<PackOutcome>;
}
