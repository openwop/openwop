import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ROLE_TEMPLATES, roleThemeForKey } from './roleTemplates.js';
import { IconButton } from '../ui/IconButton.js';
import { XIcon, ArrowRightIcon } from '../ui/icons/index.js';
import { ModalPortal } from '../ui/ModalPortal.js';

/**
 * "Hire an agent" modal (agents-workforce redesign PR 4) — the fast path IN
 * FRONT of the create wizard, never a second creation flow (architect delta).
 *
 * Pick a role template + starting autonomy here; `Continue` hands off to
 * `/agents/new?role=<key>&autonomy=<auto|review>` where the wizard prefills
 * the role, workflows, prompt, and suggested name. The copy promises exactly
 * what templates deliver — there is no AI drafting, and "Custom role" goes to
 * the blank wizard.
 */
export function HireAgentModal({ onClose }: { onClose: () => void }): JSX.Element {
  const navigate = useNavigate();
  const [roleKey, setRoleKey] = useState<string | null>(null);
  const [autonomy, setAutonomy] = useState<'auto' | 'review'>('auto');
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const go = (): void => {
    const params = new URLSearchParams();
    if (roleKey && roleKey !== 'custom') params.set('role', roleKey);
    params.set('autonomy', autonomy);
    onClose();
    navigate(`/agents/new?${params.toString()}`);
  };

  return (
    <ModalPortal>
    <div className="hire-scrim" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="surface-card hire-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Hire an agent"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hire-head">
          <div>
            <div className="hire-eyebrow">New agent</div>
            <h2 className="hire-title">Hire an agent</h2>
            <p className="hire-lede">
              Pick a role and we&rsquo;ll prefill its workflows, instructions, and a suggested name — you finish the details in the wizard.
            </p>
          </div>
          <IconButton label="Close" icon={<XIcon size={16} />} onClick={onClose} />
        </div>

        <div className="hire-label">Role</div>
        <div className="hire-roles">
          {ROLE_TEMPLATES.map((r) => {
            const RoleIcon = roleThemeForKey(r.key).Icon;
            const selected = roleKey === r.key;
            return (
              <button
                key={r.key}
                type="button"
                aria-pressed={selected}
                className={selected ? 'hire-role is-selected' : 'hire-role'}
                onClick={() => setRoleKey(r.key)}
              >
                <span className="hire-role-title"><RoleIcon size={14} aria-hidden /> {r.title}</span>
                <span className="hire-role-blurb">{r.blurb}</span>
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={roleKey === 'custom'}
            className={roleKey === 'custom' ? 'hire-role is-selected' : 'hire-role'}
            onClick={() => setRoleKey('custom')}
          >
            <span className="hire-role-title">Custom role…</span>
            <span className="hire-role-blurb">Start from a blank wizard and define everything yourself.</span>
          </button>
        </div>

        <div className="hire-label">Starting autonomy</div>
        <div className="action-bar">
          {([['review', 'Supervised — propose for review'], ['auto', 'Autonomous — run immediately']] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={autonomy === value ? 'primary btn-sm' : 'secondary btn-sm'}
              aria-pressed={autonomy === value}
              onClick={() => setAutonomy(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="hire-foot action-bar">
          <button type="button" className="secondary btn-sm" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-accent-solid btn-sm" disabled={roleKey === null} onClick={go}>
            Continue <ArrowRightIcon size={14} aria-hidden />
          </button>
        </div>
      </div>
    </div>
    </ModalPortal>
  );
}
