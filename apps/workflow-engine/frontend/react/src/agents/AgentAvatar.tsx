/**
 * Agent avatar — the one place that renders a coworker's circular avatar:
 * the uploaded profile photo when set, else the persona initials, always with
 * the role-glyph badge overlay. Shared by the `/agents` list cards
 * (`AgentCard.tsx`, display-only) and the individual agent dashboard header
 * (`AgentWorkspacePage.tsx`, where `onEdit` turns the circle into the
 * profile-photo edit affordance).
 */

import { useState } from 'react';
import type { RoleTheme } from './roleTemplates.js';
import { ImageIcon } from '../ui/icons/index.js';

/** Initials for the avatar. Falls back to the first two chars of the name.
 *  Single source of truth — both call sites import it from here. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || name.slice(0, 2).toUpperCase();
}

export function AgentAvatar({
  persona,
  avatarUrl,
  roleTheme,
  size,
  onEdit,
  alt,
  showBadge = true,
  ring,
}: {
  persona: string;
  avatarUrl?: string;
  roleTheme: RoleTheme;
  /** Diameter of the main circle, px. */
  size: number;
  /** When provided the avatar becomes a focusable button that opens the
   *  profile-photo editor; a camera badge + hover/focus scrim signal it. */
  onEdit?: () => void;
  /** Accessible name for the photo. Omitted → decorative (alt=""), correct
   *  where the persona name is adjacent text (list cards, header). Pass a
   *  meaningful alt where the avatar stands more on its own (activity rows). */
  alt?: string;
  /** Show the role-glyph badge overlay. Off for tiny inline avatars where the
   *  badge would crowd the circle. */
  showBadge?: boolean;
  /** Status-ring color (a CSS color/token value). Renders a 2px ring offset
   *  from the circle — the roster's at-a-glance status cue. */
  ring?: string;
}): JSX.Element {
  const RoleIcon = roleTheme.Icon;
  const [active, setActive] = useState(false); // hover OR keyboard focus

  // Badge geometry scales with the circle so it reads consistently at 40 / 48.
  const badge = Math.round(size * 0.42);
  const badgeIcon = Math.max(11, Math.round(size * 0.26));

  const circle = (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: 'var(--color-accent)',
        color: 'var(--paper)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: size <= 28 ? '0.7rem' : size <= 40 ? '0.95rem' : '1.1rem',
        overflow: 'hidden',
        ...(ring ? { boxShadow: `0 0 0 2px var(--paper), 0 0 0 4px ${ring}` } : {}),
      }}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt={alt ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : (
        initials(persona)
      )}
    </div>
  );

  return (
    <div style={{ position: 'relative', flexShrink: 0, width: size, height: size }} aria-hidden={onEdit ? undefined : true}>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          onMouseEnter={() => setActive(true)}
          onMouseLeave={() => setActive(false)}
          onFocus={() => setActive(true)}
          onBlur={() => setActive(false)}
          title="Edit profile photo"
          aria-label={`Edit ${persona}'s profile photo`}
          style={{
            all: 'unset',
            cursor: 'pointer',
            display: 'block',
            borderRadius: '50%',
            position: 'relative',
            outline: active ? '2px solid var(--color-accent)' : 'none',
            outlineOffset: 2,
          }}
        >
          {circle}
          {/* Hover/focus scrim with a camera glyph — the "change photo" cue. */}
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: 0,
              borderRadius: '50%',
              background: 'var(--scrim-soft)',
              color: 'var(--color-on-scrim)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: active ? 1 : 0,
              transition: 'opacity 120ms ease',
            }}
          >
            <ImageIcon size={Math.round(size * 0.4)} />
          </span>
        </button>
      ) : (
        circle
      )}

      {/* Role glyph badge — the at-a-glance differentiator between coworkers. */}
      {showBadge ? (
        <div
          aria-hidden="true"
          title={`${roleTheme.label} role`}
          style={{
            position: 'absolute',
            right: -3,
            bottom: -3,
            width: badge,
            height: badge,
            borderRadius: '50%',
            background: 'var(--paper)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <RoleIcon size={badgeIcon} strokeWidth={2} />
        </div>
      ) : null}
    </div>
  );
}
