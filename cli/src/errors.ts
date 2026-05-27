/** CLI error types + the unknown-error narrowing helper. Leaf module. */

/** A user-facing CLI error. `code` is the process exit code (default 2). */
export class CliError extends Error {
  code: number;
  constructor(message: string, code = 2) {
    super(message);
    this.name = 'CliError';
    this.code = code;
  }
}

/** A non-2xx HTTP response from a host/registry. */
export class HttpError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

/** Narrow an unknown caught value to a printable message (strict catch vars). */
export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
