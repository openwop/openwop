import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ArtifactPreviewModal } from '../ArtifactPreviewModal.js';

afterEach(cleanup);

/**
 * Unit coverage for ArtifactPreviewModal after its E7 conversion onto ui/Modal.
 * The shared primitive's focus-trap / Escape / focus-restore is proven in
 * e2e/modal.spec.ts; here we cover the artifact-specific contract: closed →
 * nothing, the labelled dialog + header, the primary-view heuristic, the raw
 * JSON, and that the ✕ button and Escape both close.
 */
describe('ArtifactPreviewModal', () => {
  it('renders nothing when closed', () => {
    render(<ArtifactPreviewModal open={false} nodeId="n1" label="Result" output={{ output: 'HI' }} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders a labelled dialog with the node id and a close button', () => {
    render(<ArtifactPreviewModal open nodeId="publish" label="Final artifact" output={{ output: 'HI' }} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Final artifact' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('publish')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close preview' })).toBeTruthy();
  });

  it('shows the primary text body and the raw-JSON disclosure', () => {
    render(<ArtifactPreviewModal open nodeId="n" label="R" output={{ output: 'HELLO' }} onClose={() => {}} />);
    expect(screen.getByText('HELLO')).toBeTruthy(); // primary text view (exact node text)
    expect(screen.getByText('Raw output JSON')).toBeTruthy(); // <details> summary
  });

  it('renders a markdown primary view for {markdown}', () => {
    render(<ArtifactPreviewModal open nodeId="n" label="R" output={{ markdown: '# Heading' }} onClose={() => {}} />);
    expect(screen.getByText('Heading')).toBeTruthy(); // react-markdown rendered the H1 text
  });

  it('falls back to raw-JSON only when no primary field matches', () => {
    render(<ArtifactPreviewModal open nodeId="n" label="R" output={{ foo: 1 }} onClose={() => {}} />);
    expect(screen.getByText('Raw output JSON')).toBeTruthy();
  });

  it('the ✕ button and Escape both call onClose', () => {
    const onClose = vi.fn();
    render(<ArtifactPreviewModal open nodeId="n" label="R" output={{ output: 'X' }} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close preview' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
