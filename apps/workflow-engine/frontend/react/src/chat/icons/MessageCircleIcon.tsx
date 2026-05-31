/** Message-circle icon (Lucide Apache-2.0). Discord/chat task source. https://lucide.dev/icons/message-circle */
import type { CSSProperties } from 'react';
interface Props { size?: number; strokeWidth?: number; style?: CSSProperties }
export function MessageCircleIcon({ size = 16, strokeWidth = 2, style }: Props): JSX.Element {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style} aria-hidden>
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}
