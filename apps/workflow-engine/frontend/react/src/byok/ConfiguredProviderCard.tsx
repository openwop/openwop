/**
 * Compact "active config" card — shown in the chat header + as the
 * collapsed BYOK state. Borrowed from MyndHyve's ConfiguredProviderCard
 * pattern: provider badge + name + masked key + delete/refresh icons.
 */

import { useState } from 'react';
import { getProvider } from './lib/providers.js';
import type { BYOKActiveConfig } from './lib/useBYOKConfig.js';
import { deleteKey } from './lib/byokClient.js';

interface Props {
  config: BYOKActiveConfig;
  onChange: () => void;
  onRemoved: () => void | Promise<void>;
  compact?: boolean;
}

export function ConfiguredProviderCard({ config, onChange, onRemoved, compact }: Props): JSX.Element {
  const provider = getProvider(config.provider);
  const model = provider.models.find((m) => m.id === config.model);
  const [removing, setRemoving] = useState(false);
  const isManaged = provider.managed === true;

  async function onDelete(): Promise<void> {
    // Managed providers don't have a user-owned key to delete — the
    // "remove" action just clears the active config (server-held key
    // stays put).
    if (!isManaged && !confirm(`Delete BYOK key for ${provider.label}?`)) return;
    setRemoving(true);
    try {
      if (!isManaged) {
        await deleteKey(config.credentialRef);
      }
      await onRemoved();
    } finally {
      setRemoving(false);
    }
  }

  const badge = (
    <span style={{
      width: compact ? 20 : 32, height: compact ? 20 : 32, borderRadius: compact ? 4 : 6,
      background: provider.badgeColor, color: 'white',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: compact ? 11 : 14, flexShrink: 0,
    }} aria-hidden>
      {provider.label.charAt(0)}
    </span>
  );

  if (compact) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '4px 8px', borderRadius: 16, border: '1px solid var(--color-border)',
        background: 'var(--color-surface)', fontSize: 11,
      }}>
        {badge}
        <span>
          <strong>{provider.label}</strong>
          {!isManaged && model && <> · {model.label ?? config.model}</>}
        </span>
        <button
          type="button"
          className="secondary"
          onClick={onChange}
          style={{ padding: '0 6px', fontSize: 10, minHeight: 0 }}
          aria-label="Change provider / model"
        >change</button>
      </span>
    );
  }

  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {badge}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{provider.label}</div>
        <div className="muted" style={{ fontSize: 11 }}>
          {isManaged
            ? 'Server-managed · daily usage limit applies'
            : <>{model?.label ?? config.model} · key <code>{config.credentialRef}</code></>}
        </div>
      </div>
      <div className="button-row" style={{ margin: 0 }}>
        <button type="button" className="secondary" onClick={onChange} aria-label="Change">Change</button>
        <button type="button" className="secondary" disabled={removing} onClick={onDelete} aria-label={isManaged ? 'Disconnect' : 'Delete key'}>
          {removing ? '…' : (isManaged ? 'Disconnect' : 'Delete')}
        </button>
      </div>
    </div>
  );
}
