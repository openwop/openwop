import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { StatusBadge } from '../StatusBadge.js';
import { Modal } from '../Modal.js';
import { ErrorBoundary } from '../ErrorBoundary.js';

afterEach(cleanup);

describe('StatusBadge', () => {
  it('renders the status text with the colored class', () => {
    render(<StatusBadge status="completed" />);
    const el = screen.getByText('completed');
    expect(el.className).toContain('status-badge');
    expect(el.className).toContain('completed');
  });

  it('maps an unknown status to the base (no tone) class', () => {
    render(<StatusBadge status="zonk" />);
    expect(screen.getByText('zonk').className.trim()).toBe('status-badge');
  });
});

describe('Modal', () => {
  it('renders children in a labelled dialog', () => {
    render(<Modal onClose={() => {}} label="Test dialog"><p>hello</p></Modal>);
    const dialog = screen.getByRole('dialog', { name: 'Test dialog' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('hello')).toBeTruthy();
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} label="d"><p>x</p></Modal>);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the scrim is clicked but not the dialog body', () => {
    const onClose = vi.fn();
    render(<Modal onClose={onClose} label="d"><button>inside</button></Modal>);
    fireEvent.click(screen.getByText('inside'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ErrorBoundary', () => {
  function Boom(): JSX.Element { throw new Error('kaboom'); }

  it('renders a recoverable fallback when a child throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary label="test region"><Boom /></ErrorBoundary>);
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByRole('button', { name: /reload/i })).toBeTruthy();
    spy.mockRestore();
  });

  it('renders children when nothing throws', () => {
    render(<ErrorBoundary><p>safe</p></ErrorBoundary>);
    expect(screen.getByText('safe')).toBeTruthy();
  });
});
