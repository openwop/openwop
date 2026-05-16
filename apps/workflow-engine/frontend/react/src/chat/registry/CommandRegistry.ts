/**
 * Slash-command registry — second extensibility seam in the chat surface
 * (the first being CardRegistry). Adopters register commands by calling
 * `registerCommand({...})` from any module at app boot.
 *
 * Commands take the form `/name <args>`. The autocomplete popover
 * filters by name + description + aliases. On selection (Enter or
 * click), the registered handler is invoked with the remaining args
 * string + a ctx object. Handlers return `true` to consume the input
 * (it never reaches the chat); `false` to fall through and send the
 * `/name args` text as a regular chat message.
 */

import type { BYOKActiveConfig } from '../../byok/lib/useBYOKConfig.js';

export interface CommandContext {
  /** Send a chat message programmatically (e.g., a command that
   *  rephrases its args before sending). */
  send: (text: string) => Promise<void>;
  /** Reset the chat session (start fresh). */
  reset: () => void;
  /** Cancel the in-flight turn, if any. */
  cancel: () => Promise<void>;
  /** Active BYOK provider/model — handlers can use this to vary behavior. */
  config: BYOKActiveConfig;
  /** Append a synthetic system message to the visible chat (e.g., /help output). */
  emitSystem: (text: string) => void;
}

export type CommandHandler = (args: string, ctx: CommandContext) => Promise<boolean> | boolean;

export interface CommandRegistration {
  /** Includes the leading slash: '/clear', '/help'. */
  name: string;
  description: string;
  aliases?: readonly string[];
  /** Optional one-line usage hint shown in autocomplete: '/run <workflowId>'. */
  usage?: string;
  handler: CommandHandler;
}

const registry = new Map<string, CommandRegistration>();

export function registerCommand(reg: CommandRegistration): void {
  if (!reg.name.startsWith('/')) {
    throw new Error(`Command name MUST start with '/': got "${reg.name}"`);
  }
  if (registry.has(reg.name)) {
    // eslint-disable-next-line no-console
    console.warn(`[CommandRegistry] overwriting "${reg.name}"`);
  }
  registry.set(reg.name, reg);
  for (const alias of reg.aliases ?? []) {
    if (!alias.startsWith('/')) continue;
    registry.set(alias, reg);
  }
}

export function listCommands(): readonly CommandRegistration[] {
  // De-dupe aliases (multiple keys → same registration).
  const seen = new Set<CommandRegistration>();
  const out: CommandRegistration[] = [];
  for (const reg of registry.values()) {
    if (seen.has(reg)) continue;
    seen.add(reg);
    out.push(reg);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function findCommand(input: string): { reg: CommandRegistration; args: string } | null {
  // Match the longest registered command-name prefix.
  const trimmed = input.trimStart();
  if (!trimmed.startsWith('/')) return null;
  const spaceIdx = trimmed.indexOf(' ');
  const name = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const reg = registry.get(name);
  if (!reg) return null;
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);
  return { reg, args };
}

/** Filter registered commands by a typed query (the partial command
 *  text without the leading slash, e.g. `'cl'` matches `/clear`). */
export function filterCommands(query: string): readonly CommandRegistration[] {
  const q = query.toLowerCase();
  if (q.length === 0) return listCommands();
  return listCommands().filter((reg) => {
    if (reg.name.slice(1).toLowerCase().includes(q)) return true;
    if (reg.description.toLowerCase().includes(q)) return true;
    if (reg.aliases?.some((a) => a.slice(1).toLowerCase().includes(q))) return true;
    return false;
  });
}

export function clearCommands(): void {
  registry.clear();
}
