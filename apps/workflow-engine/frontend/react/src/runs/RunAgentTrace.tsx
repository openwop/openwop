/**
 * RunAgentTrace — narrative reasoning + tool-call trace for a run.
 *
 * Parses the `agent.*` event family (RFC 0002 §B / RFC 0024) straight
 * off the run's `RunEventDoc[]` and renders it as a threaded,
 * sequence-ordered story per agent:
 *
 *   - `agent.reasoned` (+ streamed `agent.reasoning.delta`) → a thinking
 *     block. Deltas are accumulated; the closing `agent.reasoned`
 *     `reasoning` is authoritative when present.
 *   - `agent.toolCalled` + `agent.toolReturned` → one expandable step,
 *     paired by host-minted `callId` (the spec also threads
 *     `causationId === toolCalled.eventId`).
 *   - `agent.decided` → a decision badge with optional confidence.
 *
 * Handoffs (`agent.handoff`) are surfaced by the sibling RunHandoffMap;
 * this component focuses on within-agent reasoning.
 */

import { useMemo, useState } from 'react';
import type { RunEventDoc } from '@openwop/openwop';
import { MessageSquareIcon, WrenchIcon, ScaleIcon } from '../chat/icons/index.js';

interface Props {
  events: readonly RunEventDoc[];
}

interface ReasonStep { kind: 'reasoning'; seq: number; agentId: string; text: string }
interface ToolStep {
  kind: 'tool';
  seq: number;
  agentId: string;
  callId: string;
  toolName: string;
  inputs?: unknown;
  outcome?: unknown;
  error?: { code?: string; message?: string } | null;
  returned: boolean;
}
interface DecisionStep { kind: 'decision'; seq: number; agentId: string; decision: unknown; confidence?: number }
type Step = ReasonStep | ToolStep | DecisionStep;

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function buildSteps(events: readonly RunEventDoc[]): Step[] {
  const sorted = [...events].sort((a, b) => a.sequence - b.sequence);
  const steps: Step[] = [];
  const toolBySeq = new Map<string, ToolStep>(); // callId → step
  const deltaAccum = new Map<string, { seq: number; agentId: string; text: string }>();

  for (const ev of sorted) {
    const p = asRecord(ev.payload);
    const agentId = (p.agentId as string) ?? 'agent';
    switch (ev.type) {
      case 'agent.reasoning.delta': {
        const acc = deltaAccum.get(agentId) ?? { seq: ev.sequence, agentId, text: '' };
        acc.text += String(p.delta ?? '');
        deltaAccum.set(agentId, acc);
        break;
      }
      case 'agent.reasoned': {
        const acc = deltaAccum.get(agentId);
        const text = typeof p.reasoning === 'string' && p.reasoning.length > 0
          ? (p.reasoning as string)
          : acc?.text ?? '';
        deltaAccum.delete(agentId);
        if (text) steps.push({ kind: 'reasoning', seq: ev.sequence, agentId, text });
        break;
      }
      case 'agent.toolCalled': {
        const callId = (p.callId as string) ?? `seq-${ev.sequence}`;
        const step: ToolStep = {
          kind: 'tool',
          seq: ev.sequence,
          agentId,
          callId,
          // Tolerate both the spec-canonical fields (toolName/inputs) and
          // the variant some hosts/mock-agents emit (toolId/arguments).
          toolName: (p.toolName as string) ?? (p.toolId as string) ?? 'tool',
          inputs: p.inputs ?? p.arguments,
          returned: false,
          error: null,
        };
        toolBySeq.set(callId, step);
        steps.push(step);
        break;
      }
      case 'agent.toolReturned': {
        const callId = (p.callId as string) ?? '';
        const step = toolBySeq.get(callId);
        if (step) {
          step.returned = true;
          step.outcome = p.outcome ?? p.result;
          step.error = (p.error as ToolStep['error']) ?? null;
        } else {
          // Return without a matched call — surface it anyway.
          steps.push({
            kind: 'tool', seq: ev.sequence, agentId, callId: callId || `seq-${ev.sequence}`,
            toolName: (p.toolName as string) ?? (p.toolId as string) ?? 'tool',
            outcome: p.outcome ?? p.result,
            error: (p.error as ToolStep['error']) ?? null, returned: true,
          });
        }
        break;
      }
      case 'agent.decided': {
        steps.push({
          kind: 'decision', seq: ev.sequence, agentId,
          decision: p.decision,
          ...(typeof p.confidence === 'number' ? { confidence: p.confidence } : {}),
        });
        break;
      }
      default:
        break;
    }
  }

  // Flush any reasoning that streamed deltas but never closed.
  for (const acc of deltaAccum.values()) {
    if (acc.text) steps.push({ kind: 'reasoning', seq: acc.seq, agentId: acc.agentId, text: acc.text });
  }
  return steps.sort((a, b) => a.seq - b.seq);
}

