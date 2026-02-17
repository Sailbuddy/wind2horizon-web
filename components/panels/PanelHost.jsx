'use client';

import { useEffect, useRef } from 'react';

export default function PanelHost({ activePanel, onClose, children }) {
  const overlayRef = useRef(null);

  // ESC schließt
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Klick außerhalb (Backdrop) schließt
  const onBackdropMouseDown = (e) => {
    if (e.target === overlayRef.current) onClose?.();
  };

  if (!activePanel) return null;

  return (
    <>
      <div
        ref={overlayRef}
        onMouseDown={onBackdropMouseDown}
        className="w2h-modal-overlay"
        role="dialog"
        aria-modal="true"
      >
        <div className="w2h-modal">
          <button
            type="button"
            className="w2h-modal-x"
            onClick={() => onClose?.()}
            aria-label="Close"
            title="Close"
          >
            ✕
          </button>

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

          /* Map bleibt erkennbar */
          background: rgba(2, 6, 23, 0.25);
          backdrop-filter: blur(2px);
          -webkit-backdrop-filter: blur(2px);
        }

        .w2h-modal {
          position: relative;
          width: min(980px, 94vw);
          max-height: min(86vh, 760px);
          overflow: hidden;

          border-radius: 18px;
          border: 1px solid rgba(0, 0, 0, 0.10);
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.30);
        }

        .w2h-modal-x {
          position: absolute;
          top: 10px;
          right: 10px;
          z-index: 2;

          width: 36px;
          height: 36px;
          border-radius: 12px;
          border: 1px solid rgba(0, 0, 0, 0.12);
          background: rgba(255, 255, 255, 0.9);
          cursor: pointer;
          font-weight: 900;
        }

        .w2h-modal-body {
          padding: 14px 14px 16px 14px;
          overflow: auto;
          max-height: min(86vh, 760px);
        }

        @media (max-width: 640px) {
          .w2h-modal {
            width: min(96vw, 980px);
            max-height: 88vh;
            border-radius: 16px;
          }
          .w2h-modal-body {
            padding: 12px;
          }
        }
      `}</style>
    </>
  );
}
