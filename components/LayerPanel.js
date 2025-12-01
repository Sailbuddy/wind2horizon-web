'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';

export default function LayerPanel({ lang = 'de', onToggle, onInit, onToggleAll }) {
  const [cats, setCats] = useState([]);
  const [state, setState] = useState(new Map());
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);

  // NEU: Ref für "Alle Kategorien"-Checkbox (indeterminate)
  const allRef = useRef(null);

  // Label je Sprache
  const label = useMemo(() => {
    switch (lang) {
      case 'en': return 'Categories';
      case 'it': return 'Categorie';
      case 'hr': return 'Kategorije';
      case 'fr': return 'Catégories';
      default:   return 'Kategorien';
    }
  }, [lang]);

  const allLabel = useMemo(() => {
    switch (lang) {
      case 'en': return 'All categories';
      case 'it': return 'Tutte le categorie';
      case 'hr': return 'Sve kategorije';
      case 'fr': return 'Toutes les catégories';
      default:   return 'Alle Kategorien';
    }
  }, [lang]);

  // Mobile: standardmäßig zu, Desktop: offen beim ersten Mal (optional)
  useEffect(() => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    setOpen(!isMobile);
  }, []);

  // Kategorien laden
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('id,name_de,name_en,name_hr,icon_svg,sort_index')
        .order('sort_index', { ascending: true })
        .order('id', { ascending: true });
      if (error) { console.error(error); return; }

      const m = new Map();
      (data || []).forEach(c => m.set(String(c.id), true)); // Standard: alles sichtbar
      setState(m);
      setCats(data || []);
      onInit && onInit(m);
    })();
  }, [onInit]);

  // Übersetzung für den Namen im Panel
  const t = (c) =>
    (lang === 'de' && c.name_de) ||
    (lang === 'hr' && c.name_hr) ||
    c.name_en || c.name_de || '–';

  // ---- NEU: All/Some-Logik für "Alle Kategorien" --------------------

  const allChecked =
    cats.length > 0 && cats.every(c => state.get(String(c.id)));

  const someChecked =
    cats.some(c => state.get(String(c.id)));

  // indeterminate-Status setzen
  useEffect(() => {
    if (allRef.current) {
      allRef.current.indeterminate = !allChecked && someChecked;
    }
  }, [allChecked, someChecked]);

  const handleToggleAll = (checked) => {
    // Lokalen State für alle Kategorien setzen
    const next = new Map(state);
    cats.forEach(c => {
      next.set(String(c.id), checked);
    });
    setState(next);

    // Parent (GoogleMapsClient) informieren
    onToggleAll && onToggleAll(checked);
  };

  // Klick außerhalb => Panel schließen (für Mobile/Accessibility)
  useEffect(() => {
    function handleOutside(e) {
      if (!open) return;
      const t = e.target;
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [open]);

  return (
    <>
      {/* Toggle-Button: Hover öffnet, Klick als Fallback (Touch/Mobile) */}
      <button
        ref={buttonRef}
        className="w2h-layer-toggle"
        type="button"
        onMouseEnter={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls="w2h-layer-panel"
        title={label}
      >
        <span className="dot" /> {label}
      </button>

      {/* Panel: offen solange Maus drüber */}
      <div
        id="w2h-layer-panel"
        ref={panelRef}
        className={`w2h-layer-panel ${open ? 'open' : 'closed'}`}
        role="group"
        aria-label={label}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
      >
        {/* NEU: Zeile 1 – Alle Kategorien */}
        <label className="row row-all">
          <input
            ref={allRef}
            type="checkbox"
            checked={allChecked}
            onChange={e => handleToggleAll(e.target.checked)}
          />
          <span className="name all-name">{allLabel}</span>
        </label>
        <hr className="divider" />

        {/* Einzelne Kategorien */}
        {cats.map(c => {
          const key = String(c.id);
          return (
            <label key={key} className="row">
              <input
                type="checkbox"
                checked={!!state.get(key)}
                onChange={e => {
                  const v = e.target.checked;
                  const next = new Map(state);
                  next.set(key, v);
                  setState(next);
                  onToggle?.(key, v);
                }}
              />
              <span className="icon" dangerouslySetInnerHTML={{ __html: c.icon_svg || '' }} />
              <span className="name">{t(c)}</span>
            </label>
          );
        })}
      </div>

      <style jsx global>{`
        .w2h-layer-toggle {
          position: absolute;
          top: 64px; left: 12px; z-index: 6;
          background: #fff; border: 1px solid rgba(0,0,0,.1);
          border-radius: 999px; padding: 6px 12px;
          box-shadow: 0 6px 20px rgba(0,0,0,.12);
          font: 14px/1.2 system-ui, sans-serif; cursor: pointer;
          display: inline-flex; align-items: center; gap: 8px;
        }
        .w2h-layer-toggle .dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: #1f6aa2; display: inline-block;
        }

        .w2h-layer-panel {
          position: absolute;
          top: 104px; left: 12px; z-index: 6;
          width: 260px; max-height: calc(100vh - 140px); overflow: auto;
          background: rgba(255,255,255,.98);
          border-radius: 10px; padding: 10px 12px;
          box-shadow: 0 12px 28px rgba(0,0,0,.18);
          transition: transform .18s ease, opacity .18s ease, visibility .18s;
        }
        .w2h-layer-panel.closed {
          transform: translateY(-8px);
          opacity: 0; visibility: hidden; pointer-events: none;
        }
        .w2h-layer-panel .row {
          display: flex; align-items: center; gap: 8px;
          margin: 6px 0; white-space: nowrap;
        }
        .w2h-layer-panel .row-all {
          margin-top: 2px;
          margin-bottom: 4px;
        }
        .w2h-layer-panel .divider {
          border: none;
          border-top: 1px solid rgba(0,0,0,.08);
          margin: 4px 0 6px;
        }
        .w2h-layer-panel .icon svg {
          width: 18px; height: 18px; vertical-align: middle;
        }
        .w2h-layer-panel .all-name {
          font-weight: 600;
        }

        @media (max-width: 767px) {
          .w2h-layer-toggle { top: 56px; }
          .w2h-layer-panel { top: 96px; width: min(86vw, 300px); }
        }
      `}</style>
    </>
  );
}
