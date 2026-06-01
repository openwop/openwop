/**
 * Stop icon — filled rounded square (Lucide Apache-2.0 'square' adapted
 * to filled). Used during streaming as the Send-button replacement.
 * Source: https://lucide.dev/icons/square
 */

import type { CSSProperties } from 'react';

interface Props {
  size?: number;
  style?: CSSProperties;
}

export function StopIcon({ size = 12, style }: Props): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      style={style}
      aria-hidden
    >
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}
