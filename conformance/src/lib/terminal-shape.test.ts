import { describe, expect, it } from 'vitest';
import { terminalShapeViolation } from './terminal-shape.js';

describe('terminalShapeViolation (RFC 0194 §A)', () => {
  it('a plain completed run holds', () => {
    expect(terminalShapeViolation(['run.started', 'node.started', 'node.completed', 'run.completed'])).toBeNull();
  });
  it('compensation and dead-lettering after the terminal event hold (RFC 0194 §A.3)', () => {
    expect(terminalShapeViolation(['run.started', 'node.started', 'node.completed', 'run.cancelled', 'compensation.requested', 'compensation.started', 'compensation.completed'])).toBeNull();
    expect(terminalShapeViolation(['run.started', 'node.failed', 'run.failed', 'run.dead-lettered'])).toBeNull();
  });
  it('vendor-prefixed types after the terminal event are unconstrained', () => {
    expect(terminalShapeViolation(['run.started', 'run.completed', 'acme.audit-sealed'])).toBeNull();
  });
  it('the observed duplicate-delivery log is refused: two terminal events', () => {
    expect(terminalShapeViolation(['run.started', 'node.started', 'node.started', 'node.completed', 'run.completed', 'node.completed', 'run.completed'])).toMatch(/2 terminal run events/);
  });
  it('a forward-execution event after the terminal event is refused', () => {
    expect(terminalShapeViolation(['run.started', 'run.completed', 'node.failed'])).toMatch(/node\.failed at index 2/);
    expect(terminalShapeViolation(['run.started', 'run.cancelled', 'run.resumed'])).toMatch(/run\.resumed/);
    expect(terminalShapeViolation(['run.started', 'run.failed', 'interrupt.requested'])).toMatch(/interrupt\.requested/);
  });
  it('a log with no terminal event is refused', () => {
    expect(terminalShapeViolation(['run.started', 'node.started'])).toMatch(/no terminal run event/);
  });
});
