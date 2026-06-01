/**
 * Per-node model picker. Sourced from the provider's `models[]` array
 * in providers.json. Disabled with a clear placeholder when no provider
 * is selected (the dependency via dependsOn → sibling provider field).
 */

import { PROVIDERS } from '../../byok/lib/providers.js';
import { ArrowLeftIcon, ImageIcon, WrenchIcon } from '../../chat/icons/index.js';

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
          <ArrowLeftIcon size={12} /> list
        </button>
      </div>
    );
  }

  const selectedModel = value ? models.find((m) => m.id === value) : undefined;

  return (
    <>
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
      {selectedModel && <ModelCapabilityBadges capabilities={selectedModel.capabilities} />}
    </>
  );
}

const CAP_BADGE: Record<string, { glyph: React.ReactNode; label: string }> = {
  // RFC 0055 §A — surface what the chosen model can do (esp. vision) so the
  // user knows before relying on it. `text` is universal, so it's omitted.
  vision: { glyph: <ImageIcon size={12} />, label: 'Vision' },
  tools: { glyph: <WrenchIcon size={12} />, label: 'Tools' },
  structured: { glyph: '⌗', label: 'Structured' },
};

function ModelCapabilityBadges({ capabilities }: { capabilities: readonly string[] }): JSX.Element | null {
  const shown = capabilities.filter((c) => c in CAP_BADGE);
  if (shown.length === 0) return null;
  return (
    <div className="model-cap-badges" role="list" aria-label="Model capabilities">
      {shown.map((c) => (
        <span key={c} className="model-cap-pill" role="listitem" title={`This model supports ${CAP_BADGE[c]!.label.toLowerCase()}`}>
          <span aria-hidden="true">{CAP_BADGE[c]!.glyph}</span> {CAP_BADGE[c]!.label}
        </span>
      ))}
    </div>
  );
}
