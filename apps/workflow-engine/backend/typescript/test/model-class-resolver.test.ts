/**
 * modelClass → (provider, model) resolution (host/modelClassResolver.ts).
 * Runs against the real providers.json catalog.
 */

import { describe, expect, it } from 'vitest';
import { resolveModelForClass } from '../src/host/modelClassResolver.js';
import { getProviderConfig } from '../src/providers/catalog.js';

/** A resolved (provider, model) must actually exist in the catalog. */
function assertReal(r: { provider: string; model: string } | null) {
  expect(r).not.toBeNull();
  const cfg = getProviderConfig(r!.provider);
  expect(cfg, `provider ${r!.provider} in catalog`).not.toBeNull();
  expect(cfg!.models.some((m) => m.id === r!.model), `model ${r!.model} in ${r!.provider}`).toBe(true);
}

describe('resolveModelForClass', () => {
  it('resolves each known class to a real catalog model', () => {
    for (const cls of ['chat', 'reasoning', 'coding', 'extraction']) {
      assertReal(resolveModelForClass(cls));
    }
  });

  it('reasoning resolves to a different (stronger) model than chat', () => {
    const chat = resolveModelForClass('chat')!;
    const reasoning = resolveModelForClass('reasoning')!;
    expect(reasoning.model).not.toBe(chat.model);
  });

  it('an unknown class falls back to the chat default', () => {
    const unknown = resolveModelForClass('totally-made-up')!;
    const chat = resolveModelForClass('chat')!;
    expect(unknown).toEqual(chat);
  });

  it('honors an explicit provider+model pin', () => {
    const r = resolveModelForClass('chat', { provider: 'openai', model: 'gpt-5.5' });
    expect(r).toEqual({ provider: 'openai', model: 'gpt-5.5', managed: false });
  });

  it('an explicit provider with an unknown model falls back to that provider default', () => {
    const r = resolveModelForClass('chat', { provider: 'openai', model: 'gpt-does-not-exist' })!;
    expect(r.provider).toBe('openai');
    assertReal(r); // model coerced to openai's catalog default
  });

  it('honors an explicit off-catalog provider pin (e.g. the mock provider)', () => {
    // The catalog drives DEFAULT resolution only; an explicit pin is honored so
    // the live-dispatch pipeline can be verified through the keyless `mock`
    // provider. callAI's provider gate is the real safety check.
    expect(resolveModelForClass('chat', { provider: 'mock', model: 'mock' })).toEqual({ provider: 'mock', model: 'mock', managed: false });
    // model defaults to the provider id when unspecified
    expect(resolveModelForClass('reasoning', { provider: 'mock' })).toEqual({ provider: 'mock', model: 'mock', managed: false });
  });

  it('preferManaged resolves to the managed tier', () => {
    const r = resolveModelForClass('chat', { preferManaged: true });
    expect(r).not.toBeNull();
    expect(r!.managed).toBe(true);
    expect(r!.provider).toBe('openwop-free');
  });

  it('a non-default class still resolves to a real model under an explicit anthropic pin', () => {
    const r = resolveModelForClass('extraction', { provider: 'anthropic' })!;
    expect(r.provider).toBe('anthropic');
    assertReal(r);
  });
});
