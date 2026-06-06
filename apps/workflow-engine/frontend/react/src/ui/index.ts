/**
 * ui/ barrel — the shared cohesion layer's single import surface. Prefer
 * `import { StateCard, Notice } from '../ui'` over deep per-file imports so
 * the design-system seam stays one move-able boundary. Grown as components
 * are consolidated (see GAP-ANALYSIS.md E9).
 */

export { ErrorBoundary } from './ErrorBoundary.js';
export { useFocusTrap } from './useFocusTrap.js';
export { StateCard } from './StateCard.js';
export { StatusBadge, statusTone } from './StatusBadge.js';
export { Notice, type NoticeVariant } from './Notice.js';
export { Skeleton, SkeletonRows } from './Skeleton.js';
export { PageHeader } from './PageHeader.js';
export { IconButton } from './IconButton.js';
export { ModalPortal } from './ModalPortal.js';
export { DataTable, DensityToggle, type DataColumn } from './DataTable.js';
export { toast, Toaster, dismiss, type ToastVariant, type ToastItem } from './toast.js';
