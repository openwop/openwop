/**
 * Notification preferences subdrawer — opens inside the
 * `NotificationPanel` when the user clicks the gear icon.
 *
 * Sections:
 *   1. Global mute — kill switch for every notification toast + badge
 *   2. Per-type — table of known types with mute + desktop toggles
 *   3. Quiet hours — start/end time + days + allow-urgent toggle
 *
 * Persistence: every mutation calls `store.updatePreferences()` which
 * writes to localStorage immediately. No "Save" button — changes are
 * live as you toggle them, mirroring the rest of the chat surface's
 * inline-edit pattern.
 */

import { useNotificationStore } from './notificationStore.js';
import { KNOWN_TYPES, TYPE_LABELS, type NotificationPreferences } from './types.js';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function NotificationPreferencesPanel(): JSX.Element {
  const prefs = useNotificationStore((s) => s.preferences);
  const updatePreferences = useNotificationStore((s) => s.updatePreferences);
  const closePreferences = useNotificationStore((s) => s.closePreferences);

  const setGlobalMute = (globalMute: boolean): void =>
    updatePreferences({ ...prefs, globalMute });

  const setTypePref = (type: string, patch: { muted?: boolean; desktop?: boolean }): void => {
    const types = prefs.types.map((t) =>
      t.type === type
        ? {
            ...t,
            ...(patch.muted !== undefined ? { muted: patch.muted } : {}),
            ...(patch.desktop !== undefined ? { desktop: patch.desktop } : {}),
          }
        : t,
    );
    updatePreferences({ ...prefs, types });
  };

  const setQuietHours = (patch: Partial<NotificationPreferences['quietHours']>): void =>
    updatePreferences({ ...prefs, quietHours: { ...prefs.quietHours, ...patch } });

  const toggleDay = (day: number): void => {
    const next = prefs.quietHours.days.includes(day)
      ? prefs.quietHours.days.filter((d) => d !== day)
      : [...prefs.quietHours.days, day].sort((a, b) => a - b);
    setQuietHours({ days: next });
  };

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <button
          type="button"
          className="secondary"
          onClick={closePreferences}
          aria-label="Back to notifications"
          style={{ fontSize: 12 }}
        >
          ← Back
        </button>
        <h3 style={{ margin: 0, fontSize: 14 }}>Preferences</h3>
      </header>

      {/* Global mute */}
      <Section title="Global">
        <Row>
          <Label htmlFor="prefs-globalMute">Mute all notifications</Label>
          <input
            id="prefs-globalMute"
            type="checkbox"
            checked={prefs.globalMute}
            onChange={(e) => setGlobalMute(e.target.checked)}
          />
        </Row>
        <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
          Suppresses the bell badge + every desktop toast. Notifications still
          arrive and appear in the panel so you can clear them later.
        </p>
      </Section>

      {/* Per-type */}
      <Section title="Types">
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: '4px 0', fontWeight: 600 }}>Type</th>
              <th style={{ padding: '4px 0', fontWeight: 600, width: 60, textAlign: 'center' }}>Mute</th>
              <th style={{ padding: '4px 0', fontWeight: 600, width: 70, textAlign: 'center' }}>Desktop</th>
            </tr>
          </thead>
          <tbody>
            {KNOWN_TYPES.map((type) => {
              const t = prefs.types.find((x) => x.type === type);
              const muted = t?.muted ?? false;
              const desktop = t?.desktop ?? true;
              return (
                <tr key={type} style={{ borderTop: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '6px 0' }}>{TYPE_LABELS[type] ?? type}</td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={muted}
                      onChange={(e) => setTypePref(type, { muted: e.target.checked })}
                      aria-label={`Mute ${TYPE_LABELS[type] ?? type}`}
                    />
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={desktop}
                      onChange={(e) => setTypePref(type, { desktop: e.target.checked })}
                      aria-label={`Desktop toast for ${TYPE_LABELS[type] ?? type}`}
                      disabled={muted}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 11, margin: '8px 0 0' }}>
          <strong>Mute</strong> hides the row from the badge count (still appears in the panel).{' '}
          <strong>Desktop</strong> controls the OS-level toast (no effect when mute is on or
          permission isn't granted).
        </p>
      </Section>

      {/* Quiet hours */}
      <Section title="Quiet hours">
        <Row>
          <Label htmlFor="prefs-quiet-enabled">Enable quiet hours</Label>
          <input
            id="prefs-quiet-enabled"
            type="checkbox"
            checked={prefs.quietHours.enabled}
            onChange={(e) => setQuietHours({ enabled: e.target.checked })}
          />
        </Row>

        <div style={{ display: 'flex', gap: 12, marginTop: 8, opacity: prefs.quietHours.enabled ? 1 : 0.4 }}>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
            Start
            <input
              type="time"
              value={prefs.quietHours.start}
              onChange={(e) => setQuietHours({ start: e.target.value })}
              disabled={!prefs.quietHours.enabled}
              style={{ fontSize: 13 }}
            />
          </label>
          <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11 }}>
            End
            <input
              type="time"
              value={prefs.quietHours.end}
              onChange={(e) => setQuietHours({ end: e.target.value })}
              disabled={!prefs.quietHours.enabled}
              style={{ fontSize: 13 }}
            />
          </label>
        </div>

        <div style={{ marginTop: 8 }}>
          <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>Days</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {DAY_LABELS.map((label, day) => {
              const active = prefs.quietHours.days.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  disabled={!prefs.quietHours.enabled}
                  aria-pressed={active}
                  style={{
                    fontSize: 11,
                    padding: '4px 8px',
                    border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    borderRadius: 6,
                    background: active ? 'color-mix(in oklch, var(--color-accent) 12%, transparent)' : 'transparent',
                    color: active ? 'var(--color-accent)' : 'var(--color-text)',
                    cursor: prefs.quietHours.enabled ? 'pointer' : 'not-allowed',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <Row style={{ marginTop: 8, opacity: prefs.quietHours.enabled ? 1 : 0.4 }}>
          <Label htmlFor="prefs-quiet-allowUrgent">Allow urgent during quiet hours</Label>
          <input
            id="prefs-quiet-allowUrgent"
            type="checkbox"
            checked={prefs.quietHours.allowUrgent}
            onChange={(e) => setQuietHours({ allowUrgent: e.target.checked })}
            disabled={!prefs.quietHours.enabled}
          />
        </Row>
        <p className="muted" style={{ fontSize: 11, margin: '4px 0 0' }}>
          Crosses midnight when end &lt; start (e.g., 22:00 → 08:00). During the window,
          desktop toasts are suppressed unless the row's priority is <code>urgent</code> and
          this toggle is on.
        </p>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <section style={{ marginBottom: 18 }}>
      <h4 style={{ margin: '0 0 6px', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-muted)' }}>
        {title}
      </h4>
      {children}
    </section>
  );
}

function Row({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }): JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...style }}>
      {children}
    </div>
  );
}

function Label({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }): JSX.Element {
  return (
    <label htmlFor={htmlFor} style={{ flex: 1, fontSize: 13, cursor: 'pointer' }}>
      {children}
    </label>
  );
}
