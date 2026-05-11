/**
 * WASM node-pack loader (RFC 0008).
 *
 * Loads `language: "wasm"` packs by instantiating the module against the
 * host's required `openwop` imports and exposing an `executeWasmNode()`
 * entry point. Uses Node 20's built-in `WebAssembly` global — no
 * external runtime dependency. Production hosts that need tighter
 * resource caps may swap this for Wasmtime / Wasmer transparently; the
 * ABI surface is unchanged.
 *
 * What this implements (RFC 0008 §B + §C + §E):
 *   - Required exports: openwop_abi_version, openwop_pack_name,
 *     openwop_node_count, openwop_node_id_at, openwop_alloc, openwop_free,
 *     openwop_node_invoke.
 *   - Required imports under `openwop` namespace.
 *   - Caller-owned allocation: host alloc's via openwop_alloc, module
 *     reads, host frees its module-allocated returns via openwop_free.
 *   - Multi-value vs packed-i64 return detection (RFC 0008 §B amendment):
 *     detects whether `openwop_node_invoke`'s return type is `i64`
 *     (packed) or multi-value `(i32, i32)` and unpacks accordingly.
 *
 * Deterministic-time + deterministic-random imports (RFC 0008 §G) are
 * NOT yet seeded per-(runId, nodeId, attempt) — this reference loader
 * uses `Date.now()` and `crypto.randomFillSync`. Replay determinism
 * requires the host to wrap these with per-execution caches; that's a
 * production concern out of scope for the reference impl.
 */

import { readFile } from 'node:fs/promises';
import { randomFillSync } from 'node:crypto';

const ABI_VERSION = 1;

/** Status codes per RFC 0008 §F. */
const STATUS_OK = 0;
const STATUS_VALIDATION_ERROR = 10;
const STATUS_NOT_FOUND = 11;

export interface WasmNodeContext {
  readonly runId: string;
  readonly nodeId: string;
  readonly tenantId: string;
  readonly attempt: number;
  readonly configurable: Record<string, unknown>;
  readonly agent: unknown | null;
}

export interface WasmNodeRequest {
  readonly nodeContext: WasmNodeContext;
  readonly inputs: Record<string, unknown>;
}

export type WasmNodeResponse =
  | { readonly outcome: 'completed'; readonly output: unknown }
  | { readonly outcome: 'suspended'; readonly interrupt: unknown }
  | { readonly outcome: 'failed'; readonly error: { code: string; message: string; details?: unknown } };

/** Host-side run state the loader reads/writes during a node invocation. */
export interface WasmHostBridge {
  channelRead(name: string): unknown | undefined;
  channelWrite(name: string, value: unknown): number; // returns status per §F
  variableGet(key: string): unknown | undefined;
  variableSet(key: string, value: unknown): number;
  interrupt(payload: unknown): unknown; // synchronous suspend-then-resume for reference impl
  log(level: number, message: string): void;
}

interface ModuleExports {
  memory: WebAssembly.Memory;
  openwop_abi_version(): number;
  openwop_pack_name(): bigint | [number, number]; // packed i64 or multi-value
  openwop_node_count(): number;
  openwop_node_id_at(index: number): bigint | [number, number];
  openwop_alloc(size: number): number;
  openwop_free(ptr: number, size: number): void;
  openwop_node_invoke(nodeIndex: number, reqPtr: number, reqLen: number): bigint | [number, number];
}

export interface LoadedWasmPack {
  readonly packName: string;
  readonly abiVersion: number;
  /** Map of typeId → node-index. The pack's pack.json declares typeIds; loader cross-references. */
  readonly nodeTypeIds: readonly string[];
  invoke(typeId: string, request: WasmNodeRequest, bridge: WasmHostBridge): Promise<WasmNodeResponse>;
}

/**
 * Load + instantiate a WASM pack from disk. Returns a loaded handle the
 * server uses to dispatch nodes. Throws if the pack's ABI version is
 * incompatible.
 */
