/**
 * 3-step BYOK wizard: provider → model → key.
 *
 * State-machine layout (per MyndHyve BYOKPanel.tsx pattern):
 *   - Initial:    provider grid
 *   - After:      model grid (within provider)
 *   - Then:       API key input (masked + eye toggle + trust alert)
 *   - On success: parent re-renders to the chat / configured view
 *
 * The credentialRef is auto-derived: `byok:{provider}:{timestamp}`.
 * Adopters who want stable refs (e.g., named per-tenant keys) swap
 * `useAutoRef()` for their own naming policy.
 */

import { useEffect, useMemo, useState } from 'react';
import { PROVIDERS, type ProviderConfig, type ProviderModel } from './lib/providers.js';
import { ShieldIcon } from '../chat/icons/index.js';
import { storeKey } from './lib/byokClient.js';
import { useAuth } from '../auth/useAuth.js';
import type { BYOKActiveConfig } from './lib/useBYOKConfig.js';

interface Props {
  onComplete: (cfg: BYOKActiveConfig) => void | Promise<void>;
  /** Optional cancel — present when the wizard is opened from a settings drawer. */
  onCancel?: () => void;
}

const MANAGED_PENDING_KEY = 'openwop.sample.byok.pendingManaged';

/** Sentinel credentialRef for managed providers. The BE recognizes this
 *  prefix and routes through `managedProvider.ts` instead of looking up
 *  a tenant-scoped BYOK row. The value is purely a routing marker —
 *  the real key lives encrypted in `byok_tenant_secrets` under a
 *  synthetic admin tenant. */
function managedCredentialRef(providerId: string): string {
  return `managed:${providerId}`;
}

export function BYOKWizard({ onComplete, onCancel }: Props): JSX.Element {
  const { user, signIn } = useAuth();
  const [step, setStep] = useState<'provider' | 'model' | 'key'>('provider');
  const [provider, setProvider] = useState<ProviderConfig | null>(null);
  const [model, setModel] = useState<ProviderModel | null>(null);

  // After the sign-in redirect returns, auto-activate the managed
  // provider the user clicked pre-sign-in. Without this, the user
  // would land back on the wizard and have to click the tile again.
  useEffect(() => {
    if (!user) return;
    const pendingId = localStorage.getItem(MANAGED_PENDING_KEY);
    if (!pendingId) return;
    localStorage.removeItem(MANAGED_PENDING_KEY);
    const p = PROVIDERS.find((x) => x.id === pendingId && x.managed);
    if (!p) return;
    const m = p.models[0];
    if (!m) return;
    void onComplete({ provider: p.id, model: m.id, credentialRef: managedCredentialRef(p.id) });
  }, [user, onComplete]);

  async function activateManaged(p: ProviderConfig): Promise<void> {
    if (!user) {
      // Stash the picked provider so we can resume after the redirect.
      localStorage.setItem(MANAGED_PENDING_KEY, p.id);
      await signIn.google();
      return;
    }
    const m = p.models[0];
    if (!m) return;
    await onComplete({ provider: p.id, model: m.id, credentialRef: managedCredentialRef(p.id) });
  }

  return (
    <div className="card byok-wizard">
      {/* "Try it free" is the no-key on-ramp — render it ABOVE the
       * BYOK stepper since the stepper's three steps (Provider / Model
       * / API key) don't apply to the managed path. Only visible on
       * the first step; once the user commits to BYOK we hide it to
       * keep the flow focused. */}
      {step === 'provider' && (
        <>
          <TryItFreeCard
            isAuthed={user !== null}
            onPick={(p) => { void activateManaged(p); }}
          />
          <div className="byok-or-divider" role="separator" aria-label="or">OR</div>
        </>
      )}

      <BYOKStepper current={step} />

      {step === 'provider' && (
        <ProviderGrid
          isAuthed={user !== null}
          onPick={(p) => {
            if (p.managed) {
              void activateManaged(p);
              return;
            }
            setProvider(p);
            const rec = p.models.find((m) => m.recommended) ?? p.models[0]!;
            setModel(rec);
            setStep('model');
          }}
          onCancel={onCancel}
        />
      )}

      {step === 'model' && provider && (
        <ModelGrid
          provider={provider}
          selectedModelId={model?.id}
          onPick={(m) => {
            setModel(m);
            setStep('key');
          }}
          onBack={() => setStep('provider')}
        />
      )}

      {step === 'key' && provider && model && (
        <KeyEntry
          provider={provider}
          model={model}
          onBack={() => setStep('model')}
          onStored={async (credentialRef) => {
            await onComplete({ provider: provider.id, model: model.id, credentialRef });
          }}
        />
      )}
    </div>
  );
}

