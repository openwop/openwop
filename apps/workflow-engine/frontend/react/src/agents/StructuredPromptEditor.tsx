/**
 * StructuredPromptEditor — a guided editor for an agent's system prompt /
 * instructions, organized into the canonical sections a good agent brief wants
 * (Role · Responsibilities · Voice · Tools · Escalation Rules · Guardrails ·
 * Examples). Each section is a compact Markdown field; the editor composes them
 * into ONE Markdown document (`## Role` … `## Examples`) which is the value the
 * host stores — so there's no new wire shape, just a nicer way to write the
 * same string.
 *
 * A "Raw Markdown" toggle drops to a single editor over the whole document for
 * power users (and for prompts authored elsewhere that don't follow the section
 * convention — those open in raw mode so nothing is silently restructured).
 */

import { useMemo, useState } from 'react';
import { MarkdownEditor } from '../ui/MarkdownEditor.js';

const muted: React.CSSProperties = { color: 'var(--color-text-muted)' };

interface SectionDef { heading: string; hint: string }

const SECTIONS: readonly SectionDef[] = [
  { heading: 'Role', hint: 'One line — who this agent is and the job it owns.' },
  { heading: 'Responsibilities', hint: 'What it should do — the tasks it owns.' },
  { heading: 'Voice', hint: 'Tone and style when it writes or replies.' },
  { heading: 'Tools', hint: 'Which tools / integrations it may use.' },
  { heading: 'Escalation Rules', hint: 'When to pause and hand off to a human.' },
  { heading: 'Guardrails', hint: 'What it must NOT do.' },
  { heading: 'Examples', hint: 'Sample situations → the ideal response.' },
];

const HEADINGS = SECTIONS.map((s) => s.heading);

interface Parsed { preamble: string; bodies: Record<string, string>; structured: boolean }

/** Split a system prompt into the known `## Section` bodies. Text before the
 *  first recognized heading is kept as `preamble`. `structured` is true when at
 *  least one known heading was found (used to choose the initial mode). */
function parsePrompt(value: string): Parsed {
  const bodies: Record<string, string> = {};
  const acc: Record<string, string[]> = {};
  HEADINGS.forEach((h) => { bodies[h] = ''; acc[h] = []; });
  const preamble: string[] = [];
  let current: string | null = null;
  let structured = false;
  for (const line of value.split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      const name = HEADINGS.find((h) => h.toLowerCase() === m[1]!.toLowerCase());
      if (name) { current = name; structured = true; continue; }
    }
    if (current) acc[current]!.push(line);
    else preamble.push(line);
  }
  HEADINGS.forEach((h) => { bodies[h] = acc[h]!.join('\n').trim(); });
  return { preamble: preamble.join('\n').trim(), bodies, structured };
}

function composePrompt(preamble: string, bodies: Record<string, string>): string {
  const parts: string[] = [];
  if (preamble.trim()) parts.push(preamble.trim());
  for (const h of HEADINGS) {
    const body = bodies[h]?.trim();
    if (body) parts.push(`## ${h}\n\n${body}`);
  }
  return parts.join('\n\n');
}

export function StructuredPromptEditor({
  value,
  onChange,
  autosaveKey,
}: {
  value: string;
  onChange: (value: string) => void;
  autosaveKey?: string;
}): JSX.Element {
  // Parse once on mount — the parent re-seeds by remounting (key), not by
  // pushing a new `value` mid-edit, so we never re-parse over live edits.
  const initial = useMemo(() => parsePrompt(value), [value]);
  const [mode, setMode] = useState<'guided' | 'raw'>(
    initial.structured || !value.trim() ? 'guided' : 'raw',
  );
  const [bodies, setBodies] = useState<Record<string, string>>(initial.bodies);
  const [preamble, setPreamble] = useState(initial.preamble);
  const [text, setText] = useState(value);

  const emit = (t: string) => { setText(t); onChange(t); };

  const setSection = (heading: string, body: string) => {
    const next = { ...bodies, [heading]: body };
    setBodies(next);
    emit(composePrompt(preamble, next));
  };

  const setPreambleBody = (body: string) => {
    setPreamble(body);
    emit(composePrompt(body, bodies));
  };

  const switchToGuided = () => {
    const p = parsePrompt(text);
    setBodies(p.bodies);
    setPreamble(p.preamble);
    setMode('guided');
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
        <span style={{ ...muted, fontSize: '0.78rem' }}>
          {mode === 'guided'
            ? 'Fill the sections that apply — empty ones are omitted.'
            : 'Editing the full prompt as Markdown.'}
        </span>
        <div style={{ display: 'inline-flex', gap: 'var(--space-1)' }}>
          <button
            type="button"
            className={mode === 'guided' ? 'primary btn-sm' : 'secondary btn-sm'}
            aria-pressed={mode === 'guided'}
            onClick={switchToGuided}
          >
            Guided sections
          </button>
          <button
            type="button"
            className={mode === 'raw' ? 'primary btn-sm' : 'secondary btn-sm'}
            aria-pressed={mode === 'raw'}
            onClick={() => setMode('raw')}
          >
            Raw Markdown
          </button>
        </div>
      </div>

      {mode === 'raw' ? (
        <MarkdownEditor
          value={text}
          onChange={emit}
          rows={12}
          monospace
          autosaveKey={autosaveKey}
          placeholder={'## Role\n\nYou are …\n\n## Responsibilities\n\n- …'}
          ariaLabel="System prompt (Markdown)"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {preamble.trim() ? (
            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>Intro</div>
              <p style={{ ...muted, fontSize: '0.74rem', margin: '0 0 4px' }}>Text before the sections.</p>
              <MarkdownEditor value={preamble} onChange={setPreambleBody} rows={3} compact ariaLabel="Intro" />
            </div>
          ) : null}
          {SECTIONS.map((s) => (
            <div key={s.heading}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>{s.heading}</div>
              <p style={{ ...muted, fontSize: '0.74rem', margin: '0 0 4px' }}>{s.hint}</p>
              <MarkdownEditor
                value={bodies[s.heading] ?? ''}
                onChange={(v) => setSection(s.heading, v)}
                rows={3}
                compact
                ariaLabel={s.heading}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
