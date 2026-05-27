import type { Ctx } from '../context.js';
/** `openwop providers ...` — manage BYOK credential refs (never values). */
import { CliError } from '../errors.js';
import { write, writeLine, writeJson, formatTable } from '../io.js';
import { parseOptions } from '../options.js';
import { requestJson } from '../api.js';
import { configPathFor, readConfigSafe, saveConfig, mergeConfig } from '../config.js';
import { PROVIDER_CATALOG } from '../constants.js';
import { resolveApiKey, testProviderConnection } from './providerHelpers.js';

export const PROVIDERS_HELP = `Usage:
  openwop providers list [--json]
  openwop providers add <provider> [--provider-key KEY|--api-key-env VAR] [--model MODEL] [--credential-ref REF]
  openwop providers remove <provider> [--credential-ref REF]
  openwop providers test <provider> [--credential-ref REF]

Provider must be one of: anthropic, openai, google, minimax.
`;

export async function runProviders(ctx: Ctx, argv) {
  const sub = argv[0] ?? 'list';
  const args = argv.slice(['list', 'add', 'remove', 'rm', 'test'].includes(sub) ? 1 : 0);
  if (sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, PROVIDERS_HELP);
    return 0;
  }
  switch (sub) {
    case 'list':
      return await runProvidersList(ctx, args);
    case 'add':
      return await runProvidersAdd(ctx, args);
    case 'remove':
    case 'rm':
      return await runProvidersRemove(ctx, args);
    case 'test':
      return await runProvidersTest(ctx, args);
    default:
      throw new CliError(`Unknown providers command: ${sub}\nRun \`openwop providers --help\` for usage.`);
  }
}

async function runProvidersList(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, { bool: ['--help'] });
  if (options.help) {
    write(ctx.io.stdout, PROVIDERS_HELP);
    return 0;
  }
  const res = await requestJson(ctx, '/v1/host/sample/byok/secrets');
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  const secrets = Array.isArray(res.body?.secrets) ? res.body.secrets : [];
  if (secrets.length === 0) {
    writeLine(ctx.io.stdout, 'No credentials stored. Run `openwop onboard` or `openwop providers add <provider>`.');
    return 0;
  }
  const rows = secrets.map((s) => ({
    credentialRef: typeof s === 'string' ? s : s.credentialRef,
    createdAt: typeof s === 'object' ? (s.createdAt ?? '') : '',
  }));
  writeLine(ctx.io.stdout, formatTable(rows, ['credentialRef', 'createdAt']));
  return 0;
}

async function runProvidersAdd(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--provider-key', '--api-key-env', '--model', '--credential-ref'],
  });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop providers add <provider> [--provider-key KEY|--api-key-env VAR] [--model MODEL] [--credential-ref REF]\n');
    return options.help ? 0 : 2;
  }
  const provider = positionals[0];
  if (!PROVIDER_CATALOG[provider]) {
    throw new CliError(`Unknown provider: ${provider}. Must be one of: ${Object.keys(PROVIDER_CATALOG).join(', ')}`);
  }
  const interactive = Boolean(process.stdin.isTTY);
  const apiKey = await resolveApiKey(ctx, options, provider, interactive);
  const credentialRef = options.credentialRef ?? `${provider}-default`;
  await requestJson(ctx, '/v1/host/sample/byok/secrets', {
    method: 'POST',
    body: { credentialRef, value: apiKey },
  });
  // Update local config with the default provider/model if not yet set.
  const configPath = configPathFor(undefined, ctx.env);
  const existing = readConfigSafe(configPath);
  const recommended = PROVIDER_CATALOG[provider].models.find((m) => m.recommended) ?? PROVIDER_CATALOG[provider].models[0];
  saveConfig(configPath, mergeConfig(existing, {
    version: 1,
    host: existing?.host ?? { baseUrl: ctx.baseUrl, apiKey: ctx.apiKey },
    defaultProvider: existing?.defaultProvider ?? provider,
    defaultModel: existing?.defaultModel ?? (options.model ?? recommended.id),
    credentialRef,
    updatedAt: new Date().toISOString(),
  }));
  if (ctx.json) {
    writeJson(ctx.io.stdout, { credentialRef, provider, model: options.model ?? recommended.id });
  } else {
    writeLine(ctx.io.stdout, `✓ Stored credential \`${credentialRef}\` for ${provider}`);
  }
  return 0;
}

async function runProvidersRemove(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--credential-ref'],
  });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop providers remove <provider> [--credential-ref REF]\n');
    return options.help ? 0 : 2;
  }
  const provider = positionals[0];
  const credentialRef = options.credentialRef ?? `${provider}-default`;
  await requestJson(ctx, `/v1/host/sample/byok/secrets/${encodeURIComponent(credentialRef)}`, { method: 'DELETE' });
  if (ctx.json) writeJson(ctx.io.stdout, { removed: credentialRef });
  else writeLine(ctx.io.stdout, `✓ Removed credential \`${credentialRef}\``);
  return 0;
}

async function runProvidersTest(ctx: Ctx, argv) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--credential-ref'],
  });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, 'Usage: openwop providers test <provider> [--credential-ref REF]\n');
    return options.help ? 0 : 2;
  }
  const provider = positionals[0];
  const credentialRef = options.credentialRef ?? `${provider}-default`;
  const res = await testProviderConnection(ctx, credentialRef);
  if (ctx.json) {
    writeJson(ctx.io.stdout, { provider, credentialRef, ok: res.ok, message: res.message });
    return res.ok ? 0 : 1;
  }
  if (res.ok) {
    writeLine(ctx.io.stdout, `✓ ${provider}: credential \`${credentialRef}\` is reachable.`);
    return 0;
  }
  writeLine(ctx.io.stdout, `✗ ${provider}: ${res.message}`);
  return 1;
}