// ── Stepper ────────────────────────────────────────────────────────────

function BYOKStepper({ current }: { current: 'provider' | 'model' | 'key' }): JSX.Element {
  const steps = useMemo(() => [
    { id: 'provider', label: 'Provider' },
    { id: 'model', label: 'Model' },
    { id: 'key', label: 'API key' },
  ] as const, []);
  const currentIdx = steps.findIndex((s) => s.id === current);
  return (
    <ol className="byok-stepper">
      {steps.map((s, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <li key={s.id} className={`byok-stepper-step${active ? ' is-active' : done ? ' is-done' : ''}`}>
            <div className="byok-stepper-bar" />
            <span className="byok-stepper-label">{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ── Step 1: provider grid ──────────────────────────────────────────────

/**
 * The no-key on-ramp. Rendered above the BYOK stepper so newcomers see
 * the easiest path first. Visually styled as a prominent recommended
 * panel — clay-soft tint, "recommended" pill, right-arrow affordance —
 * to distinguish it from the BYOK provider tiles below.
 */
function TryItFreeCard({
  onPick,
  isAuthed,
}: {
  onPick: (p: ProviderConfig) => void;
  isAuthed: boolean;
}): JSX.Element | null {
  const managed = PROVIDERS.filter((p) => p.managed);
  if (managed.length === 0) return null;
  // The reference app ships a single managed provider. If a future fork
  // adds more, this renders them all in a vertical stack.
  return (
    <div className="byok-try-free" style={{ marginBottom: 24 }}>
      {managed.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onPick(p)}
          className="byok-try-free-card"
        >
          <div className="byok-try-free-body">
            <div className="byok-try-free-headline">
              <span className="byok-try-free-title">Try it free</span>
              <span className="byok-try-free-suffix">by creating an account</span>
            </div>
            <div className="byok-try-free-desc">
              No API key needed. Sign in and start chatting — the sample
              server uses a host-managed key with reasonable per-account
              limits.
            </div>
            {!isAuthed && p.signedInHint && (
              <div className="byok-try-free-hint">{p.signedInHint} →</div>
            )}
          </div>
          <span className="byok-try-free-arrow" aria-hidden="true">→</span>
        </button>
      ))}
    </div>
  );
}

function ProviderGrid({
  onPick,
  onCancel,
}: {
  onPick: (p: ProviderConfig) => void;
  onCancel?: () => void;
  isAuthed: boolean;
}): JSX.Element {
  // BYOK-only — the managed "Try it free" path renders above the
  // stepper in BYOKWizard via <TryItFreeCard>.
  const byok = PROVIDERS.filter((p) => !p.managed);

  return (
    <div className="byok-section">
      <h2 className="byok-section-title">Bring your own key (BYOK)</h2>
      <p className="byok-section-lede">
        <abbr title="Bring Your Own Key"><strong>BYOK</strong></abbr> means
        you supply the API key for the model provider you pick below. The
        provider bills you directly for your usage; OpenWOP doesn't bill you
        or take a cut. The sample server forwards each request to the
        provider using your key, then streams the response back.
      </p>
      <p className="byok-section-fineprint">
        Your key is stored on the sample server (sqlite-backed, AES-256-GCM
        encrypted at rest) and sent only to the provider you picked. Set
        <code style={{ margin: '0 4px' }}>OPENWOP_BYOK_EPHEMERAL=true</code> on
        the server to switch to in-memory-only mode that wipes on restart.
        Production hosts swap this storage for a managed key-management
        service (KMS) like AWS KMS, GCP KMS, or HashiCorp Vault — see
        <code style={{ margin: '0 4px' }}>src/byok/secretResolver.ts</code> for
        the adapter pattern.
      </p>
      <div
        className="byok-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.min(byok.length, 3)}, minmax(0, 1fr))`,
          gap: 12,
          marginTop: 16,
        }}
      >
        {byok.map((p) => (
          <div key={p.id} className="byok-tile">
            <button
              type="button"
              className="secondary byok-tile-btn"
              onClick={() => onPick(p)}
            >
              <ProviderBadge provider={p} />
              <div>
                <div className="byok-tile-label">{p.label}</div>
                <div className="byok-tile-desc muted">{p.description}</div>
              </div>
            </button>
            {p.apiKeyConsoleUrl && (
              <a
                className="byok-tile-link"
                href={p.apiKeyConsoleUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Get a {p.label} API key →
              </a>
            )}
          </div>
        ))}
      </div>

      {onCancel && (
        <div className="button-row">
          <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function ProviderBadge({ provider }: { provider: ProviderConfig }): JSX.Element {
  return (
    <span style={{
      width: 36, height: 36, borderRadius: 8,
      background: provider.badgeColor,
      color: 'white',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: 16, flexShrink: 0,
    }}>
      {provider.label.charAt(0)}
    </span>
  );
}

// ── Step 2: model grid ─────────────────────────────────────────────────

function ModelGrid({
  provider,
  selectedModelId,
  onPick,
  onBack,
}: {
  provider: ProviderConfig;
  selectedModelId: string | undefined;
  onPick: (m: ProviderModel) => void;
  onBack: () => void;
}): JSX.Element {
  const [customMode, setCustomMode] = useState(false);
  const [customId, setCustomId] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

  function submitCustom(): void {
    const id = customId.trim();
    if (!id) {
      setCustomError('Model id is required.');
      return;
    }
    // Construct a synthetic ProviderModel. Capabilities + context
    // window + cost are unknown for custom models — we use neutral
    // placeholders and the chat surface tolerates missing usage data.
    onPick({
      id,
      label: id,
      contextWindow: 0,
      capabilities: ['text'],
    });
  }

  return (
    <div>
      <h2 style={{ margin: 0, fontSize: 14 }}>Pick a model</h2>
      <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>From <strong>{provider.label}</strong></p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
        {provider.models.map((m) => (
          <button
            key={m.id}
            type="button"
            className="secondary"
            onClick={() => onPick(m)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4,
              padding: 12, textAlign: 'left',
              borderColor: m.id === selectedModelId ? 'var(--color-accent)' : 'var(--color-border)',
            }}
          >
            <div style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{m.label}</span>
              {m.recommended && <span className="status-badge" style={{ color: 'var(--color-success)' }}>recommended</span>}
              <span style={{ marginLeft: 'auto', fontSize: 11 }} className="muted">{(m.contextWindow / 1000).toFixed(0)}K ctx</span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {m.capabilities.map((c) => (
                <span key={c} className="status-badge" style={{ fontSize: 10 }}>{c}</span>
              ))}
              {m.cost && (
                <span className="status-badge muted" style={{ fontSize: 10 }}>
                  ${m.cost.input * 1000}/1M in · ${m.cost.output * 1000}/1M out
                </span>
              )}
            </div>
          </button>
        ))}

        {/* "Other" — escape hatch for models not in the curated list
            (preview releases, fine-tunes, snapshots, future versions
            we haven't bumped the taxonomy for). */}
        {!customMode ? (
          <button
            type="button"
            className="secondary"
            onClick={() => setCustomMode(true)}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4,
              padding: 12, textAlign: 'left',
              borderColor: 'var(--color-border)',
              borderStyle: 'dashed',
            }}
          >
            <div style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Other…</span>
              <span style={{ marginLeft: 'auto', fontSize: 11 }} className="muted">enter model id manually</span>
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
              For preview releases, fine-tunes, snapshots, or any model not in the list above.
            </div>
          </button>
        ) : (
          <div
            className="card"
            style={{
              margin: 0,
              padding: 12,
              borderStyle: 'dashed',
              background: 'var(--color-surface-2)',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Custom model</div>
            <div className="form-row">
              <label>Model id (as the provider expects it)</label>
              <input
                value={customId}
                onChange={(e) => { setCustomId(e.target.value); setCustomError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitCustom(); } }}
                placeholder={provider.customModelPlaceholder ?? 'provider-model-id'}
                autoFocus
                spellCheck={false}
              />
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                {provider.customModelHelp ?? `Whatever model id ${provider.label}'s API accepts.`}
              </div>
            </div>
            {customError && <div className="alert error" style={{ fontSize: 12 }}>{customError}</div>}
            <div className="button-row">
              <button type="button" onClick={submitCustom} disabled={!customId.trim()}>Use this model</button>
              <button type="button" className="secondary" onClick={() => { setCustomMode(false); setCustomId(''); setCustomError(null); }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="button-row">
        <button type="button" className="secondary" onClick={onBack}>Back</button>
      </div>
    </div>
  );
}

// ── Step 3: key entry ──────────────────────────────────────────────────

function KeyEntry({
  provider,
  model,
  onBack,
  onStored,
}: {
  provider: ProviderConfig;
  model: ProviderModel;
  onBack: () => void;
  onStored: (credentialRef: string) => void | Promise<void>;
}): JSX.Element {
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Soft validation: warn (not block) if the key doesn't match the
  // provider's expected prefix.
  const prefixWarning = provider.apiKeyPrefix && key.length > 0 && !key.startsWith(provider.apiKeyPrefix)
    ? `Anthropic keys usually start with "${provider.apiKeyPrefix}". Continuing anyway.`
    : null;

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!key.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const credentialRef = `byok:${provider.id}:${Date.now()}`;
      await storeKey(credentialRef, key);
      // Clear the input field immediately — never leave plaintext in React state.
      setKey('');
      await onStored(credentialRef);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <h2 style={{ margin: 0, fontSize: 14 }}>Add your {provider.label} API key</h2>
      <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
        Using <strong>{model.label}</strong>.{' '}
        <a href={provider.apiKeyConsoleUrl} target="_blank" rel="noopener noreferrer">Get a key →</a>
      </p>

      <div className="alert info" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <ShieldIcon size={16} style={{ flexShrink: 0, marginTop: 1, color: 'var(--color-accent)' }} />
        <span style={{ fontSize: 12 }}>
          {provider.apiKeyHelpText} You pay {provider.label} directly for usage.
        </span>
      </div>

      <div className="form-row" style={{ marginTop: 12 }}>
        <label>API key</label>
        <div style={{ display: 'flex', gap: 4 }}>
          <input
            type={show ? 'text' : 'password'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={provider.apiKeyPlaceholder}
            autoComplete="off"
            spellCheck={false}
            aria-label={`${provider.label} API key`}
          />
          <button
            type="button"
            className="secondary"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide key' : 'Show key'}
            style={{ minWidth: 56 }}
          >
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
        {prefixWarning && <div className="muted" style={{ marginTop: 4, fontSize: 11 }}>{prefixWarning}</div>}
      </div>

      {error && <div className="alert error" style={{ fontSize: 12 }}>{error}</div>}

      <div className="button-row">
        <button type="submit" disabled={submitting || !key.trim()}>
          {submitting ? 'Storing…' : 'Store key'}
        </button>
        <button type="button" className="secondary" onClick={onBack} disabled={submitting}>Back</button>
      </div>
    </form>
  );
}
