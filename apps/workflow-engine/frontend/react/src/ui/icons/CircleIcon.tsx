/** Circle icon (Lucide Apache-2.0). Status dots — `filled` for ● vs ○. https://lucide.dev/icons/circle */
import type { CSSProperties } from 'react';
interface Props { size?: number; strokeWidth?: number; style?: CSSProperties; filled?: boolean }
export function CircleIcon({ size = 16, strokeWidth = 2, style, filled }: Props): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden>
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}
