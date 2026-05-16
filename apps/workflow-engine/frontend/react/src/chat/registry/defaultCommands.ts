/**
 * Built-in slash commands. Adopters extend by calling
 * `registerCommand({...})` from any module at boot.
 */

import { registerCommand, listCommands } from './CommandRegistry.js';

let registered = false;

export function registerDefaultCommands(): void {
  if (registered) return;

  registerCommand({
    name: '/clear',
    aliases: ['/new', '/reset'],
    description: 'Start a new chat session (wipes the current thread)',
    handler: async (_args, ctx) => {
      ctx.reset();
      return true;
    },
  });

  registerCommand({
    name: '/help',
    aliases: ['/?', '/commands'],
    description: 'List available slash commands',
    handler: async (_args, ctx) => {
      const lines = listCommands().map((c) => {
        const aliases = c.aliases?.length ? ` (aliases: ${c.aliases.join(', ')})` : '';
        const usage = c.usage ? `\n      ${c.usage}` : '';
        return `  ${c.name} — ${c.description}${aliases}${usage}`;
      });
      ctx.emitSystem(`Available commands:\n${lines.join('\n')}`);
      return true;
    },
  });

  registerCommand({
    name: '/stop',
    aliases: ['/cancel'],
    description: 'Cancel the in-flight turn (same as Esc)',
    handler: async (_args, ctx) => {
      await ctx.cancel();
      return true;
    },
  });

  registered = true;
}
