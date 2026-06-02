/**
 * Moon icon (Lucide Apache-2.0). Dark-theme option in the theme toggle.
 * Source: https://lucide.dev/icons/moon
 */

import type { CSSProperties } from 'react';

interface Props {
  size?: number;
  strokeWidth?: number;
  style?: CSSProperties;
}

export function MoonIcon({ size = 14, strokeWidth = 2, style }: Props): JSX.Element {
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
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}