function jsonStr(v: unknown): string {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

export function RunAgentTrace({ events }: Props) {
  const steps = useMemo(() => buildSteps(events), [events]);
  if (steps.length === 0) return null;

  // Group consecutive steps by agent to render per-agent lanes while
  // preserving overall sequence order.
  return (
    <div className="card">
      <h2>Agent activity</h2>
      <div className="agent-trace">
        {steps.map((step) => (
          <div className="agent-trace-step" key={`${step.kind}-${step.seq}`}>
            <span className="agent-trace-agent" title="agentId">{step.agentId}</span>
            {step.kind === 'reasoning' && <ReasoningStepView step={step} />}
            {step.kind === 'tool' && <ToolStepView step={step} />}
            {step.kind === 'decision' && <DecisionStepView step={step} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReasoningStepView({ step }: { step: ReasonStep }) {
  return (
    <div className="agent-trace-body agent-trace-reasoning">
      <span className="agent-trace-glyph" aria-hidden><MessageSquareIcon size={14} /></span>
      <span className="agent-trace-text">{step.text}</span>
    </div>
  );
}

function ToolStepView({ step }: { step: ToolStep }) {
  const [open, setOpen] = useState(false);
  const isError = !!step.error;
  return (
    <div className={`agent-trace-body agent-trace-tool${isError ? ' agent-trace-tool-error' : ''}`}>
      <button type="button" className="agent-trace-tool-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="agent-trace-glyph" aria-hidden><WrenchIcon size={14} /></span>
        <strong>{step.toolName}</strong>
        <span className="muted agent-trace-tool-status">
          {!step.returned ? 'running…' : isError ? 'failed' : 'ok'}
        </span>
      </button>
      {open && (
        <div className="agent-trace-tool-detail">
          {step.inputs !== undefined && (
            <details><summary className="muted">inputs</summary><pre>{jsonStr(step.inputs)}</pre></details>
          )}
          {step.outcome !== undefined && !isError && (
            <details><summary className="muted">outcome</summary><pre>{jsonStr(step.outcome)}</pre></details>
          )}
          {isError && step.error && (
            <div className="alert error">{step.error.code}: {step.error.message}</div>
          )}
        </div>
      )}
    </div>
  );
}

function DecisionStepView({ step }: { step: DecisionStep }) {
  const conf = step.confidence;
  const confColor = conf == null ? 'var(--ink-3)'
    : conf >= 0.7 ? '#10b981'
    : conf >= 0.5 ? '#f59e0b'
    : '#ef4444';
  const label = typeof step.decision === 'string'
    ? step.decision
    : (asRecord(step.decision).kind as string) ?? 'decision';
  return (
    <div className="agent-trace-body agent-trace-decision">
      <span className="agent-trace-glyph" aria-hidden><ScaleIcon size={14} /></span>
      <strong>Decision: {label}</strong>
      {conf != null && (
        <span className="agent-trace-conf" style={{ borderColor: confColor, color: confColor }}>
          {Math.round(conf * 100)}%
        </span>
      )}
      <details style={{ width: '100%' }}><summary className="muted">raw</summary><pre>{jsonStr(step.decision)}</pre></details>
    </div>
  );
}
