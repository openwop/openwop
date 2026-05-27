import type { Ctx } from './context.js';
/** Interactive prompt helpers (Node stdlib readline + raw-mode secret input). */
import { createInterface } from 'node:readline';
import { CliError } from './errors.js';
import { write, writeLine } from './io.js';

export async function promptChoice(ctx: Ctx, label, choices) {
  writeLine(ctx.io.stdout, label);
  choices.forEach((c, i) => {
    const tag = c.recommended ? ' (recommended)' : '';
    writeLine(ctx.io.stdout, `  ${i + 1}) ${c.label}${tag}`);
  });
  const defaultIdx = Math.max(0, choices.findIndex((c) => c.recommended));
  const answer = await promptText(ctx, `Choice [${defaultIdx + 1}]: `, '');
  const idx = answer.trim() === '' ? defaultIdx : Number(answer.trim()) - 1;
  if (!Number.isInteger(idx) || idx < 0 || idx >= choices.length) {
    throw new CliError(`Invalid choice: ${answer}`);
  }
  return choices[idx].key;
}

export async function promptText(ctx: Ctx, prompt: string, defaultValue = ''): Promise<string> {
  ctx.io.stdout.write(prompt);
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  return new Promise((resolve) => {
    rl.once('line', (line) => {
      rl.close();
      resolve(line.length > 0 ? line : defaultValue);
    });
  });
}

export async function promptYesNo(ctx: Ctx, label, defaultYes = true) {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = (await promptText(ctx, `${label} ${hint} `, '')).trim().toLowerCase();
  if (answer === '') return defaultYes;
  return answer === 'y' || answer === 'yes';
}

export async function readSecret(ctx: Ctx, prompt) {
  ctx.io.stdout.write(prompt);
  const stdin = process.stdin;
  // Pipe / non-TTY: read one line normally so `echo KEY | openwop ...` works.
  if (!stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: process.stdout, terminal: false });
    return new Promise((resolve) => {
      rl.once('line', (line) => {
        rl.close();
        resolve(line);
      });
    });
  }
  // TTY: raw-mode keypress loop with no echo + Ctrl-C support + backspace.
  return new Promise((resolve, reject) => {
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      ctx.io.stdout.write('\n');
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (code === 0x0d || code === 0x0a) { cleanup(); resolve(value); return; }
        if (code === 0x03) { cleanup(); reject(new CliError('Aborted')); return; }
        if (code === 0x7f || code === 0x08) { value = value.slice(0, -1); continue; }
        if (code >= 0x20) value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

