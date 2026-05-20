/**
 * Client-side mirror of the RFC 0027 PromptTemplate + PromptRef wire shapes.
 *
 * Kept aligned with `schemas/prompt-template.schema.json` and
 * `schemas/prompt-ref.schema.json`. When those schemas land in the SDK,
 * this file should re-export from `@openwop/openwop` instead of declaring
 * the types locally.
 */

export type PromptKind = 'system' | 'user' | 'few-shot' | 'schema-hint';

export type PromptVariableType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export type PromptVariableSource = 'input' | 'variable' | 'secret' | 'context';

export interface PromptVariable {
  name: string;
  type: PromptVariableType;
  required: boolean;
  source?: PromptVariableSource;
  extractPath?: string;
  defaultValue?: unknown;
  description?: string;
}

export interface PromptTemplate {
  templateId: string;
  version: string;
  kind: PromptKind;
  text: string;
  name?: string;
  description?: string;
  variables?: PromptVariable[];
  modelHints?: {
    modelClass?: string;
    temperature?: number;
    maxTokens?: number;
    envelopeType?: string;
  };
  tags?: string[];
  meta?: {
    author?: string;
    createdAt?: string;
    updatedAt?: string;
    source?: 'host' | 'pack' | 'user';
    packName?: string;
    packVersion?: string;
  };
}

/** Stringy form per `prompt-ref.schema.json` `oneOf` branch 1. */
export type PromptRefString = `prompt:${string}` | `prompt:${string}@${string}`;

/** Object form per `prompt-ref.schema.json` `oneOf` branch 2. */
export interface PromptRefObject {
  libraryId?: string;
  templateId: string;
  version?: string;
  variableOverrides?: Record<string, unknown>;
}

export type PromptRef = PromptRefString | PromptRefObject;

/** Builds the canonical stringy form from an object ref or template. */
export function refToString(ref: PromptRef | PromptTemplate): string {
  if (typeof ref === 'string') return ref;
  if ('text' in ref) {
    return `prompt:${ref.templateId}@${ref.version}`;
  }
  return ref.version
    ? `prompt:${ref.templateId}@${ref.version}`
    : `prompt:${ref.templateId}`;
}

/** Parses a stringy ref into its components. Returns null on malformed input. */
export function parseRef(ref: string): { templateId: string; version?: string } | null {
  if (!ref.startsWith('prompt:')) return null;
  const body = ref.slice('prompt:'.length);
  const at = body.indexOf('@');
  if (at < 0) return { templateId: body };
  return { templateId: body.slice(0, at), version: body.slice(at + 1) };
}
