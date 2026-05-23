/**
 * Per-node provider picker. Lists every BYOK-pickable provider from
 * providers.json (excludes `managed` and `hidden`). Selection drives
 * the sibling `model-picker` + `credential-picker` via dependsOn.
 *
 * The hidden MiniMax entry is intentionally excluded — users wanting
 * MiniMax in their workflow nodes should go through the BYOK path
 * with their own MiniMax key (which surfaces as a regular provider
 * once added). The Try-it-free managed path is a chat-tab-only
 * convenience, not a builder primitive.
 */

import { PROVIDERS } from '../../byok/lib/providers.js';

interface Props {
  value: string | undefined;
  onChange(next: string | undefined): void;
  required?: boolean;
}

export function ProviderPickerInput({ value, onChange, required }: Props): JSX.Element {
  const visible = PROVIDERS.filter((p) => !p.managed && !p.hidden);
  return (
    <select
      value={value ?? ''}
      required={required}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">{required ? 'Pick a provider…' : '(none)'}</option>
      {visible.map((p) => (
        <option key={p.id} value={p.id}>{p.label}</option>
      ))}
    </select>
  );
}
