'use client';

import { useEffect, useRef } from 'react';

/**
 * PanelHost (W2H)
 * - Supports BOTH APIs:
 *   A) <PanelHost open={boolean} title="..." onClose={fn}>...</PanelHost>
 *   B) <PanelHost activePanel={string|null} onClose={fn}>...</PanelHost>
 *
 * Behavior:
 * - ESC closes
 * - Click backdrop closes
 * - High z-index above Google Maps
 */
export default function PanelHost(props) {
  const { onClose, children } = props;

  // Backward/forward compatible "isOpen"
  const isOpen =
    typeof props.open === 'boolean'
      ? props.open
      : Boolean(props.activePanel); // old API: activePanel truthy => open

  const title = props.title || null;

  const overlayRef = useRef(null);

  // ESC closes (only when open)
  useEffect(() => {
    if (!isOpen) return;

    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Click outside (backdrop) closes
  const onBackdropMouseDown = (e) => {
    if (e.target === overlayRef.current) onClose?.();
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        ref={overlayRef}
        onMouseDown={onBackdropMouseDown}
        className="w2h-modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Panel'}
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

          {title ? <div className="w2h-modal-title">{title}</div> : null}

          <div className="w2h-modal-body">{children}</div>
        </div>
      </div>

      <style jsx>{`
        .w2h-modal-overlay {
          position: fixed;
          inset: 0;
          /* Google Maps kann brutal hohe Layer haben -> wir gehen drüber */
          z-index: 99999;

          display: grid;
          place-items: center;
          padding: 14px;

          /* hochwertig, durchscheinend */
          background: rgba(2, 6, 23, 0.25);
          backdrop-filter: blur(6px);
          -webkit-backdrop-filter: blur(6px);
        }

        .w2h-modal {
          position: relative;
          width: min(980px, 94vw);
          max-height: min(88vh, 820px);
          overflow: hidden;

          border-radius: 18px;
          border: 1px solid rgba(255, 255, 255, 0.35);
          background: rgba(255, 255, 255, 0.18);
          box-shadow: 0 20px 70px rgba(0, 0, 0, 0.35);

          /* Glas-Effekt */
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
        }

        .w2h-modal-x {
          position: absolute;
          top: 10px;
          right: 10px;
          z-index: 3;

          width: 36px;
          height: 36px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.35);
          background: rgba(255, 255, 255, 0.55);
          cursor: pointer;
          font-weight: 900;
        }

        .w2h-modal-title {
          padding: 14px 54px 0 16px;
          font-weight: 800;
          letter-spacing: 0.2px;
          font-size: 14px;
          color: rgba(15, 23, 42, 0.9);
          text-shadow: 0 1px 0 rgba(255, 255, 255, 0.4);
        }

        .w2h-modal-body {
          padding: 12px 14px 16px 14px;
          overflow: auto;
          max-height: min(88vh, 820px);
        }

        @media (max-width: 640px) {
          .w2h-modal {
            width: min(96vw, 980px);
            max-height: 90vh;
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
