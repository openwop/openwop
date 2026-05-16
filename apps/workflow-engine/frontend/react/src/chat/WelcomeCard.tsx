/**
 * Empty-state welcome card with 4 suggested prompts. Borrowed shape from
 * MyndHyve's ChatWelcomeCard.tsx — centered icon + title + 2×2 grid.
 */

interface Props {
  onPickSuggestion: (text: string) => void;
}

const SUGGESTIONS: readonly { title: string; prompt: string }[] = [
  {
    title: 'What is OpenWOP?',
    prompt: 'In three sentences, explain what OpenWOP is and why it exists.',
  },
  {
    title: 'Tour this sample',
    prompt: 'Walk me through what this sample backend exposes — discovery, run lifecycle, interrupts, BYOK.',
  },
  {
    title: 'Streaming vs polling',
    prompt: 'Explain the difference between SSE streaming and polling for openwop run events. When do I use which?',
  },
  {
    title: 'Add a new node pack',
    prompt: 'How would I add a new node pack to this sample? What goes in pack.json?',
  },
];

export function WelcomeCard({ onPickSuggestion }: Props): JSX.Element {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: 48, textAlign: 'center', minHeight: 320,
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: '50%',
        background: 'var(--color-surface-2)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 16, fontSize: 24,
      }} aria-hidden>
        🤖
      </div>
      <h2 style={{ margin: 0, fontSize: 18 }}>How can I help?</h2>
      <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>
        Ask anything — the response is streamed from your configured provider via an OpenWOP run.
      </p>
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
        maxWidth: 600, width: '100%', marginTop: 24,
      }}>
        {SUGGESTIONS.map((s) => (
          <button
            key={s.title}
            type="button"
            className="secondary"
            onClick={() => onPickSuggestion(s.prompt)}
            style={{
              padding: 12, textAlign: 'left', flexDirection: 'column', alignItems: 'flex-start',
              gap: 4, border: '1px solid var(--color-border)',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 13 }}>{s.title}</span>
            <span className="muted" style={{ fontSize: 11 }}>{s.prompt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
