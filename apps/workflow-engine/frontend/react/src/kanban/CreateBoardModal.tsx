import { useMemo, useState } from 'react';
import type { RosterEntry } from '../agents/rosterClient.js';
import { ALL_WORKFLOW_OPTIONS } from '../agents/roleTemplates.js';
import { IconButton } from '../ui/IconButton.js';
import { XIcon, ZapIcon } from '../ui/icons/index.js';
import { Modal } from '../ui/Modal.js';

/**
 * "Create a board" modal (boards redesign) — replaces the inline create form.
 * Mirrors the Hire-agent modal pattern: eyebrow/title/lede, the three fields
 * from the design (name · optional trigger workflow · optional owning agent),
 * Cancel + solid-accent Create. The trigger select offers the host's KNOWN
 * workflow catalog (the role-template portfolio ids) — no free-text ids to
 * typo. Binding an owner attributes triggered runs to that agent (RFC 0086).
 */
export function CreateBoardModal({ roster, onClose, onCreate }: {
  roster: RosterEntry[];
  onClose: () => void;
  onCreate: (input: { name: string; triggerWorkflowId?: string; rosterId?: string }) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [rosterId, setRosterId] = useState('');

  // The known workflow catalog, deduped (roles can share a workflow).
  const workflowOptions = useMemo(() => {
    const seen = new Set<string>();
    return ALL_WORKFLOW_OPTIONS.filter((w) => {
      if (seen.has(w.workflowId)) return false;
      seen.add(w.workflowId);
      return true;
    });
  }, []);

  return (
    <Modal onClose={onClose} label="Create a board">
        <div className="hire-head">
          <div>
            <div className="hire-eyebrow">New board</div>
            <h2 className="hire-title">Create a board</h2>
            <p className="hire-lede">
              A board tracks work through To do → Done. Optionally connect a workflow that fires when cards hit the <ZapIcon size={12} aria-hidden /> trigger column.
            </p>
          </div>
          <IconButton label="Close" icon={<XIcon size={16} />} onClick={onClose} />
        </div>

        <label className="hire-label" htmlFor="cb-name">Board name</label>
        <input
          id="cb-name"
          autoFocus
          className="ui-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Q3 onboarding"
        />

        <label className="hire-label" htmlFor="cb-workflow">Trigger workflow <span className="hire-label-optional">· optional</span></label>
        <select id="cb-workflow" className="ui-input" value={workflowId} onChange={(e) => setWorkflowId(e.target.value)}>
          <option value="">No workflow — manual board</option>
          {workflowOptions.map((w) => <option key={w.workflowId} value={w.workflowId}>{w.name}</option>)}
        </select>

        <label className="hire-label" htmlFor="cb-owner">Owning agent <span className="hire-label-optional">· optional</span></label>
        <select id="cb-owner" className="ui-input" value={rosterId} onChange={(e) => setRosterId(e.target.value)}>
          <option value="">No owner — shared board</option>
          {roster.map((r) => <option key={r.rosterId} value={r.rosterId}>{r.persona}{r.label ? ` — ${r.label}` : ''}</option>)}
        </select>

        <div className="hire-foot action-bar">
          <button type="button" className="secondary btn-sm" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn-accent-solid btn-sm"
            disabled={name.trim().length === 0}
            onClick={() => onCreate({
              name: name.trim(),
              ...(workflowId ? { triggerWorkflowId: workflowId } : {}),
              ...(rosterId ? { rosterId } : {}),
            })}
          >
            + Create board
          </button>
        </div>
    </Modal>
  );
}
