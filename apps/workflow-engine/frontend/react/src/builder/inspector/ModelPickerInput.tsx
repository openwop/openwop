/**
 * Per-node model picker. Sourced from the provider's `models[]` array
 * in providers.json. Disabled with a clear placeholder when no provider
 * is selected (the dependency via dependsOn → sibling provider field).
 */

import { PROVIDERS } from '../../byok/lib/providers.js';

interface Props {
  value: string | undefined;
  onChange(next: string | undefined): void;
  /** Provider id resolved via dependsOn from the sibling provider field.
   *  Undefined when the sibling hasn't been set yet — UI shows a
   *  placeholder + disables the select. */
  providerId: string | undefined;
  required?: boolean;
}

export function ModelPickerInput({ value, onChange, providerId, required }: Props): JSX.Element {
  if (!providerId) {
    return (
      <select disabled>
        <option>Pick a provider first…</option>
      </select>
    );
  }
  const provider = PROVIDERS.find((p) => p.id === providerId);
  const models = provider?.models ?? [];
  if (models.length === 0) {
    return (
      <select disabled>
        <option>No models declared for {providerId}</option>
      </select>
    );
  }
  return (
    <select
      value={value ?? ''}
      required={required}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">{required ? 'Pick a model…' : '(use provider default)'}</option>
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}{m.recommended ? ' (recommended)' : ''}
        </option>
      ))}
    </select>
  );
}
