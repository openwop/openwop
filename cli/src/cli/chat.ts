import type { Ctx } from '../context.js';
/** `openwop chat <workflowId>` — interactive streaming REPL. */
import { write, writeLine, writeJson } from '../io.js';
import { parseOptions } from '../options.js';
import { buildInputs } from './shared.js';
import { submitTurn, streamRunEvents, renderEvent, extractAssistantText, defaultReadTurn } from '../sse.js';

export const CHAT_HELP = `Usage: openwop chat <workflowId> [options]

Interactive streaming chat REPL. Each message you type creates a run for
<workflowId> carrying the running conversation as a \`messages\` array, then
streams that run's events to the terminal as they arrive. Type /exit (or
/quit, or press Ctrl-D) to leave.

Streaming:
  Prefers Server-Sent Events (GET /v1/runs/{runId}/events). If the host does
  not stream, it falls back to polling GET /v1/runs/{runId}/events/poll.

Options:
  --input k=v        Extra input carried on every turn (JSON-parsed like runs create).
  --inputs-json J    Seed the whole \`inputs\` object (e.g. credentialRef, model, prior messages).
  --role <role>      Role to tag your turns with (default: user).
  --tenant-id <id>   Tenant id for each run.
  --scope-id <id>    Scope id for each run.
  --timeout-ms <ms>  Per-turn stream timeout (default: 120000).
  --no-stream        Skip SSE and poll for events instead.
  --no-history       Send only the latest turn instead of the full conversation.
  --json             Emit raw event records (one JSON object per event) instead of pretty text.

Examples:
  openwop chat sample.chat.turn
  openwop chat sample.chat.turn --inputs-json '{"credentialRef":"anthropic-default"}'
  openwop chat sample.chat.turn --no-stream --json
`;

export async function runChat(ctx: Ctx, argv: string[]) {
  const { options, positionals } = parseOptions(argv, {
    bool: ['--help', '--no-stream', '--no-history'],
    value: ['--tenant-id', '--scope-id', '--inputs-json', '--timeout-ms', '--role'],
    multi: ['--input'],
  });
  if (options.help || positionals.length !== 1) {
    write(ctx.io.stdout, CHAT_HELP);
    return options.help ? 0 : 2;
  }
  const workflowId = positionals[0];
  const timeoutMs = Number(options.timeoutMs ?? 120000);
  const useStream = !options.noStream;
  const keepHistory = !options.noHistory;
  const role = options.role ?? 'user';

  // Seed inputs that ride along on every turn (e.g. credentialRef, model).
  // `--input k=v` / `--inputs-json` carry over so the workflow gets the
  // same configurable shape `runs create` would have produced.
  const baseInputs = buildInputs(options);
  // Conversation history threaded as the `messages` array across turns.
  const messages = Array.isArray(baseInputs.messages) ? [...baseInputs.messages] : [];

  if (!ctx.json) {
    writeLine(ctx.io.stdout, `OpenWOP chat — workflow ${workflowId} @ ${ctx.baseUrl}`);
    writeLine(ctx.io.stdout, 'Type a message and press Enter. /exit or Ctrl-D to quit.');
    writeLine(ctx.io.stdout, '');
  }

  const readTurn = ctx.readTurn ?? defaultReadTurn(ctx);
  while (true) {
    const line = await readTurn('you> ');
    if (line === null) {
      // EOF (Ctrl-D) — graceful exit.
      if (!ctx.json) writeLine(ctx.io.stdout, '');
      break;
    }
    const text = line.trim();
    if (text === '') continue;
    if (text === '/exit' || text === '/quit') break;

    messages.push({ role, content: text });
    const inputs = { ...baseInputs, messages: keepHistory ? messages : [{ role, content: text }] };

    let runId;
    try {
      runId = await submitTurn(ctx, { workflowId, inputs, tenantId: options.tenantId, scopeId: options.scopeId });
    } catch (err) {
      writeLine(ctx.io.stderr, `openwop: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const assistantParts: string[] = [];
    const onEvent = (ev: any) => {
      if (ctx.json) {
        writeJson(ctx.io.stdout, ev);
      } else {
        const rendered = renderEvent(ev);
        if (rendered) writeLine(ctx.io.stdout, rendered);
      }
      const reply = extractAssistantText(ev);
      if (reply) assistantParts.push(reply);
    };

    try {
      await streamRunEvents(ctx, runId, { onEvent, useStream, timeoutMs });
    } catch (err) {
      writeLine(ctx.io.stderr, `openwop: stream error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Thread the assistant reply back into history so the next turn has context.
    if (keepHistory && assistantParts.length > 0) {
      messages.push({ role: 'assistant', content: assistantParts.join('') });
    }
    if (!ctx.json) writeLine(ctx.io.stdout, '');
  }
  return 0;
}
