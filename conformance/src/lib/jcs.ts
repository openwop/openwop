/**
 * RFC 0212 — canonical JSON is RFC 8785 (JCS), and the input MUST be I-JSON.
 *
 * Every signature and digest in the corpus is over these bytes: pack
 * signatures (`ed25519-canonical-json`), the certification-bundle attestation,
 * `discovery.sha256`, `witnessSha256`, and the RFC 0150 semantic request digest.
 * `conformance/vectors/jcs-v1.json` is the normative test of this module and of
 * any other-language implementation.
 *
 * Two entry points, because two of the refusals are invisible after a parse:
 *
 *   - `canonicalJSON(value)` — the VALUE boundary. Refuses what a native value
 *     can still show: non-finite numbers, non-JSON values (undefined, functions,
 *     bigint, symbols, class instances such as Date) and lone surrogates.
 *   - `parseIJson(text)` — the TEXT boundary. `JSON.parse` keeps the last of two
 *     duplicate names and rounds `9007199254740993` to `…992` silently; both are
 *     refused here, before coercion. Read a document you will re-canonicalize
 *     through this, not `JSON.parse`.
 *
 * Why not `Object.keys(v).sort()` + `JSON.stringify` with no checks (the code
 * this replaces): it is JCS for well-formed input — the default sort IS UTF-16
 * code-unit order and ES number/string serialization IS JCS §3.2.2 — but it
 * turns NaN into `null`, emits the text `undefined`, and signs a rounded
 * integer. Each of those is a document two verifiers read differently with no
 * error on either side.
 */

export type JcsRefusalKind = 'duplicate-name' | 'lone-surrogate' | 'integer-out-of-range' | 'non-finite' | 'not-json';

export class JcsRefusal extends Error {
  readonly kind: JcsRefusalKind;
  constructor(kind: JcsRefusalKind, message: string) {
    super(`RFC 0212 §B refusal (${kind}): ${message}`);
    this.name = 'JcsRefusal';
    this.kind = kind;
  }
}

/** A JSON number literal, matched in place (sticky) so parsing stays linear. */
const NUMBER = /-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/y;

/** ±(2^53 − 1), for the integer-literal refusal at the text boundary. */
const MAX_EXACT_BIG = 2n ** 53n - 1n;

/**
 * RFC 8785 §3.2.3 — compare by UTF-16 code units. Explicit rather than the
 * `Array.prototype.sort` default so the rule is visible at every call site, and
 * never `localeCompare`: collation is locale-dependent (Czech sorts `ch` after
 * `h`; English puts `a` before `A` and ignores `-`), so a digest computed with
 * it depends on the machine that computed it.
 */
export function codeUnitCompare(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    const d = a.charCodeAt(i) - b.charCodeAt(i);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

function assertWellFormed(s: string, where: string): void {
  for (let i = 0; i < s.length; i += 1) {
    const u = s.charCodeAt(i);
    if (u >= 0xd800 && u <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) { i += 1; continue; }
      throw new JcsRefusal('lone-surrogate', `lone high surrogate U+${u.toString(16).toUpperCase()} in ${where}`);
    }
    if (u >= 0xdc00 && u <= 0xdfff) throw new JcsRefusal('lone-surrogate', `lone low surrogate U+${u.toString(16).toUpperCase()} in ${where}`);
  }
}

function serializeNumber(n: number): string {
  if (!Number.isFinite(n)) throw new JcsRefusal('non-finite', `${String(n)} is not a JSON number`);
  // No magnitude check here: a double is already exact, and JCS serializes it
  // (RFC 8785 Appendix B includes 9007199254740994). The integer-range refusal
  // is about a LITERAL that no double holds, which only the text shows — see
  // `parseIJson`.
  return Object.is(n, -0) ? '0' : String(n);
}

function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v) as unknown;
  return proto === Object.prototype || proto === null;
}

