/**
 * Runtime-capability registry. Set at boot; queried by the executor to
 * refuse dispatch of NodeModules whose `requires` list includes a
 * capability the host doesn't provide.
 */

let provided: ReadonlySet<string> = new Set();

export function setRuntimeCapabilities(capabilities: readonly string[]): void {
  provided = new Set(capabilities);
}

export function hasCapability(name: string): boolean {
  return provided.has(name);
}

export function listCapabilities(): readonly string[] {
  return Array.from(provided).sort();
}
