/**
 * Markdown — shared read-only Markdown renderer for agent prose surfaces
 * (persona descriptions, responsibilities, instructions, system prompts,
 * task details). GFM via `remark-gfm`; themed through the `chat-md` prose
 * class in global.css (the same class the chat bubbles use — one source of
 * truth for markdown typography).
 *
 * Security: react-markdown does NOT render raw HTML unless `rehype-raw` is
 * added (it is not), and its `defaultUrlTransform` strips `javascript:` and
 * other unsafe link protocols. So user/agent-authored markdown renders
 * XSS-safe without a separate sanitizer. Links open in a new tab so clicking
 * one from a long-lived workspace doesn't navigate it away; GFM task-list
 * checkboxes render disabled (read-only state, no toggle handler).
 */

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const MD_COMPONENTS: Components = {
  a: ({ href, children, ...rest }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  ),
  input: (props) =>
    props.type === 'checkbox' ? (
      <input {...props} disabled style={{ cursor: 'default' }} />
    ) : (
      <input {...props} />
    ),
};

export function Markdown({
  children,
  className,
  style,
}: {
  children: string;
  className?: string;
  style?: React.CSSProperties;
}): JSX.Element {
  return (
    <div className={className ? `chat-md ${className}` : 'chat-md'} style={{ wordBreak: 'break-word', ...style }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
