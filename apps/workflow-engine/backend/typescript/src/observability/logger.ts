/**
 * Structured JSON logger for the workflow-engine sample.
 *
 * Emits one JSON object per line on stdout — Cloud Run's logging
 * pipeline auto-promotes structured fields. Levels: debug, info, warn,
 * error. Filtered by OPENWOP_LOG_LEVEL (default: info).
 */

const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
type Level = (typeof LEVELS)[number];

const ENV_LEVEL = (process.env.OPENWOP_LOG_LEVEL as Level | undefined) ?? 'info';
const MIN_LEVEL_INDEX = LEVELS.indexOf(ENV_LEVEL);

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(component: string): Logger;
}

function shouldEmit(level: Level): boolean {
  return LEVELS.indexOf(level) >= MIN_LEVEL_INDEX;
}

function emit(level: Level, component: string, msg: string, fields?: Record<string, unknown>): void {
  if (!shouldEmit(level)) return;
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    component,
    msg,
    ...fields,
  });
  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export function createLogger(component: string): Logger {
  return {
    debug: (msg, fields) => emit('debug', component, msg, fields),
    info: (msg, fields) => emit('info', component, msg, fields),
    warn: (msg, fields) => emit('warn', component, msg, fields),
    error: (msg, fields) => emit('error', component, msg, fields),
    child: (sub) => createLogger(`${component}.${sub}`),
  };
}
