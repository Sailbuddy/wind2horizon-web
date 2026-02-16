'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export default function WelcomeOverlay({
  storageKey = 'w2h_welcome_seen',
  version = 'v1',
  title = 'wind2horizon     The best of seaside, at one spot',
  bullets = [
    'Interaktive Karte mit nautischem Fokus',
    'Wind- & Wetterinfos direkt am Ort',
    'Erlebnisse, Häfen und Tipps entlang der Adria',
  ],
  buttonLabel = 'Zur Karte',
  onClose, // ✅ NEU
}) {
  const key = `${storageKey}_${version}`;
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  // Nur einmal beim Mount prüfen (Browser-only)
    useEffect(() => {
        try {
            const seen = window.localStorage.getItem(key);

            if (seen !== '1') {
                setOpen(true);
            } else {
                onClose?.(); // sofort freigeben bei Wiederbesuch
            }
        } catch (err) {
            setOpen(true);
    }
    }, [key, onClose]);

  // ESC schließen
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e) => {
      if (e.key === 'Escape') close();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = () => {
    try {
      window.localStorage.setItem(key, '1');
    } catch {
      // ignore
    }
    setOpen(false);
    onClose?.(); // ✅ NEU: Callback in Parent auslösen
  };

  const styles = useMemo(
    () => ({
      backdrop: {
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      },
      panel: {
        width: 'min(560px, 100%)',
        borderRadius: '16px',
        background: 'rgba(15, 23, 42, 0.92)', // slate-ish
        color: '#fff',
        border: '1px solid rgba(255,255,255,0.14)',
        boxShadow: '0 20px 60px rgba(0,0,0,0.45)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        overflow: 'hidden',
      },
      header: {
        padding: '18px 18px 10px 18px',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '12px',
      },
      brandWrap: { display: 'flex', flexDirection: 'column', gap: '6px' },
      brand: {
        fontSize: '18px',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        fontWeight: 700,
        opacity: 0.92,
      },
      sub: {
        fontSize: '13px',
        opacity: 0.85,
        lineHeight: 1.35,
      },
      closeBtn: {
        appearance: 'none',
        border: '1px solid rgba(255,255,255,0.18)',
        background: 'rgba(255,255,255,0.08)',
        color: '#fff',
        borderRadius: '10px',
        width: '40px',
        height: '40px',
        cursor: 'pointer',
        display: 'grid',
        placeItems: 'center',
        fontSize: '18px',
        lineHeight: 1,
      },
      body: {
        padding: '8px 18px 18px 18px',
      },
      list: {
        margin: '10px 0 0 0',
        padding: 0,
        listStyle: 'none',
        display: 'grid',
        gap: '10px',
      },
      li: {
        display: 'flex',
        gap: '10px',
        alignItems: 'flex-start',
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: '12px',
        padding: '10px 12px',
      },
      dot: {
        width: '10px',
        height: '10px',
        borderRadius: '999px',
        marginTop: '5px',
        background: 'rgba(56, 189, 248, 0.95)', // cyan-ish
        flex: '0 0 auto',
        boxShadow: '0 0 0 4px rgba(56, 189, 248, 0.15)',
      },
      liText: {
        fontSize: '14px',
        opacity: 0.92,
        lineHeight: 1.35,
      },
      footer: {
        padding: '14px 18px 18px 18px',
        display: 'flex',
        justifyContent: 'flex-end',
      },
      primaryBtn: {
        appearance: 'none',
        border: '1px solid rgba(255,255,255,0.18)',
        background: 'rgba(56, 189, 248, 0.92)',
        color: '#001018',
        fontWeight: 700,
        borderRadius: '12px',
        padding: '12px 16px',
        cursor: 'pointer',
        minWidth: '140px',
      },
    }),
    []
  );

  if (!open) return null;

  return (
    <div
      style={styles.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Welcome"
      onMouseDown={(e) => {
        // Klick außerhalb schließt: nur wenn der Backdrop selbst getroffen wurde
        if (e.target === e.currentTarget) close();
      }}
    >
      <div ref={panelRef} style={styles.panel}>
        <div style={styles.header}>
          <div style={styles.brandWrap}>
            <div style={styles.brand}>{title}</div>
            <div style={styles.sub}>
              Willkommen an Bord. Ein kurzer Überblick – dann geht’s direkt zur Karte.
            </div>
          </div>

          <button type="button" style={styles.closeBtn} onClick={close} aria-label="Schließen">
            ✕
          </button>
        </div>

        <div style={styles.body}>
          <ul style={styles.list}>
            {bullets.map((t, idx) => (
              <li key={`${idx}-${t}`} style={styles.li}>
                <span style={styles.dot} aria-hidden="true" />
                <span style={styles.liText}>{t}</span>
              </li>
            ))}
          </ul>
        </div>

        <div style={styles.footer}>
          <button type="button" style={styles.primaryBtn} onClick={close}>
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
