/**
 * Minimal ambient declarations for the `WebAssembly` global used by
 * `wasm-loader.ts`. Node 20+ exposes the W3C WebAssembly JS API; this
 * shim covers just the surface we use without pulling the DOM lib into
 * `tsconfig.json`.
 */

declare namespace WebAssembly {
  interface Memory {
    readonly buffer: ArrayBuffer;
  }

  type ImportValue = ((...args: never[]) => unknown) | Memory | number | bigint;
  type Imports = Record<string, Record<string, ImportValue>>;
  type Exports = Record<string, unknown>;

  interface Module {
    /* opaque */
  }

  interface Instance {
    readonly exports: Exports;
  }

  function compile(bytes: BufferSource): Promise<Module>;
  function instantiate(module: Module, imports?: Imports): Promise<Instance>;
}
