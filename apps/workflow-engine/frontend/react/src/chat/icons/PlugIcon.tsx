/** Plug icon (Lucide Apache-2.0). API task source. https://lucide.dev/icons/plug */
import type { CSSProperties } from 'react';
interface Props { size?: number; strokeWidth?: number; style?: CSSProperties }
export function PlugIcon({ size = 16, strokeWidth = 2, style }: Props): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden>
      <path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" /><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
    </svg>
  );
}
