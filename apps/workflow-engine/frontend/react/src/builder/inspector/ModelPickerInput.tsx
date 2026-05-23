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
  // Whether the current value is a declared model. When false but
  // non-empty, the user picked "Other…" earlier and is on a custom
  // model id (fine-tune, beta release, snapshot). Surface a text
  // input alongside the dropdown in that mode.
  const declared = value ? models.some((m) => m.id === value) : true;
  const customMode = value !== undefined && !declared;

  if (customMode) {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value || undefined)}
          placeholder="custom model id"
          style={{ flex: 1 }}
        />
        <button
          type="button"
          className="secondary"
          style={{ fontSize: 11, padding: '3px 9px' }}
          onClick={() => onChange(undefined)}
          title="Switch back to the declared-model dropdown"
        >
          ← list
        </button>
      </div>
    );
  }

  return (
    <select
      value={value ?? ''}
      required={required}
      onChange={(e) => {
        const next = e.target.value;
        if (next === '__custom__') {
          // Sentinel — flip to custom-mode by writing an empty-but-
          // defined string that the `declared` check will treat as
          // "custom mode active." The user then types the id.
          onChange('');
          return;
        }
        onChange(next || undefined);
      }}
    >
      <option value="">{required ? 'Pick a model…' : '(use run-time inputs)'}</option>
      {models.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}{m.recommended ? ' (recommended)' : ''}
        </option>
      ))}
      <option value="__custom__">Other… (fine-tune / snapshot / beta)</option>
    </select>
  );
}
