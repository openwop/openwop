/** Megaphone icon (Lucide Apache-2.0). Marketing role. https://lucide.dev/icons/megaphone */
import type { CSSProperties } from 'react';
interface Props { size?: number; strokeWidth?: number; style?: CSSProperties }
export function MegaphoneIcon({ size = 16, strokeWidth = 2, style }: Props): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden>
      <path d="m3 11 18-5v12L3 14v-3z" /><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </svg>
  );
}
