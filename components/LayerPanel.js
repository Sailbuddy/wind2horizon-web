'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { svgToDataUrl } from '@/lib/utils';
import { defaultMarkerSvg } from '@/components/DefaultMarkerSvg';

/**
 * LayerPanel (B2: Linked Toggles via group_key + visibility_tier prepared)
 *
 * Behavior:
 * - Categories are displayed as before (no new 5-language group labels needed).
 * - If a category has group_key, toggling it will toggle ALL categories in that group.
 * - "All categories" toggles everything (respecting the fetched list).
 *
 * Callbacks:
 * - onInit(map)                 -> initial visibility state map (id -> boolean)
 * - onToggle(catId, visible, meta) -> called for the clicked category (meta includes group info & affected ids)
 * - onToggleAll(visible)        -> global toggle requested
 *
 * Note:
 * - This file does NOT enforce paywall gating; it only exposes visibility_tier/group_key to the parent via meta.
 */
export default function LayerPanel({ lang = 'de', onToggle, onInit, onToggleAll }) {
  const [cats, setCats] = useState([]);
  const [state, setState] = useState(new Map());
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);

  // "All categories" checkbox indeterminate
  const allRef = useRef(null);

  // Label je Sprache
  const label = useMemo(() => {
    switch (lang) {
      case 'en':
        return 'Categories';
      case 'it':
        return 'Categorie';
      case 'hr':
        return 'Kategorije';
      case 'fr':
        return 'Catégories';
      default:
        return 'Kategorien';
    }
  }, [lang]);

  const allLabel = useMemo(() => {
    switch (lang) {
      case 'en':
        return 'All categories';
      case 'it':
        return 'Tutte le categorie';
      case 'hr':
        return 'Sve kategorije';
      case 'fr':
        return 'Toutes les catégories';
      default:
        return 'Alle Kategorien';
    }
  }, [lang]);

  // Mobile: standardmäßig zu, Desktop: offen beim ersten Mal
  useEffect(() => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    setOpen(!isMobile);
  }, []);

  // Kategorien laden – nur solche mit mindestens 1 Location
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('categories')
        .select(
          `
          id,
          name_de,
          name_en,
          name_hr,
          name_it,
          name_fr,
          icon_svg,
          sort_index,
          group_key,
          visibility_tier,
          locations!inner(id)
        `
        )
        .order('sort_index', { ascending: true })
        .order('id', { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error('Error loading categories with locations:', error);
        return;
      }

      // Join liefert nur Kategorien mit mindestens einer Location.
      // Das verschachtelte "locations" entfernen wir wieder.
      const cleaned = (data || []).map(({ locations, ...cat }) => cat);

      // Default: alles sichtbar
      const m = new Map();
      cleaned.forEach((c) => m.set(String(c.id), true));

      setState(m);
      setCats(cleaned);
      onInit && onInit(m);
    })();

    return () => {
      cancelled = true;
    };
  }, [onInit]);

  // Übersetzung für den Namen im Panel
  const t = (c) =>
    (lang === 'de' && c.name_de) ||
    (lang === 'en' && c.name_en) ||
    (lang === 'it' && c.name_it) ||
    (lang === 'fr' && c.name_fr) ||
    (lang === 'hr' && c.name_hr) ||
    c.name_de ||
    c.name_en ||
    '–';

  // ---- All/Some-Logik für "Alle Kategorien" --------------------
  const allChecked = cats.length > 0 && cats.every((c) => state.get(String(c.id)));
  const someChecked = cats.some((c) => state.get(String(c.id)));

  useEffect(() => {
    if (allRef.current) {
      allRef.current.indeterminate = !allChecked && someChecked;
    }
  }, [allChecked, someChecked]);

  const handleToggleAll = (checked) => {
    const next = new Map(state);
    cats.forEach((c) => next.set(String(c.id), checked));
    setState(next);

    onToggleAll && onToggleAll(checked);
  };

  // group_key -> array of cat ids
  const groupIndex = useMemo(() => {
    const m = new Map();
    for (const c of cats) {
      const g = (c.group_key || '').trim();
      if (!g) continue;
      if (!m.has(g)) m.set(g, []);
      m.get(g).push(String(c.id));
    }
    return m;
  }, [cats]);

