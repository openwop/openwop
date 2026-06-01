/**
 * AvatarEditor — the profile-photo editor for an agent's dashboard, modelled on
 * the industry-standard avatar croppers (Slack / GitHub / Gravatar): pick or
 * drop an image, pan it under a round crop frame, zoom with a slider, then Save.
 * On save the visible crop is rasterised to a 256×256 JPEG `data:` URI and
 * handed back via `onSave`; "Remove photo" calls `onSave(null)`.
 *
 * Uses `react-easy-crop` for the pan/zoom gesture surface. Modal chrome
 * (backdrop sibling + focus trap + Esc + focus restore) mirrors
 * `chat/ArtifactPreviewModal.tsx` so a11y stays consistent across the app.
 */

import { useEffect, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import type { Area, Point } from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';
import { ImageIcon, TrashIcon, XIcon } from '../ui/icons/index.js';

/** Exported edge of the cropped thumbnail, px (square). Small enough that the
 *  base64 string rides comfortably on the durable roster row. */
const OUTPUT_SIZE = 256;
/** Refuse absurd source files before we even decode them (raw bytes). */
const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function AvatarEditor({
  personaName,
  currentAvatarUrl,
  onSave,
  onCancel,
}: {
  personaName: string;
  currentAvatarUrl?: string;
  /** `string` data-URI to set the photo, `null` to remove it. */
  onSave: (avatarUrl: string | null) => void | Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  // Object URL of the freshly-picked source image (null until one is chosen).
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [saving, setSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<Element | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  // Focus trap + Esc-to-close + focus restore (the ArtifactPreviewModal recipe).
  useEffect(() => {
    triggerRef.current = document.activeElement;
    const handle = requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCancel(); return; }
      if (e.key === 'Tab') trapTab(e, dialogRef.current);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(handle);
      window.removeEventListener('keydown', onKey);
      const t = triggerRef.current;
      if (t instanceof HTMLElement) t.focus();
    };
  }, [onCancel]);

  // Revoke the object URL when it's replaced or the editor unmounts — without
  // this each re-pick leaks a blob URL for the page's lifetime.
  useEffect(() => () => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
  }, []);

  function acceptFile(file: File | undefined | null): void {
    setLocalError(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setLocalError('Choose an image file (PNG, JPEG, or WebP).');
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setLocalError('That image is over 12 MB. Pick a smaller one.');
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setImageSrc(url);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  }

  async function onSaveClick(): Promise<void> {
    if (!imageSrc || !croppedAreaPixels) return;
    setSaving(true);
    setLocalError(null);
    try {
      const dataUrl = await cropToDataUrl(imageSrc, croppedAreaPixels);
      await onSave(dataUrl);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Could not process that image.');
      setSaving(false);
    }
  }

  return (
    <>
      <div onClick={onCancel} aria-hidden="true" className="modal-backdrop" style={{ zIndex: 1000 }} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="avatar-editor-heading"
        style={{
          position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1001, padding: 'var(--space-4)', pointerEvents: 'none',
        }}
      >
        <div
          style={{
            pointerEvents: 'auto', background: 'var(--color-surface)', color: 'var(--color-text)',
            border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
            width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column',
            boxShadow: '0 8px 24px var(--ink-shadow, rgba(0,0,0,0.25))',
          }}
        >
          <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-border)' }}>
            <h2 id="avatar-editor-heading" style={{ margin: 0, fontSize: 16 }}>{personaName}'s profile photo</h2>
            <button type="button" className="secondary" onClick={onCancel} aria-label="Close editor" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center' }}>
              <XIcon size={14} />
            </button>
          </header>

          <div style={{ padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {imageSrc ? (
              <>
                {/* Crop stage — react-easy-crop fills this positioned box. */}
                <div style={{ position: 'relative', width: '100%', height: 280, background: 'var(--color-surface-2)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
                  <Cropper
                    image={imageSrc}
                    crop={crop}
                    zoom={zoom}
                    aspect={1}
                    cropShape="round"
                    showGrid={false}
                    minZoom={1}
                    maxZoom={3}
                    onCropChange={setCrop}
                    onZoomChange={setZoom}
                    onCropComplete={(_area, pixels) => setCroppedAreaPixels(pixels)}
                  />
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 13, color: 'var(--color-text-muted)' }}>
                  <span style={{ minWidth: 44 }}>Zoom</span>
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={0.01}
                    value={zoom}
                    onChange={(e) => setZoom(Number(e.target.value))}
                    aria-label="Zoom"
                    style={{ flex: 1 }}
                  />
                </label>
              </>
            ) : (
              // Drop zone / picker — the initial state and the "replace" path.
              <label
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); acceptFile(e.dataTransfer.files?.[0]); }}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)',
                  height: 280, textAlign: 'center', cursor: 'pointer', padding: 'var(--space-4)',
                  border: `2px dashed ${dragOver ? 'var(--color-accent)' : 'var(--color-border)'}`,
                  borderRadius: 'var(--radius)',
                  background: dragOver ? 'var(--color-surface-2)' : 'transparent',
                  color: 'var(--color-text-muted)',
                }}
              >
                {currentAvatarUrl ? (
                  <img src={currentAvatarUrl} alt="" style={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover' }} />
                ) : (
                  <ImageIcon size={32} />
                )}
                <div style={{ fontSize: 14, color: 'var(--color-text)' }}>Drag an image here, or click to choose</div>
                <div style={{ fontSize: 12 }}>PNG, JPEG, or WebP · up to 12 MB</div>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => acceptFile(e.target.files?.[0])}
                  style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0 0 0 0)', border: 0 }}
                />
              </label>
            )}

            {localError ? (
              <div role="alert" style={{ fontSize: 12.5, color: 'var(--color-danger)' }}>{localError}</div>
            ) : null}

            {/* Footer actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              {currentAvatarUrl ? (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void onSave(null)}
                  disabled={saving}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}
                >
                  <TrashIcon size={13} /> Remove photo
                </button>
              ) : null}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
                {imageSrc ? (
                  <button type="button" className="secondary" onClick={() => { setImageSrc(null); setCroppedAreaPixels(null); }} disabled={saving}>
                    Choose another
                  </button>
                ) : null}
                <button type="button" className="secondary" onClick={onCancel} disabled={saving}>Cancel</button>
                <button type="button" className="primary" onClick={() => void onSaveClick()} disabled={saving || !imageSrc || !croppedAreaPixels}>
                  {saving ? 'Saving…' : 'Save photo'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/** Draw the selected source-pixel region onto a square canvas and export a
 *  JPEG data-URI. `crop` is in natural-image pixels (react-easy-crop's
 *  `croppedAreaPixels`), so no extra scaling math is needed. */
async function cropToDataUrl(src: string, crop: Area): Promise<string> {
  const image = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image editing is not supported in this browser.');
  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  return canvas.toDataURL('image/jpeg', 0.85);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load that image.'));
    img.src = src;
  });
}

/** Trap Tab inside the dialog (same helper as ArtifactPreviewModal). */
function trapTab(e: KeyboardEvent, container: HTMLDivElement | null): void {
  if (!container) return;
  const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
  if (focusables.length === 0) { e.preventDefault(); return; }
  const first = focusables[0]!;
  const last = focusables[focusables.length - 1]!;
  const active = document.activeElement;
  if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
}
