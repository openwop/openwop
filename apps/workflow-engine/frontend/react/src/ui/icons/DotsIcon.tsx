/**
 * Dots (horizontal ellipsis) icon (Lucide Apache-2.0). Overflow menus —
 * the board-actions trigger. Source: https://lucide.dev/icons/more-horizontal
 */

import type { CSSProperties } from 'react';

interface Props {
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
}

export function DotsIcon({ size = 14, strokeWidth = 2, style }: Props): JSX.Element {
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
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}
