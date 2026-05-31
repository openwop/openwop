/** Zap / lightning icon (Lucide Apache-2.0). Trigger columns. https://lucide.dev/icons/zap */
import type { CSSProperties } from 'react';
interface Props { size?: number; strokeWidth?: number; style?: CSSProperties }
export function ZapIcon({ size = 16, strokeWidth = 2, style }: Props): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}
