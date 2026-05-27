import type { Ctx } from '../context.js';
/** `openwop media ...` — generate-image / transcribe / synthesize via core.openwop.ai. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { requestJson } from '../api.js';
import { CliError, HttpError } from '../errors.js';
import { write, writeLine, writeJson, formatTable } from '../io.js';
import { parseOptions } from '../options.js';

export const MEDIA_HELP = `Usage:
  openwop media generate-image <prompt> [--output path] [--json]
  openwop media transcribe <audio-file> [--language en] [--json]
  openwop media synthesize <text> [--voice name] [--output path] [--json]

Exercises the host's core.openwop.ai media node family (image-generate,
audio-transcribe, audio-synthesize) through the demo backend's sample media
routes. --output writes the returned binary asset (PNG / WAV) to a file.

Note: the demo backend STUBS the actual provider calls — it advertises
aiProviders.imageGeneration: supported:false and wires no live media
provider — so results are deterministic fixture assets tagged \`stub: true\`,
not live generations. A production host with a wired provider returns real
media at the same endpoints.

Examples:
  openwop media generate-image "a red bicycle" --output bike.png
  openwop media transcribe clip.wav --language en
  openwop media synthesize "hello world" --output hello.wav --json
`;


export async function runMedia(ctx: Ctx, argv: string[]) {
  const sub = argv[0];
  const args = argv.slice(1);
  if (!sub || sub === '--help' || sub === '-h') {
    write(ctx.io.stdout, MEDIA_HELP);
    return sub ? 0 : 2;
  }
  switch (sub) {
    case 'generate-image':
      return runMediaGenerateImage(ctx, args);
    case 'transcribe':
      return runMediaTranscribe(ctx, args);
    case 'synthesize':
      return runMediaSynthesize(ctx, args);
    default:
      throw new CliError(`Unknown media command: ${sub}\nRun \`openwop media --help\` for usage.`);
  }
}

async function runMediaGenerateImage(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--prompt', '--output'],
  });
  const prompt = options.prompt ?? positionals.join(' ');
  if (options.help || !prompt) {
    write(ctx.io.stdout, 'Usage: openwop media generate-image <prompt> [--output path] [--json]\n');
    return options.help ? 0 : 2;
  }
  const res = await requestJson(ctx, '/v1/host/sample/media/generate-image', {
    method: 'POST',
    body: { prompt },
  });
  if (options.output) await downloadAsset(ctx, res.body.url, options.output);
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  writeLine(ctx.io.stdout, formatTable(
    [{ field: 'contentType', value: res.body.contentType ?? '' },
     { field: 'bytes', value: String(res.body.bytes ?? '') },
     { field: 'url', value: res.body.url ?? '' },
     { field: 'stub', value: String(res.body.stub ?? false) }],
    ['field', 'value'],
  ));
  if (options.output) writeLine(ctx.io.stdout, `Wrote asset to ${options.output}`);
  return 0;
}

async function runMediaTranscribe(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--file', '--language'],
  });
  const filePath = options.file ?? positionals[0];
  if (options.help || !filePath) {
    write(ctx.io.stdout, 'Usage: openwop media transcribe <audio-file> [--language en] [--json]\n');
    return options.help ? 0 : 2;
  }
  let audioBase64;
  try {
    audioBase64 = readFileSync(resolvePath(ctx.cwd, filePath)).toString('base64');
  } catch (err) {
    throw new CliError(`Cannot read audio file ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const res = await requestJson(ctx, '/v1/host/sample/media/transcribe', {
    method: 'POST',
    body: { audioBase64, ...(options.language ? { language: options.language } : {}) },
  });
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  writeLine(ctx.io.stdout, formatTable(
    [{ field: 'language', value: res.body.language ?? '' },
     { field: 'bytes', value: String(res.body.bytes ?? '') },
     { field: 'stub', value: String(res.body.stub ?? false) }],
    ['field', 'value'],
  ));
  writeLine(ctx.io.stdout, '');
  writeLine(ctx.io.stdout, res.body.text ?? '');
  return 0;
}

async function runMediaSynthesize(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help'],
    value: ['--text', '--voice', '--output'],
  });
  const text = options.text ?? positionals.join(' ');
  if (options.help || !text) {
    write(ctx.io.stdout, 'Usage: openwop media synthesize <text> [--voice name] [--output path] [--json]\n');
    return options.help ? 0 : 2;
  }
  const res = await requestJson(ctx, '/v1/host/sample/media/synthesize', {
    method: 'POST',
    body: { text, ...(options.voice ? { voice: options.voice } : {}) },
  });
  if (options.output) await downloadAsset(ctx, res.body.url, options.output);
  if (ctx.json) {
    writeJson(ctx.io.stdout, res.body);
    return 0;
  }
  writeLine(ctx.io.stdout, formatTable(
    [{ field: 'contentType', value: res.body.contentType ?? '' },
     { field: 'bytes', value: String(res.body.bytes ?? '') },
     { field: 'voice', value: res.body.voice ?? '' },
     { field: 'url', value: res.body.url ?? '' },
     { field: 'stub', value: String(res.body.stub ?? false) }],
    ['field', 'value'],
  ));
  if (options.output) writeLine(ctx.io.stdout, `Wrote asset to ${options.output}`);
  return 0;
}

/** Fetch a media-asset URL (relative to the host base URL) and write the
 *  raw bytes to `outPath`. The asset serve route is token-authed (the URL
 *  IS the credential) so no Authorization header is required. */
async function downloadAsset(ctx: Ctx, assetUrl: any, outPath: any) {
  if (typeof assetUrl !== 'string' || assetUrl.length === 0) {
    throw new CliError('media response did not include an asset URL to download');
  }
  const url = new URL(assetUrl, ctx.baseUrl);
  const res = await ctx.fetchImpl(url, { method: 'GET', headers: { accept: 'application/octet-stream' } });
  if (!res.ok) throw new HttpError(`HTTP ${res.status}`, res.status, null);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(resolvePath(ctx.cwd, outPath), buf);
}