export async function loadWasmPack(
  wasmPath: string,
  options: { memoryPagesMax?: number } = {},
): Promise<LoadedWasmPack> {
  const bytes = await readFile(wasmPath);
  const memoryPagesMax = options.memoryPagesMax ?? 1024;

  // Host-bridge stash — populated per-invocation since imports close over it.
  let currentBridge: WasmHostBridge | null = null;
  let exports: ModuleExports;

  const decoder = new TextDecoder('utf-8');
  const encoder = new TextEncoder();

  function readBytes(ptr: number, len: number): Uint8Array {
    const view = new Uint8Array(exports.memory.buffer, ptr, len);
    // Copy so subsequent memory growth (which detaches the view) doesn't break us.
    return new Uint8Array(view);
  }

  function readString(ptr: number, len: number): string {
    if (len === 0) return '';
    return decoder.decode(readBytes(ptr, len));
  }

  function writeString(s: string): { ptr: number; len: number } {
    const bytes = encoder.encode(s);
    const ptr = exports.openwop_alloc(bytes.length);
    new Uint8Array(exports.memory.buffer).set(bytes, ptr);
    return { ptr, len: bytes.length };
  }

  function unpackPtrLen(value: bigint | [number, number]): { ptr: number; len: number } {
    if (typeof value === 'bigint') {
      const ptr = Number(value & 0xffffffffn);
      const len = Number((value >> 32n) & 0xffffffffn);
      return { ptr, len };
    }
    return { ptr: value[0], len: value[1] };
  }

  // Imports per RFC 0008 §C. All bridge-aware imports read `currentBridge`.
  const imports = {
    openwop: {
      openwop_channel_read: (namePtr: number, nameLen: number): bigint => {
        const name = readString(namePtr, nameLen);
        const value = currentBridge?.channelRead(name);
        if (value === undefined) return 0n; // (ptr=0, len=0) per RFC §C
        const out = writeString(JSON.stringify(value));
        return (BigInt(out.len) << 32n) | BigInt(out.ptr);
      },
      openwop_channel_write: (
        namePtr: number,
        nameLen: number,
        valuePtr: number,
        valueLen: number,
      ): number => {
        if (!currentBridge) return STATUS_VALIDATION_ERROR;
        try {
          const name = readString(namePtr, nameLen);
          const valueText = readString(valuePtr, valueLen);
          const value = JSON.parse(valueText) as unknown;
          return currentBridge.channelWrite(name, value);
        } catch {
          return STATUS_VALIDATION_ERROR;
        }
      },
      openwop_variable_get: (keyPtr: number, keyLen: number): bigint => {
        const key = readString(keyPtr, keyLen);
        const value = currentBridge?.variableGet(key);
        if (value === undefined) return 0n;
        const out = writeString(JSON.stringify(value));
        return (BigInt(out.len) << 32n) | BigInt(out.ptr);
      },
      openwop_variable_set: (
        keyPtr: number,
        keyLen: number,
        valuePtr: number,
        valueLen: number,
      ): number => {
        if (!currentBridge) return STATUS_VALIDATION_ERROR;
        try {
          const key = readString(keyPtr, keyLen);
          const value = JSON.parse(readString(valuePtr, valueLen)) as unknown;
          return currentBridge.variableSet(key, value);
        } catch {
          return STATUS_VALIDATION_ERROR;
        }
      },
      openwop_interrupt: (payloadPtr: number, payloadLen: number): bigint => {
        if (!currentBridge) return 0n;
        try {
          const payload = JSON.parse(readString(payloadPtr, payloadLen)) as unknown;
          const resumeValue = currentBridge.interrupt(payload);
          const out = writeString(JSON.stringify(resumeValue ?? null));
          return (BigInt(out.len) << 32n) | BigInt(out.ptr);
        } catch {
          return 0n;
        }
      },
      openwop_log: (level: number, msgPtr: number, msgLen: number): void => {
        const msg = readString(msgPtr, msgLen);
        currentBridge?.log(level, msg);
      },
      openwop_now_ms: (): bigint => BigInt(Date.now()),
      openwop_random: (outPtr: number, len: number): void => {
        const view = new Uint8Array(exports.memory.buffer, outPtr, len);
        randomFillSync(view);
      },
    },
  };

  const module = await WebAssembly.compile(bytes);
  const instance = await WebAssembly.instantiate(module, imports);
  exports = instance.exports as unknown as ModuleExports;

  // ABI version check (RFC 0008 §H).
  const declaredVersion = exports.openwop_abi_version();
  if (declaredVersion !== ABI_VERSION) {
    throw new Error(
      `unsupported_abi_version: pack declared ABI v${declaredVersion}, host supports v${ABI_VERSION}`,
    );
  }

  // Read pack identity.
  const packNameRaw = unpackPtrLen(exports.openwop_pack_name());
  const packName = readString(packNameRaw.ptr, packNameRaw.len);
  // The pack's openwop_pack_name() result is module-owned per §E; free it.
  exports.openwop_free(packNameRaw.ptr, packNameRaw.len);

  // Enumerate node typeIds.
  const nodeCount = exports.openwop_node_count();
  const nodeTypeIds: string[] = [];
  for (let i = 0; i < nodeCount; i++) {
    const raw = unpackPtrLen(exports.openwop_node_id_at(i));
    nodeTypeIds.push(readString(raw.ptr, raw.len));
    exports.openwop_free(raw.ptr, raw.len);
  }

  // Reserve max memory growth.
  if (exports.memory.buffer.byteLength < memoryPagesMax * 65536) {
    // Memory grows on demand; pre-growth not required. This is a no-op
    // unless a production loader wants to grow up-front for cache locality.
  }

  return {
    packName,
    abiVersion: declaredVersion,
    nodeTypeIds,
    async invoke(typeId, request, bridge): Promise<WasmNodeResponse> {
      const nodeIndex = nodeTypeIds.indexOf(typeId);
      if (nodeIndex < 0) {
        return {
          outcome: 'failed',
          error: {
            code: 'wasm_pack_unknown_type',
            message: `Pack ${packName} does not export typeId ${typeId}`,
          },
        };
      }

      currentBridge = bridge;
      try {
        const reqJson = JSON.stringify({ abiVersion: ABI_VERSION, ...request });
        const req = writeString(reqJson);
        let resPacked: bigint | [number, number];
        try {
          resPacked = exports.openwop_node_invoke(nodeIndex, req.ptr, req.len);
        } finally {
          exports.openwop_free(req.ptr, req.len);
        }
        const res = unpackPtrLen(resPacked);
        const resJson = readString(res.ptr, res.len);
        exports.openwop_free(res.ptr, res.len);
        return JSON.parse(resJson) as WasmNodeResponse;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          outcome: 'failed',
          error: {
            code: 'wasm_invocation_failed',
            message,
          },
        };
      } finally {
        currentBridge = null;
      }
    },
  };
}

// Re-export status codes for hosts that want to interpret import return values.
export const WASM_STATUS = {
  OK: STATUS_OK,
  VALIDATION_ERROR: STATUS_VALIDATION_ERROR,
  NOT_FOUND: STATUS_NOT_FOUND,
} as const;