// Klick außerhalb => Panel schließen (nur Mobile; Desktop bleibt stabil offen)
useEffect(() => {
  function handleOutside(e) {
    if (!open) return;

    // ✅ Nur auf Mobile schließen (Map-Klick soll Desktop nicht beeinflussen)
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    if (!isMobile) return;

    const el = e.target;
    if (panelRef.current?.contains(el) || buttonRef.current?.contains(el)) return;
    setOpen(false);
  }

  document.addEventListener('mousedown', handleOutside);
  document.addEventListener('touchstart', handleOutside);
  return () => {
    document.removeEventListener('mousedown', handleOutside);
    document.removeEventListener('touchstart', handleOutside);
  };
}, [open]);

  // Toggle one category; if it has group_key, toggle its whole group.
  const handleToggleOne = (catIdStr, checked) => {
    const cat = cats.find((c) => String(c.id) === String(catIdStr));
    if (!cat) return;

    const gk = (cat.group_key || '').trim();
    const affectedIds = gk && groupIndex.has(gk) ? groupIndex.get(gk) : [String(cat.id)];

    const next = new Map(state);
    affectedIds.forEach((id) => next.set(String(id), checked));
    setState(next);

    // Parent informieren – wir liefern Meta, damit GoogleMapClient ggf. gruppenweise Layer setzt
    onToggle?.(String(cat.id), checked, {
      group_key: gk || null,
      visibility_tier: Number(cat.visibility_tier ?? 0),
      affected_category_ids: affectedIds.slice(),
    });
  };

  // ✅ SVG sicher rendern: nie raw HTML injizieren, sondern als data-url im <img>
  function getSafeIconUrl(svgMarkup) {
    const rawSvg = svgMarkup && String(svgMarkup).trim().startsWith('<') ? String(svgMarkup) : defaultMarkerSvg;
    return svgToDataUrl(rawSvg);
  }

  return (
    <>
      {/* Toggle-Button: Hover öffnet, Klick als Fallback (Touch/Mobile) */}
      <button
        ref={buttonRef}
        className="w2h-layer-toggle"
        type="button"
        onClick={() => setOpen((v) => !v)}
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
      >
        {/* Zeile 1 – Alle Kategorien */}
        <label className="row row-all">
          <input ref={allRef} type="checkbox" checked={allChecked} onChange={(e) => handleToggleAll(e.target.checked)} />
          <span className="name all-name">{allLabel}</span>
        </label>
        <hr className="divider" />

        {/* Einzelne Kategorien (nur mit Locations) */}
        {cats.map((c) => {
          const key = String(c.id);
          const gk = (c.group_key || '').trim();
          const groupSize = gk && groupIndex.has(gk) ? groupIndex.get(gk).length : 0;

          const iconUrl = getSafeIconUrl(c.icon_svg);

          return (
            <label key={key} className="row">
              <input type="checkbox" checked={!!state.get(key)} onChange={(e) => handleToggleOne(key, e.target.checked)} />
              <img className="iconImg" src={iconUrl} alt="" width={18} height={18} loading="lazy" decoding="async" />
              <span className="name">
                {t(c)}
                {groupSize > 1 ? <span className="hint"> · {groupSize}</span> : null}
              </span>
            </label>
          );
        })}
      </div>

      <style jsx global>{`
        .w2h-layer-toggle {
          position: relative;
          top: auto;
          left: auto;
          z-index: 6;
          background: #fff;
          border: 1px solid rgba(0, 0, 0, 0.1);
          border-radius: 999px;
          padding: 6px 12px;
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
          font: 14px/1.2 system-ui, sans-serif;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        .w2h-layer-toggle .dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #1f6aa2;
          display: inline-block;
        }

        .w2h-layer-panel {
          position: absolute;
          top: 104px;
          left: 12px;
          z-index: 6;
          width: 260px;
          max-height: calc(100vh - 140px);
          overflow: auto;
          background: rgba(255, 255, 255, 0.98);
          border-radius: 10px;
          padding: 10px 12px;
          box-shadow: 0 12px 28px rgba(0, 0, 0, 0.18);
          transition: transform 0.18s ease, opacity 0.18s ease, visibility 0.18s;
        }
        .w2h-layer-panel.closed {
          transform: translateY(-8px);
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
        }
        .w2h-layer-panel .row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin: 6px 0;
          white-space: nowrap;
        }
        .w2h-layer-panel .row-all {
          margin-top: 2px;
          margin-bottom: 4px;
        }
        .w2h-layer-panel .divider {
          border: none;
          border-top: 1px solid rgba(0, 0, 0, 0.08);
          margin: 4px 0 6px;
        }

        /* ✅ sichere Icon-Ausgabe */
        .w2h-layer-panel .iconImg {
          width: 18px;
          height: 18px;
          display: block;
          flex: 0 0 auto;
        }

        .w2h-layer-panel .all-name {
          font-weight: 600;
        }
        .w2h-layer-panel .hint {
          font-size: 12px;
          color: #6b7280;
          font-weight: 600;
        }

        @media (max-width: 767px) {
          .w2h-layer-toggle {
            white-space: nowrap;
          }
          .w2h-layer-panel {
            top: 96px;
            width: min(86vw, 300px);
          }
        }
      `}</style>
    </>
  );
}
