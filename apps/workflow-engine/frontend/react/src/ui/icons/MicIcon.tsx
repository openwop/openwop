/**
 * Microphone icon (Lucide Apache-2.0).
 *
 * Inline SVG so we don't pull in a 100+ KB icon-library dep for one
 * icon. Strokes use `currentColor` — set color via the parent button's
 * CSS color and the icon inherits.
 *
 * Source: https://lucide.dev/icons/mic
 */

import type { CSSProperties } from 'react';

interface Props {
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
  /** When true, render the mic-off (slashed) variant. */
  off?: boolean;
}

export function MicIcon({ size = 18, strokeWidth = 2, style, off = false }: Props): JSX.Element {
  if (off) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={style}
        aria-hidden
      >
        <line x1="2" y1="2" x2="22" y2="22" />
        <path d="M18.89 13.23A7.12 7.12 0 0 0 19 12v-2" />
        <path d="M5 10v2a7 7 0 0 0 12 5" />
        <path d="M15 9.34V5a3 3 0 0 0-5.68-1.33" />
        <path d="M9 9v3a3 3 0 0 0 5.12 2.12" />
        <line x1="12" y1="19" x2="12" y2="22" />
      </svg>
    );
  }
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      aria-hidden
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}
