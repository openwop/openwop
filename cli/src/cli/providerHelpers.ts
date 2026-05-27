import type { Ctx } from '../context.js';
/** Shared onboarding/provider resolvers used by `onboard` + `providers`. */
import { CliError } from '../errors.js';
import { writeLine } from '../io.js';
import { requestJson } from '../api.js';
import { promptChoice, promptText, promptYesNo, readSecret } from '../prompt.js';
import { DEFAULT_BASE_URL, PROVIDER_CATALOG, HOST_PRESETS } from '../constants.js';
import { normalizeBaseUrl } from './shared.js';

export async function resolveBaseUrl(ctx: Ctx, options, existing, interactive) {
  if (options.baseUrlChoice) {
    const preset = HOST_PRESETS.find((h) => h.key === options.baseUrlChoice);
    if (!preset) throw new CliError(`--base-url-choice must be one of: ${HOST_PRESETS.map((h) => h.key).join(', ')}`);
    return preset.url;
  }
  if (ctx.baseUrl && ctx.baseUrl !== DEFAULT_BASE_URL) {
    // User passed --base-url at the top level
    return ctx.baseUrl;
  }
  if (existing?.host?.baseUrl && !interactive) return existing.host.baseUrl;
  if (!interactive) return ctx.baseUrl;

  const choices = [
    ...HOST_PRESETS.map((h, i) => ({ key: h.key, label: h.label, recommended: i === 0 })),
    { key: 'custom', label: 'Custom URL' },
  ];
  const choice = await promptChoice(ctx, 'Where should the CLI talk to?', choices);
  if (choice === 'custom') {
    const url = await promptText(ctx, 'Enter the host base URL: ', existing?.host?.baseUrl ?? '');
    if (!url) throw new CliError('Base URL is required');
    return normalizeBaseUrl(url);
  }
  const preset = HOST_PRESETS.find((h) => h.key === choice);
  if (!preset) throw new CliError(`Unknown host choice: ${choice}`);
  return preset.url;
}

export async function resolveProvider(ctx: Ctx, options, existing, interactive) {
  if (options.provider) {
    if (!PROVIDER_CATALOG[options.provider]) {
      throw new CliError(`Unknown provider: ${options.provider}. Must be one of: ${Object.keys(PROVIDER_CATALOG).join(', ')}`);
    }
    return options.provider;
  }
  if (!interactive) {
    if (existing?.defaultProvider) return existing.defaultProvider;
    throw new CliError('--provider is required in non-interactive mode (choices: anthropic, openai, google, minimax)');
  }
  const choices = [
    ...Object.entries(PROVIDER_CATALOG).map(([key, spec], i) => ({
      key,
      label: spec.label,
      recommended: i === 0,
    })),
    { key: 'skip', label: 'Skip — I\'ll add providers later' },
  ];
  const choice = await promptChoice(ctx, 'Pick an AI provider:', choices);
  return choice === 'skip' ? null : choice;
}

export async function resolveApiKey(ctx: Ctx, options, provider, interactive) {
  const spec = PROVIDER_CATALOG[provider];
  if (options.providerKey) return options.providerKey;
  if (options.apiKeyEnv) {
    const value = ctx.env[options.apiKeyEnv];
    if (!value) throw new CliError(`Env var ${options.apiKeyEnv} is not set`);
    return value;
  }
  const envValue = ctx.env[spec.envVar];
  if (envValue && interactive) {
    const useEnv = await promptYesNo(ctx, `Found ${spec.envVar} in env. Use it?`, true);
    if (useEnv) return envValue;
  } else if (envValue && !interactive) {
    return envValue;
  }
  if (!interactive) {
    throw new CliError(`Provide --provider-key, --api-key-env VAR, or set ${spec.envVar} in env`);
  }
  const key = await readSecret(ctx, `Paste your ${spec.label} API key (input hidden): `);
  if (!key) throw new CliError('API key is required');
  return key;
}

export async function resolveModel(ctx: Ctx, options, provider, existing, interactive) {
  const spec = PROVIDER_CATALOG[provider];
  if (options.model) return options.model;
  const recommended = spec.models.find((m) => m.recommended) ?? spec.models[0];
  if (!interactive) {
    if (existing?.defaultModel) return existing.defaultModel;
    return recommended.id;
  }
  const choices = [
    ...spec.models.map((m) => ({ key: m.id, label: m.label, recommended: m.recommended })),
    { key: 'custom', label: 'Custom (type a model id)' },
  ];
  const choice = await promptChoice(ctx, 'Pick a model:', choices);
  if (choice === 'custom') {
    const id = await promptText(ctx, 'Model id: ', recommended.id);
    if (!id) throw new CliError('Model id is required');
    return id;
  }
  return choice;
}

export async function testProviderConnection(ctx: Ctx, credentialRef) {
  try {
    const res = await requestJson(ctx, '/v1/host/sample/byok/secrets');
    const secrets = Array.isArray(res.body?.secrets) ? res.body.secrets : [];
    const found = secrets.some((s) => (typeof s === 'string' ? s === credentialRef : s.credentialRef === credentialRef));
    if (!found) return { ok: false, message: `BYOK list did not include \`${credentialRef}\`` };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
