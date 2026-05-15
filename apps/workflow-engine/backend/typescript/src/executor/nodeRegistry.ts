/**
 * Module-scope NodeRegistry singleton. Sample uses a single in-process
 * registry — multi-instance hosts would replicate via a shared DB or
 * a message bus.
 */

import type { NodeModule } from './types.js';

type NodePackResolver = (typeId: string) => Promise<NodeModule | null>;

const inProcess = new Map<string, NodeModule>();
let resolver: NodePackResolver | null = null;

export function getNodeRegistry() {
  return {
    register(node: NodeModule): void {
      inProcess.set(node.typeId, node);
    },
    has(typeId: string): boolean {
      return inProcess.has(typeId);
    },
    /** Synchronous get (in-process only). */
    get(typeId: string): NodeModule | null {
      return inProcess.get(typeId) ?? null;
    },
    /** Async resolve — falls through to the pack resolver on miss. */
    async resolve(typeId: string): Promise<NodeModule | null> {
      const direct = inProcess.get(typeId);
      if (direct) return direct;
      if (resolver) {
        const loaded = await resolver(typeId);
        if (loaded) {
          inProcess.set(loaded.typeId, loaded);
          return loaded;
        }
      }
      return null;
    },
    listTypeIds(): readonly string[] {
      return Array.from(inProcess.keys()).sort();
    },
  };
}

export function setNodePackResolver(fn: NodePackResolver): void {
  resolver = fn;
}
