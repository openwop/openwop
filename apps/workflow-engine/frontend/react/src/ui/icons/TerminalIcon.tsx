/**
 * Terminal icon (Lucide Apache-2.0). Prompt caret — the CLI nav item.
 * Source: https://lucide.dev/icons/terminal
 */

import type { CSSProperties } from 'react';

interface Props {
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
}

export function TerminalIcon({ size = 14, strokeWidth = 2, style }: Props): JSX.Element {
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
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" x2="20" y1="19" y2="19" />
    </svg>
  );
}
