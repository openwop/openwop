/**
 * Per-provider multi-modal content-part conversion (providers/dispatch.ts).
 *
 * These converters are the canonical "what correct looks like" for turning a
 * unified ContentPart[] into each provider's native message shape, and the
 * fail-closed contract is the whole point of not silently dropping an
 * attachment a model can't read. Locked in here so a refactor can't quietly
 * break a provider block or remove a throw.
 */

import { describe, expect, it } from 'vitest';
import {
  contentToText,
  contentToAnthropicBlocks,
  contentToOpenAIBlocks,
  contentToGeminiParts,
  type ContentPart,
} from '../src/providers/dispatch.js';

const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const HELLO_B64 = Buffer.from('hello, world').toString('base64');

const imagePart: ContentPart = { type: 'image', mimeType: 'image/png', dataBase64: PNG_B64, alt: 'pixel' };
const pdfPart: ContentPart = { type: 'file', mimeType: 'application/pdf', dataBase64: PNG_B64, name: 'doc.pdf' };
const textFilePart: ContentPart = { type: 'file', mimeType: 'text/plain', dataBase64: HELLO_B64, name: 'note.txt' };

describe('contentToText (string-only providers: Anthropic system, MiniMax)', () => {
  it('passes a plain string through unchanged', () => {
    expect(contentToText('hi', 'MiniMax')).toBe('hi');
  });
  it('inlines a text-file part as decoded text', () => {
    const out = contentToText([{ type: 'text', text: 'see:' }, textFilePart], 'MiniMax');
    expect(out).toContain('see:');
    expect(out).toContain('hello, world');
    expect(out).toContain('note.txt');
  });
  it('throws fail-closed on an image part', () => {
    expect(() => contentToText([imagePart], 'MiniMax')).toThrow(/can't accept/i);
  });
  it('throws fail-closed on a PDF part', () => {
    expect(() => contentToText([pdfPart], 'MiniMax')).toThrow(/can't accept/i);
  });
});

describe('contentToAnthropicBlocks', () => {
  it('collapses an all-text part array to a plain string', () => {
    expect(contentToAnthropicBlocks([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('ab');
  });
  it('emits a base64 image block', () => {
    const blocks = contentToAnthropicBlocks([imagePart]) as Array<Record<string, unknown>>;
    expect(blocks[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_B64 } });
  });
  it('emits a document block for a PDF', () => {
    const blocks = contentToAnthropicBlocks([pdfPart]) as Array<Record<string, unknown>>;
    expect(blocks[0]).toEqual({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: PNG_B64 } });
  });
  it('inlines a text file as a text block', () => {
    const blocks = contentToAnthropicBlocks([textFilePart]) as Array<Record<string, unknown>>;
    expect(blocks[0]!.type).toBe('text');
    expect(String(blocks[0]!.text)).toContain('hello, world');
  });
  it('throws when an image part reaches dispatch unresolved (no bytes)', () => {
    expect(() => contentToAnthropicBlocks([{ type: 'image', mimeType: 'image/png', url: '/v1/host/sample/assets/x' }]))
      .toThrow(/unavailable|not resolved/i);
  });
});

describe('contentToOpenAIBlocks', () => {
  it('emits an image_url data URI', () => {
    const blocks = contentToOpenAIBlocks([imagePart]) as Array<Record<string, unknown>>;
    expect(blocks[0]).toEqual({ type: 'image_url', image_url: { url: `data:image/png;base64,${PNG_B64}` } });
  });
  it('throws fail-closed on a PDF (Chat Completions has no document part)', () => {
    expect(() => contentToOpenAIBlocks([pdfPart])).toThrow(/can't accept/i);
  });
  it('inlines a text file as a text part', () => {
    const blocks = contentToOpenAIBlocks([textFilePart]) as Array<Record<string, unknown>>;
    expect(blocks[0]!.type).toBe('text');
    expect(String(blocks[0]!.text)).toContain('hello, world');
  });
});

describe('contentToGeminiParts', () => {
  it('emits inlineData for an image', () => {
    const parts = contentToGeminiParts([imagePart]);
    expect(parts[0]).toEqual({ inlineData: { mimeType: 'image/png', data: PNG_B64 } });
  });
  it('emits inlineData for a PDF', () => {
    const parts = contentToGeminiParts([pdfPart]);
    expect(parts[0]).toEqual({ inlineData: { mimeType: 'application/pdf', data: PNG_B64 } });
  });
  it('inlines a text file as a text part', () => {
    const parts = contentToGeminiParts([textFilePart]);
    expect(String(parts[0]!.text)).toContain('hello, world');
  });
});
