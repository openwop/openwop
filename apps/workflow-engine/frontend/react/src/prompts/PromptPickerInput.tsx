/**
 * Inspector ConfigInput for fields of `kind: 'prompt-picker'`. Renders a
 * select populated from the prompt library (filtered by the field's
 * `promptKind` constraint when set). Stores the canonical stringy
 * PromptRef (`prompt:templateId@version`) in `node.config[field.key]`.
 *
 * The field is the integration point for RFC 0027's `*PromptRef` node-
 * config convention. When a host advertises `capabilities.prompts`, the
 * options reflect the host's library; otherwise they reflect the local
 * sample list (`promptsClient.ts` handles the fallback transparently).
 */

import { useEffect, useState } from 'react';
import { getPrompt, listPrompts } from './promptsClient.js';
import type { PromptKind, PromptTemplate } from './types.js';
import { parseRef, refToString } from './types.js';

export interface PromptPickerInputProps {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  /** When set, the picker only shows templates of this kind. */
  promptKind?: PromptKind;
  /** Optional label override; inspector usually provides one above. */
  label?: string;
  /** Whether selection is required. */
  required?: boolean;
}

export function PromptPickerInput({ value, onChange, promptKind, required }: PromptPickerInputProps) {
  const [prompts, setPrompts] = useState<PromptTemplate[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listPrompts(promptKind ? { kind: promptKind } : {})
      .then((items) => {
        if (!cancelled) setPrompts(items);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [promptKind]);

  if (error) {
    return <div className="alert error">Failed to load prompts: {error}</div>;
  }
  if (prompts === null) {
    return <p className="muted">Loading prompts…</p>;
  }

  return (
    <>
      <select
        value={value ?? ''}
        required={required}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      >
        <option value="">— none —</option>
        {prompts.map((p) => {
          const ref = refToString(p);
          return (
            <option key={ref} value={ref}>
              {p.name ? `${p.name} (${ref})` : ref}
            </option>
          );
        })}
      </select>
      {value && <PromptPreview ref={value} />}
    </>
  );
}

function PromptPreview({ ref }: { ref: string }) {
  const [preview, setPreview] = useState<PromptTemplate | null>(null);
  useEffect(() => {
    let cancelled = false;
    const parsed = parseRef(ref);
    if (!parsed) {
      setPreview(null);
      return () => {
        cancelled = true;
      };
    }
    getPrompt(parsed.templateId, parsed.version).then((p) => {
      if (!cancelled) setPreview(p);
    });
    return () => {
      cancelled = true;
    };
  }, [ref]);
  if (!preview) return null;
  return (
    <div className="prompt-picker-preview">
      <details>
        <summary className="muted">Show template body</summary>
        <pre className="prompt-preview">{preview.text}</pre>
        {preview.variables && preview.variables.length > 0 && (
          <div className="muted prompt-picker-preview-vars">
            Variables: {preview.variables.map((v) => v.name).join(', ')}
          </div>
        )}
      </details>
    </div>
  );
}