/** RFC 8785 serialization of an I-JSON value. Throws `JcsRefusal` instead of coercing. */
export function canonicalJSON(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean': return value ? 'true' : 'false';
    case 'number': return serializeNumber(value);
    case 'string': assertWellFormed(value, 'a string'); return JSON.stringify(value);
    case 'object': break;
    default: throw new JcsRefusal('not-json', `a ${typeof value} is not a JSON value`);
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i += 1) {
      if (!(i in value)) throw new JcsRefusal('not-json', 'a sparse array hole is not a JSON value');
      parts.push(canonicalJSON(value[i]));
    }
    return `[${parts.join(',')}]`;
  }
  if (!isPlainObject(value)) throw new JcsRefusal('not-json', `a ${(value as object).constructor?.name ?? 'non-plain'} object is not a JSON value`);
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort(codeUnitCompare);
  return `{${keys.map((k) => { assertWellFormed(k, 'a member name'); return `${JSON.stringify(k)}:${canonicalJSON(obj[k])}`; }).join(',')}}`;
}

/**
 * Parse JSON text, refusing what `JSON.parse` would silently accept or change:
 * duplicate member names, integer literals outside ±(2^53 − 1), literals that
 * overflow to ±Infinity, and lone surrogates. Members are defined, not
 * assigned, so a member named `__proto__` is data, not a prototype write.
 */
export function parseIJson(text: string): unknown {
  let i = 0;
  const fail = (m: string): never => { throw new JcsRefusal('not-json', `${m} at offset ${i}`); };
  const ws = (): void => { while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i += 1; };

  const str = (): string => {
    if (text[i] !== '"') fail('expected a string');
    i += 1;
    let out = '';
    for (;;) {
      if (i >= text.length) fail('unterminated string');
      const c = text[i];
      i += 1;
      if (c === '"') break;
      if (c === '\\') {
        const e = text[i];
        i += 1;
        switch (e) {
          case '"': out += '"'; break;
          case '\\': out += '\\'; break;
          case '/': out += '/'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'n': out += '\n'; break;
          case 'r': out += '\r'; break;
          case 't': out += '\t'; break;
          case 'u': {
            const h = text.slice(i, i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(h)) fail('bad \\u escape');
            out += String.fromCharCode(parseInt(h, 16));
            i += 4;
            break;
          }
          default: fail('bad escape');
        }
      } else {
        if ((c as string).charCodeAt(0) < 0x20) fail('raw control character in a string');
        out += c;
      }
    }
    assertWellFormed(out, 'a string');
    return out;
  };

  const num = (): number => {
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(text);
    if (m === null) return fail('bad number');
    i += m[0].length;
    if (m[2] === undefined && m[3] === undefined) {
      const b = BigInt(m[0]);
      if (b > MAX_EXACT_BIG || b < -MAX_EXACT_BIG) throw new JcsRefusal('integer-out-of-range', `integer literal ${m[0]} is outside ±(2^53 − 1)`);
    }
    const v = Number(m[0]);
    if (!Number.isFinite(v)) throw new JcsRefusal('non-finite', `${m[0]} overflows to a non-finite number`);
    return v;
  };

  const val = (): unknown => {
    ws();
    const c = text[i];
    if (c === '{') {
      i += 1;
      const obj: Record<string, unknown> = {};
      ws();
      if (text[i] === '}') { i += 1; return obj; }
      for (;;) {
        ws();
        const k = str();
        if (Object.prototype.hasOwnProperty.call(obj, k)) throw new JcsRefusal('duplicate-name', `duplicate member name ${JSON.stringify(k)}`);
        ws();
        if (text[i] !== ':') fail('expected :');
        i += 1;
        Object.defineProperty(obj, k, { value: val(), enumerable: true, writable: true, configurable: true });
        ws();
        const d = text[i];
        i += 1;
        if (d === '}') return obj;
        if (d !== ',') fail('expected , or }');
      }
    }
    if (c === '[') {
      i += 1;
      const arr: unknown[] = [];
      ws();
      if (text[i] === ']') { i += 1; return arr; }
      for (;;) {
        arr.push(val());
        ws();
        const d = text[i];
        i += 1;
        if (d === ']') return arr;
        if (d !== ',') fail('expected , or ]');
      }
    }
    if (c === '"') return str();
    if (text.startsWith('true', i)) { i += 4; return true; }
    if (text.startsWith('false', i)) { i += 5; return false; }
    if (text.startsWith('null', i)) { i += 4; return null; }
    if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) return num();
    return fail('unexpected token');
  };

  const v = val();
  ws();
  if (i !== text.length) fail('trailing data');
  return v;
}

/** JCS bytes of a JSON text, with every §B refusal applied. */
export function canonicalizeText(text: string): string {
  return canonicalJSON(parseIJson(text));
}
