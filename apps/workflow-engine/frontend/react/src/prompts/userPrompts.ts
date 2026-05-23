/**
 * User-authored prompt store (localStorage).
 *
 * Sits alongside the bundled `SAMPLE_PROMPTS` library:
 * - Bundled samples are read-only (versioned with the app).
 * - User prompts persist per-browser under
 *   `openwop.sample.prompts.user` and are CRUD-able from
 *   `/prompts`. New prompts get a `user:` prefix in their
 *   templateId so they're distinguishable from samples and don't
 *   collide with a future BE-side canonical store.
 *
 * Envelope: `{ v: 1, items: [...] }` — `useChatSessions`-style
 * version-gated payload. Reader drops entries whose envelope
 * version doesn't match the current schema so a future shape
 * change doesn't render with stale data.
 */

import type { PromptTemplate } from './types.js';

const LS_KEY = 'openwop.sample.prompts.user';
const LS_VERSION = 1;

interface Envelope {
  v: number;
  items: PromptTemplate[];
}

function readEnvelope(): PromptTemplate[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<Envelope>;
    if (parsed.v !== LS_VERSION) return [];
    if (!Array.isArray(parsed.items)) return [];
    return parsed.items;
  } catch {
    return [];
  }
}

function writeEnvelope(items: readonly PromptTemplate[]): void {
  try {
    const env: Envelope = { v: LS_VERSION, items: [...items] };
    localStorage.setItem(LS_KEY, JSON.stringify(env));
  } catch {
    /* over-quota — silently drop, the UI will surface state via reload */
  }
}

export function listUserPrompts(): PromptTemplate[] {
  return readEnvelope();
}

export function getUserPrompt(templateId: string): PromptTemplate | null {
  return readEnvelope().find((p) => p.templateId === templateId) ?? null;
}

/** Create or overwrite a user prompt. Returns the persisted entry. */
export function upsertUserPrompt(prompt: PromptTemplate): PromptTemplate {
  const items = readEnvelope();
  const idx = items.findIndex((p) => p.templateId === prompt.templateId);
  if (idx >= 0) items[idx] = prompt;
  else items.unshift(prompt);
  writeEnvelope(items);
  return prompt;
}

export function deleteUserPrompt(templateId: string): void {
  const items = readEnvelope().filter((p) => p.templateId !== templateId);
  writeEnvelope(items);
}

/** `user:` prefix marks a prompt as user-authored. Sample IDs never
 *  use this prefix so a sample with the same slug doesn't collide. */
export function isUserPromptId(templateId: string): boolean {
  return templateId.startsWith('user:');
}

/** Generate a stable templateId from a user-supplied name. Slug-style,
 *  collision-checked against existing entries (appends `-2`, `-3`, …). */
export function suggestUserPromptId(
  name: string,
  existingIds: readonly string[],
): string {
  const base = `user:${slugify(name) || 'prompt'}`;
  if (!existingIds.includes(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!existingIds.includes(candidate)) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
