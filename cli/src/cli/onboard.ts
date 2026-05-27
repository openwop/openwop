import type { Ctx } from '../context.js';
/** `openwop onboard` — guided first-run setup wizard. */
import { CliError, HttpError } from '../errors.js';
import { write, writeLine } from '../io.js';
import { parseOptions } from '../options.js';
import { requestJson } from '../api.js';
import { promptChoice, promptYesNo } from '../prompt.js';
import { configPathFor, readConfigSafe, saveConfig, mergeConfig } from '../config.js';
import { defaultApiKeyFor } from './shared.js';
import { resolveBaseUrl, resolveProvider, resolveApiKey, resolveModel, testProviderConnection } from './providerHelpers.js';

export const ONBOARD_HELP = `Usage: openwop onboard [options]

Guided first-run setup. Walks through host URL, AI provider, API key, and model
selection, stores the credential against the demo's BYOK endpoint, and writes
~/.openwop/config.json. Re-running is safe — you'll be asked Keep/Modify/Reset.

Options:
  --base-url-choice <shared|local>   Skip the host prompt; pick a preset.
  --base-url <url>                   Skip the host prompt; use a custom URL (also honored from --base-url at global scope).
  --provider <name>                  anthropic | openai | google | minimax
  --provider-key <key>               Provider API key (avoid on shared shells — use env or stdin instead).
  --api-key-env <var>                Pull the API key from this env var.
  --model <id>                       Model id (e.g., claude-sonnet-4-6).
  --credential-ref <ref>             credentialRef to store on the backend (default: <provider>-default).
  --profile <name>                   Use ~/.openwop-<name>/ instead of ~/.openwop/.
  --non-interactive                  Fail instead of prompting; requires --provider + a key source.
  --reset                            Wipe existing config and start fresh.
  --skip-test, --no-test             Skip the post-save provider-reachability check.

If ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY / MINIMAX_API_KEY is set
in env, the wizard auto-detects it and asks once before using.

Examples:
  openwop onboard
  openwop onboard --non-interactive --base-url-choice shared --provider anthropic --api-key-env ANTHROPIC_API_KEY
  openwop onboard --reset
`;

export async function runOnboard(ctx: Ctx, argv) {
  const { options } = parseOptions(argv, {
    bool: ['--help', '--non-interactive', '--reset', '--skip-test', '--no-test'],
    value: [
      '--profile', '--base-url-choice', '--provider',
      '--provider-key', '--api-key-env', '--model', '--credential-ref',
    ],
  });
  if (options.help) {
    write(ctx.io.stdout, ONBOARD_HELP);
    return 0;
  }

  const interactive = !options.nonInteractive && Boolean(process.stdin.isTTY);
  const configPath = configPathFor(options.profile, ctx.env);
  const existing = readConfigSafe(configPath);

  writeLine(ctx.io.stdout, 'OpenWOP onboarding wizard');
  writeLine(ctx.io.stdout, '─────────────────────────');
  writeLine(ctx.io.stdout, '');

  // Step 1 — existing config
  if (existing && !options.reset) {
    if (interactive) {
      writeLine(ctx.io.stdout, `Found existing config at ${configPath}.`);
      const choice = await promptChoice(ctx, 'Keep, Modify, or Reset?', [
        { key: 'keep', label: 'Keep — exit without changes' },
        { key: 'modify', label: 'Modify — update fields, preserve the rest', recommended: true },
        { key: 'reset', label: 'Reset — wipe and re-run from scratch' },
      ]);
      if (choice === 'keep') {
        writeLine(ctx.io.stdout, 'Nothing changed.');
        return 0;
      }
      if (choice === 'reset') {
        // Fall through; we overwrite the file at save time.
      }
      // 'modify' keeps `existing` in scope as defaults below.
    }
  }

  // Step 2 — host URL
  const baseUrl = await resolveBaseUrl(ctx, options, existing, interactive);
  writeLine(ctx.io.stdout, `✓ Host: ${baseUrl}`);
  writeLine(ctx.io.stdout, '');

  // Step 3 — provider
  const provider = await resolveProvider(ctx, options, existing, interactive);
  if (provider === null) {
    // User explicitly chose to skip — save partial config and exit.
    saveConfig(configPath, mergeConfig(existing, { host: { baseUrl }, defaultProvider: null }));
    writeLine(ctx.io.stdout, `✓ Configuration saved to ${configPath}`);
    writeLine(ctx.io.stdout, '');
    writeLine(ctx.io.stdout, 'Next: add a provider when you have credentials:');
    writeLine(ctx.io.stdout, '  openwop providers add <anthropic|openai|google|minimax>');
    return 0;
  }
  writeLine(ctx.io.stdout, `✓ Provider: ${provider}`);
  writeLine(ctx.io.stdout, '');

  // Step 4 — API key
  const apiKey = await resolveApiKey(ctx, options, provider, interactive);

  // Step 5 — model
  const model = await resolveModel(ctx, options, provider, existing, interactive);
  writeLine(ctx.io.stdout, `✓ Model: ${model}`);
  writeLine(ctx.io.stdout, '');

  // Step 6 — POST credential to backend BYOK store
  const credentialRef = options.credentialRef ?? `${provider}-default`;
  const byokCtx = { ...ctx, baseUrl };
  writeLine(ctx.io.stdout, `Storing credential at ${baseUrl}/v1/host/sample/byok/secrets ...`);
  try {
    await requestJson(byokCtx, '/v1/host/sample/byok/secrets', {
      method: 'POST',
      body: { credentialRef, value: apiKey },
    });
    writeLine(ctx.io.stdout, `✓ Stored credential ref \`${credentialRef}\``);
  } catch (err) {
    const detail = err instanceof HttpError ? `HTTP ${err.status}` : String(err);
    throw new CliError(`Could not store credential at ${baseUrl}: ${detail}`);
  }
  writeLine(ctx.io.stdout, '');

  // Step 7 — save config (api key is NEVER written; backend holds it)
  const config = mergeConfig(existing, {
    version: 1,
    host: { baseUrl, apiKey: ctx.apiKey ?? defaultApiKeyFor(baseUrl) },
    defaultProvider: provider,
    defaultModel: model,
    credentialRef,
    updatedAt: new Date().toISOString(),
  });
  saveConfig(configPath, config);
  writeLine(ctx.io.stdout, `✓ Configuration saved to ${configPath}`);
  writeLine(ctx.io.stdout, '');

  // Step 8 — test the connection
  const shouldTest = !options.skipTest && !options.noTest
    && (interactive ? await promptYesNo(ctx, 'Test the connection now?', true) : false);
  if (shouldTest) {
    const testRes = await testProviderConnection(byokCtx, credentialRef);
    if (testRes.ok) {
      writeLine(ctx.io.stdout, `✓ Provider check passed — credentialRef \`${credentialRef}\` is reachable.`);
    } else {
      writeLine(ctx.io.stdout, `! Provider check warning: ${testRes.message}`);
    }
    writeLine(ctx.io.stdout, '');
  }

  // Step 9 — next steps
  writeLine(ctx.io.stdout, 'Next steps:');
  writeLine(ctx.io.stdout, '  openwop demo status');
  writeLine(ctx.io.stdout, '  openwop providers list');
  writeLine(ctx.io.stdout, '  openwop catalog nodes --search ai');
  writeLine(ctx.io.stdout, '  openwop runs create sample.chat.turn --input \'messages=[{"role":"user","content":"hello"}]\' --wait');
  return 0;
}
