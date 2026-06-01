/**
 * Alert / triangle icon (Lucide Apache-2.0). Used for workflow
 * failure states in the completion card.
 * Source: https://lucide.dev/icons/triangle-alert
 */

import type { CSSProperties } from 'react';

interface Props {
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
}

export function AlertIcon({ size = 16, strokeWidth = 2, style }: Props): JSX.Element {
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
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}
