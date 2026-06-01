/** Pencil icon (Lucide Apache-2.0). https://lucide.dev */
import type { CSSProperties } from 'react';
interface Props { size?: number; strokeWidth?: number; style?: CSSProperties }
export function PencilIcon({ size = 16, strokeWidth = 2, style }: Props): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" />
    </svg>
  );
}
