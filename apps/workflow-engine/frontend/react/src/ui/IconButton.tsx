import type { ButtonHTMLAttributes, ReactNode } from 'react';

/**
 * Icon-only button that makes the accessible name UNSKIPPABLE (white-label
 * PRD §9: forks repeatedly shipped unlabeled close-X / bell buttons; a plain
 * <button> can't enforce the label, this wrapper's types can).
 *
 * `label` is required and becomes BOTH `aria-label` and (unless overridden)
 * the hover `title`. The icon is presentational (`aria-hidden` wrapper).
 * Styling rides the existing button classes — pass `className` as usual
 * (defaults to the borderless `icon-button` chrome below).
 */
export function IconButton({
  label,
  icon,
  className = 'icon-button',
  title,
  type = 'button',
  ...rest
}: {
  /** The accessible name — what a screen reader announces. Required. */
  label: string;
  icon: ReactNode;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'>): JSX.Element {
  return (
    <button
      type={type}
      aria-label={label}
      title={title ?? label}
      className={className}
      {...rest}
    >
      <span aria-hidden style={{ display: 'inline-flex' }}>{icon}</span>
    </button>
  );
}
