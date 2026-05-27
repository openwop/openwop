import type { Ctx } from '../context.js';
/** `openwop config ...` — read/write ~/.openwop/config.json. */
import { CliError } from '../errors.js';
import { write, writeLine, writeJson } from '../io.js';
import { configPathFor, readConfigSafe, saveConfig, getByPath, setByPath, unsetByPath } from '../config.js';
import { parseInputValue } from './shared.js';

export const CONFIG_HELP = `Usage:
  openwop config file
  openwop config get [key]
  openwop config set <key> <value>
  openwop config unset <key>

Reads and writes ~/.openwop/config.json (or OPENWOP_CONFIG_HOME/.openwop/ when set).
Dotted keys traverse nested objects (e.g., \`openwop config get host.baseUrl\`).
`;

export async function runConfig(ctx: Ctx, argv) {
  const sub = argv[0] ?? 'file';
  const args = argv.slice(['file', 'get', 'set', 'unset'].includes(sub) ? 1 : 0);
  if (sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, CONFIG_HELP);
    return 0;
  }
  switch (sub) {
    case 'file':
      writeLine(ctx.io.stdout, configPathFor(undefined, ctx.env));
      return 0;
    case 'get': {
      const configPath = configPathFor(undefined, ctx.env);
      const config = readConfigSafe(configPath) ?? {};
      if (args.length === 0) {
        if (ctx.json) writeJson(ctx.io.stdout, config);
        else writeLine(ctx.io.stdout, JSON.stringify(config, null, 2));
        return 0;
      }
      const value = getByPath(config, args[0]);
      if (value === undefined) {
        writeLine(ctx.io.stderr, `(unset: ${args[0]})`);
        return 1;
      }
      if (ctx.json) writeJson(ctx.io.stdout, value);
      else writeLine(ctx.io.stdout, typeof value === 'string' ? value : JSON.stringify(value));
      return 0;
    }
    case 'set': {
      if (args.length !== 2) throw new CliError('Usage: openwop config set <key> <value>');
      const configPath = configPathFor(undefined, ctx.env);
      const config = readConfigSafe(configPath) ?? {};
      setByPath(config, args[0], parseInputValue(args[1]));
      saveConfig(configPath, config);
      writeLine(ctx.io.stdout, `set ${args[0]} = ${args[1]}`);
      return 0;
    }
    case 'unset': {
      if (args.length !== 1) throw new CliError('Usage: openwop config unset <key>');
      const configPath = configPathFor(undefined, ctx.env);
      const config = readConfigSafe(configPath) ?? {};
      unsetByPath(config, args[0]);
      saveConfig(configPath, config);
      writeLine(ctx.io.stdout, `unset ${args[0]}`);
      return 0;
    }
    default:
      throw new CliError(`Unknown config command: ${sub}`);
  }
}
