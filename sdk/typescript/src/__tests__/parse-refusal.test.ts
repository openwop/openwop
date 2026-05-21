import { describe, it, expect } from 'vitest';
import { parseRefusal } from '../parse-refusal.js';

describe('parseRefusal: no-refusal cases return null', () => {
  it('returns null for undefined / null / primitives', () => {
    expect(parseRefusal(undefined)).toBeNull();
    expect(parseRefusal(null)).toBeNull();
    expect(parseRefusal('not a response')).toBeNull();
    expect(parseRefusal(42)).toBeNull();
  });

  it('returns null for empty objects + arrays', () => {
    expect(parseRefusal({})).toBeNull();
    expect(parseRefusal([])).toBeNull();
  });

  it('returns null for normal OpenAI completion (finish_reason: stop)', () => {
    const response = {
      choices: [{ finish_reason: 'stop', message: { content: 'Hello!' } }],
    };
    expect(parseRefusal(response)).toBeNull();
  });

  it('returns null for normal Anthropic completion (stop_reason: end_turn)', () => {
    const response = {
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Hello!' }],
    };
    expect(parseRefusal(response)).toBeNull();
  });

  it('returns null for normal Gemini completion (finishReason: STOP)', () => {
    const response = {
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'Hello!' }] } }],
    };
    expect(parseRefusal(response)).toBeNull();
  });

  it('returns null for OpenAI tool-call (finish_reason: tool_calls)', () => {
    const response = {
      choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: 'x' }] } }],
    };
    expect(parseRefusal(response)).toBeNull();
  });
});

describe('parseRefusal: OpenAI refusal detection', () => {
  it('detects message.refusal field (OpenAI structured-output refusal)', () => {
    const response = {
      choices: [
        {
          finish_reason: 'stop',
          message: { refusal: 'I cannot help with that request.' },
        },
      ],
    };
    const result = parseRefusal(response);
    expect(result).not.toBeNull();
    expect(result?.refusalText).toBe('I cannot help with that request.');
    expect(result?.provider).toBe('openai');
  });

  it('detects finish_reason: content_filter (legacy safety-stop)', () => {
    const response = {
      choices: [
        {
          finish_reason: 'content_filter',
          message: { content: 'Partial content before filter…' },
        },
      ],
    };
    const result = parseRefusal(response);
    expect(result).not.toBeNull();
    expect(result?.provider).toBe('openai');
    expect(result?.safetyCategory).toBe('content_filter');
    expect(result?.refusalText).toBe('Partial content before filter…');
  });

  it('detects content_filter with no inline content (refusalText is null)', () => {
    const response = {
      choices: [{ finish_reason: 'content_filter', message: {} }],
    };
    const result = parseRefusal(response);
    expect(result?.provider).toBe('openai');
    expect(result?.refusalText).toBeNull();
  });

  it('prefers refusal field over content_filter signal when both present', () => {
    const response = {
      choices: [
        {
          finish_reason: 'content_filter',
          message: { refusal: 'Explicit refusal text.' },
        },
      ],
    };
    const result = parseRefusal(response);
    expect(result?.refusalText).toBe('Explicit refusal text.');
  });

  it('ignores empty refusal string', () => {
    const response = {
      choices: [{ finish_reason: 'stop', message: { refusal: '' } }],
    };
    expect(parseRefusal(response)).toBeNull();
  });
});

