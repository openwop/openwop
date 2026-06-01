/**
 * X icon (Lucide Apache-2.0). Used for rejection / failure states
 * in the HITL decision + workflow completion cards.
 * Source: https://lucide.dev/icons/x
 */

import type { CSSProperties } from 'react';

interface Props {
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
}

export function XIcon({ size = 16, strokeWidth = 2.5, style }: Props): JSX.Element {
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
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
