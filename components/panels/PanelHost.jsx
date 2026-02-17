'use client';

import { useEffect, useRef } from 'react';

export default function PanelHost({
  open,
  title,
  onClose,
  children,
  closeOnBackdrop = true, // Desktop: true, Mobile: optional false
}) {
  const panelRef = useRef(null);

  // ESC + Scroll-Lock + Fokus
  useEffect(() => {
    if (!open) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKeyDown);

    // Fokus ins Panel
    setTimeout(() => {
      panelRef.current?.focus?.();
    }, 0);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={title || 'Panel'}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-950/35 backdrop-blur-[4px]"
        onClick={closeOnBackdrop ? onClose : undefined}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className="
          relative z-10
          w-[92vw] max-w-[1100px]
          h-[85vh] max-h-[900px]
          rounded-2xl bg-white shadow-2xl
          overflow-hidden
          outline-none
        "
      >
        {/* Topbar */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 bg-white">
          <div className="font-semibold text-slate-900">{title}</div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Content scroll */}
        <div className="h-[calc(85vh-56px)] max-h-[calc(900px-56px)] overflow-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