describe('parseRefusal: Anthropic refusal detection', () => {
  it('detects stop_reason: refusal with inline content', () => {
    const response = {
      stop_reason: 'refusal',
      content: [{ type: 'text', text: 'I cannot proceed with that request.' }],
    };
    const result = parseRefusal(response);
    expect(result).not.toBeNull();
    expect(result?.provider).toBe('anthropic');
    expect(result?.refusalText).toBe('I cannot proceed with that request.');
  });

  it('concatenates multiple text blocks with newlines', () => {
    const response = {
      stop_reason: 'refusal',
      content: [
        { type: 'text', text: 'First refusal sentence.' },
        { type: 'text', text: 'Second refusal sentence.' },
      ],
    };
    const result = parseRefusal(response);
    expect(result?.refusalText).toBe('First refusal sentence.\nSecond refusal sentence.');
  });

  it('returns refusalText: null when stop_reason: refusal but no text blocks', () => {
    const response = { stop_reason: 'refusal', content: [] };
    const result = parseRefusal(response);
    expect(result?.provider).toBe('anthropic');
    expect(result?.refusalText).toBeNull();
  });

  it('ignores non-text content blocks (tool_use, image, etc.)', () => {
    const response = {
      stop_reason: 'refusal',
      content: [
        { type: 'tool_use', id: 'abc' },
        { type: 'text', text: 'Refusal text here.' },
        { type: 'image', source: { type: 'base64' } },
      ],
    };
    const result = parseRefusal(response);
    expect(result?.refusalText).toBe('Refusal text here.');
  });
});

describe('parseRefusal: Gemini refusal detection', () => {
  it('detects candidates[0].finishReason: SAFETY (output-side block)', () => {
    const response = {
      candidates: [
        {
          finishReason: 'SAFETY',
          safetyRatings: [
            { category: 'HARM_CATEGORY_HARASSMENT', probability: 'HIGH' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', probability: 'MEDIUM' },
          ],
        },
      ],
    };
    const result = parseRefusal(response);
    expect(result).not.toBeNull();
    expect(result?.provider).toBe('google');
    expect(result?.safetyCategory).toBe('HARM_CATEGORY_HARASSMENT'); // highest probability
  });

  it('detects promptFeedback.blockReason (input-side safety block)', () => {
    const response = {
      promptFeedback: {
        blockReason: 'SAFETY',
        safetyRatings: [
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', probability: 'HIGH' },
        ],
      },
    };
    const result = parseRefusal(response);
    expect(result).not.toBeNull();
    expect(result?.provider).toBe('google');
    expect(result?.safetyCategory).toBe('HARM_CATEGORY_DANGEROUS_CONTENT');
  });

  it('returns refusalText: null for Gemini (no inline refusal text surface)', () => {
    const response = { candidates: [{ finishReason: 'SAFETY' }] };
    const result = parseRefusal(response);
    expect(result?.refusalText).toBeNull();
  });

  it('returns no safetyCategory when all ratings are NEGLIGIBLE (defensive)', () => {
    const response = {
      candidates: [
        {
          finishReason: 'SAFETY',
          safetyRatings: [{ category: 'HARM_CATEGORY_HARASSMENT', probability: 'NEGLIGIBLE' }],
        },
      ],
    };
    const result = parseRefusal(response);
    expect(result?.provider).toBe('google');
    expect(result?.safetyCategory).toBeUndefined();
  });

  it('ignores non-SAFETY finishReason like RECITATION / OTHER', () => {
    const response = { candidates: [{ finishReason: 'RECITATION' }] };
    expect(parseRefusal(response)).toBeNull();
  });
});

describe('parseRefusal: defensive behavior on malformed input', () => {
  it('null-safe on choices[0] being non-object', () => {
    expect(parseRefusal({ choices: ['not an object'] })).toBeNull();
  });

  it('null-safe on stop_reason being non-string', () => {
    expect(parseRefusal({ stop_reason: 42 })).toBeNull();
  });

  it('null-safe on candidates[0] being non-object', () => {
    expect(parseRefusal({ candidates: [null] })).toBeNull();
  });

  it('null-safe on safetyRatings being non-array', () => {
    const response = {
      candidates: [{ finishReason: 'SAFETY', safetyRatings: 'not an array' }],
    };
    const result = parseRefusal(response);
    expect(result?.provider).toBe('google');
    expect(result?.safetyCategory).toBeUndefined();
  });
});
