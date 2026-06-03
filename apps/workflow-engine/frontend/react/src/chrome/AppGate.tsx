import { FormEvent, useMemo, useState } from 'react';
import { brand } from '../brand/brand.js';
import { SignInButton } from '../auth/SignInButton.js';
import { useAuth } from '../auth/useAuth.js';

const STORAGE_PREFIX = 'openwop.appGate.unlocked';

function storageKey(): string {
  return `${STORAGE_PREFIX}:${brand.productName}:${brand.instanceName}`;
}

function readUnlocked(key: string): boolean {
  try { return localStorage.getItem(key) === '1'; }
  catch { return false; }
}

function persistUnlocked(key: string): void {
  try { localStorage.setItem(key, '1'); }
  catch { /* private mode: unlocked only for this render tree */ }
}

function GateShell(props: {
  title: string;
  lede: string;
  error?: string | null;
  children: React.ReactNode;
}): JSX.Element {
  const { title, lede, error, children } = props;
  return (
    <main className="app-gate" aria-labelledby="app-gate-title">
      <section className="app-gate-panel">
        <div className="app-gate-brand">
          <span className="app-gate-product">{brand.productName}</span>
          <span className="app-gate-instance">{brand.instanceName}</span>
        </div>
        <h1 id="app-gate-title">{title}</h1>
        <p>{lede}</p>
        {error ? <div className="alert error" role="alert">{error}</div> : null}
        {children}
      </section>
    </main>
  );
}

function PasswordGate({ children }: { children: React.ReactNode }): JSX.Element {
  const key = useMemo(storageKey, []);
  const [unlocked, setUnlocked] = useState(() => readUnlocked(key));
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (unlocked) return <>{children}</>;

  const expected = brand.appGate.password;
  const disabled = expected.trim() === '';

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (disabled) {
      setError('This deployment is configured for a password gate, but no password was supplied.');
      return;
    }
    if (value === expected) {
      persistUnlocked(key);
      setUnlocked(true);
      return;
    }
    setError('That password did not match.');
  }

  return (
    <GateShell
      title="Enter password"
      lede="This workspace is private."
      error={error}
    >
      <form className="app-gate-form" onSubmit={submit}>
        <label>
          <span>Password</span>
          <input
            autoComplete="current-password"
            autoFocus
            disabled={disabled}
            onChange={(event) => { setValue(event.currentTarget.value); setError(null); }}
            type="password"
            value={value}
          />
        </label>
        <button className="primary" disabled={disabled || value.length === 0} type="submit">
          Continue
        </button>
      </form>
    </GateShell>
  );
}

function SignInGate({ children }: { children: React.ReactNode }): JSX.Element {
  const { user, loading, isConfigured } = useAuth();
  if (user) return <>{children}</>;
  return (
    <GateShell
      title="Sign in"
      lede={loading ? 'Checking your session.' : 'Sign in to open this workspace.'}
      error={!loading && !isConfigured ? 'This deployment requires sign-in, but Firebase Auth is not configured.' : null}
    >
      <div className="app-gate-actions">
        <SignInButton />
      </div>
    </GateShell>
  );
}

export function AppGate({ children }: { children: React.ReactNode }): JSX.Element {
  switch (brand.appGate.mode) {
    case 'password':
      return <PasswordGate>{children}</PasswordGate>;
    case 'sign-in':
      return <SignInGate>{children}</SignInGate>;
    case 'none':
    default:
      return <>{children}</>;
  }
}
