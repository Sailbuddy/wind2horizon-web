'use client';

import { useEffect, useRef } from 'react';

export default function PanelHost({ open, title, onClose, children }) {
  const overlayRef = useRef(null);

  // ESC schließt
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Klick außerhalb (Backdrop) schließt
  const onBackdropDown = (e) => {
    if (e.target === overlayRef.current) onClose?.();
  };

  if (!open) return null;

  return (
    <>
      <div
        ref={overlayRef}
        onMouseDown={onBackdropDown}
        onTouchStart={onBackdropDown}
        className="w2h-modal-overlay"
        role="dialog"
        aria-modal="true"
      >
        <div className="w2h-modal" onMouseDown={(e) => e.stopPropagation()}>
          <div className="w2h-modal-head">
            <div className="w2h-modal-title">{title}</div>

            <button
              type="button"
              className="w2h-modal-x"
              onClick={() => onClose?.()}
              aria-label="Close"
              title="Close"
            >
              ✕
            </button>
          </div>

          <div className="w2h-modal-body">{children}</div>
        </div>
      </div>

      <style jsx>{`
        .w2h-modal-overlay {
          position: fixed;
          inset: 0;
          z-index: 2000;

          display: grid;
          place-items: center;
          padding: 14px;

          /* ✅ Backdrop transparent */
          background: transparent;

          /* OPTIONAL: wenn du minimal blur willst, setz auf blur(1px) + rgba unten
             (aktuell AUS, weil du "durchsichtig" willst)
          */
          backdrop-filter: none;
          -webkit-backdrop-filter: none;

          /* Overlay fängt Klicks ab -> Klick außerhalb schließt */
          pointer-events: auto;
        }

        .w2h-modal {
          position: relative;
          width: min(980px, 94vw);
          max-height: min(86vh, 760px);
          overflow: hidden;

          border-radius: 18px;
          border: 1px solid rgba(255, 255, 255, 0.22);

          /* ✅ milchig / glassy */
          background: rgba(255, 255, 255, 0.78);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);

          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.30);
        }

        .w2h-modal-head {
          position: sticky;
          top: 0;
          z-index: 2;

          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;

          padding: 10px 10px 8px 14px;

          /* milchig header (nicht hart weiß) */
          background: rgba(255, 255, 255, 0.55);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);

          border-bottom: 1px solid rgba(0, 0, 0, 0.08);
        }

        .w2h-modal-title {
          font-weight: 800;
          font-size: 14px;
          letter-spacing: 0.2px;
          opacity: 0.9;
        }

        .w2h-modal-x {
          width: 36px;
          height: 36px;
          border-radius: 12px;
          border: 1px solid rgba(0, 0, 0, 0.12);
          background: rgba(255, 255, 255, 0.65);
          cursor: pointer;
          font-weight: 900;
        }

        .w2h-modal-body {
          padding: 14px;
          overflow: auto;
          max-height: calc(min(86vh, 760px) - 54px);
        }

        @media (max-width: 640px) {
          .w2h-modal {
            width: min(96vw, 980px);
            max-height: 88vh;
            border-radius: 16px;
          }
          .w2h-modal-body {
            padding: 12px;
            max-height: calc(88vh - 54px);
          }
        }
      `}</style>
    </>
  );
}
