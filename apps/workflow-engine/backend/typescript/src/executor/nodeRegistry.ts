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
    /** Async resolve — falls through to the pack resolver on miss.
     *  Note: a pack-resolver call usually registers EVERY typeId in
     *  the pack (loadPackFromManifest iterates the full `nodes` map),
     *  not just the one we asked for. The resolver's return value is
     *  typically the FIRST module registered in that pass — which is
     *  not necessarily the one we wanted. So after the resolver runs,
     *  re-read inProcess[typeId] to get the right module. */
    async resolve(typeId: string): Promise<NodeModule | null> {
      const direct = inProcess.get(typeId);
      if (direct) return direct;
      if (resolver) {
        await resolver(typeId);
        const reread = inProcess.get(typeId);
        if (reread) return reread;
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
