'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import LayerPanel from '@/components/LayerPanel';
import { defaultMarkerSvg } from '@/components/DefaultMarkerSvg';
import { svgToDataUrl } from '@/lib/utils';

// 🔧 Debug-Schalter
const DEBUG_MARKERS = false; // true = einfache Kreis-Symbole statt SVG
const DEBUG_BOUNDING = false; // true = rote Bounding-Boxen über den Markern
const DEBUG_LOG = true; // true = extra Console-Logs

// 🔒 Sichtbarkeit dynamischer Attribute (falls Spalte vorhanden)
// 0 = öffentlich, 1 = erweitert, 2+ = intern (Beispiel). Passe bei Bedarf an.
const INFO_VISIBILITY_MAX = 1;

// ✅ Smoke-Test: zeigt dynamische Werte auch ohne attribute_definitions (Fallback-Label)
// Zusätzlich: übersteuert show_in_infowindow-Filter (zeigt auch wenn false)
const DYNAMIC_SMOKE_TEST = true;

// ✅ Visibility-Tier (Paywall-Ready)
// 0 = Free, 1 = Plus, 2 = Pro (Beispiel)
const USER_VISIBILITY_TIER = 0;

// --- Doppel-Wind-/Schwell-Rose (read-only Variante) -----------------
const DIRS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
const ANGLE = { N: 0, NO: 45, O: 90, SO: 135, S: 180, SW: 225, W: 270, NW: 315 };

// 🔹 Map-Style: Google-POI-Icons & Texte ausblenden
const GOOGLE_MAP_STYLE = [
  { featureType: 'poi', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', elementType: 'labels.text', stylers: [{ visibility: 'off' }] },
];

// ✅ Kleine, robuste Placeholder-Grafik (für kaputte Images)
const IMG_PLACEHOLDER_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
     <rect width="1200" height="800" fill="#f3f4f6"/>
     <path d="M240 560l180-220 160 190 140-170 240 300H240z" fill="#d1d5db"/>
     <circle cx="420" cy="300" r="55" fill="#d1d5db"/>
     <text x="600" y="710" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
           font-size="34" fill="#6b7280">Bild nicht verfügbar</text>
   </svg>`;
const IMG_PLACEHOLDER_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(IMG_PLACEHOLDER_SVG)}`;

function WindSwellRose({ size = 260, wind = {}, swell = {} }) {
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.4;
  const innerR = size * 0.24;
  const arrowL = size * 0.085;
  const arrowW = size * 0.06;

  const normBool = (m) => {
    const out = {};
    DIRS.forEach((d) => {
      out[d] = !!(m && m[d]);
    });
    return out;
  };

  const w = normBool(wind);
  const s = normBool(swell);

  const arrow = (deg, r) => {
    const rad = ((deg - 90) * Math.PI) / 180; // 0° = Norden
    const tipX = cx + Math.cos(rad) * (r - arrowL);
    const tipY = cy + Math.sin(rad) * (r - arrowL);
    const baseX = cx + Math.cos(rad) * r;
    const baseY = cy + Math.sin(rad) * r;
    const nx = Math.cos(rad + Math.PI / 2) * (arrowW / 2);
    const ny = Math.sin(rad + Math.PI / 2) * (arrowW / 2);
    return `${tipX},${tipY} ${baseX - nx},${baseY - ny} ${baseX + nx},${baseY + ny}`;
  };

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Wind & Schwell">
      <circle cx={cx} cy={cy} r={outerR} fill="none" stroke="#AFAFAF" strokeWidth={size * 0.03} />
      <circle cx={cx} cy={cy} r={innerR} fill="none" stroke="#AFAFAF" strokeWidth={size * 0.025} />

      {DIRS.map((d) => (
        <polygon key={`w-${d}`} points={arrow(ANGLE[d], outerR)} fill={w[d] ? '#E53E3E' : '#C7C7C7'}>
          <title>{`Gefahr bei WIND aus ${d}`}</title>
        </polygon>
      ))}

      {DIRS.map((d) => (
        <polygon key={`s-${d}`} points={arrow(ANGLE[d], innerR)} fill={s[d] ? '#2563EB' : '#C7C7C7'}>
          <title>{`Gefahr bei SCHWELL aus ${d}`}</title>
        </polygon>
      ))}

      {DIRS.map((d) => {
        const r = outerR + size * 0.08;
        const rad = ((ANGLE[d] - 90) * Math.PI) / 180;
        const tx = cx + Math.cos(rad) * r;
        const ty = cy + Math.sin(rad) * r;
        return (
          <text
            key={`lbl-${d}`}
            x={tx}
            y={ty}
            fontFamily="system-ui, sans-serif"
            fontSize={size * 0.07}
            fill="#111"
            textAnchor="middle"
            dominantBaseline="central"
          >
            {d}
          </text>
        );
      })}
    </svg>
  );
}

// 🔹 Fallback-HTML, falls das Infofenster nicht gerendert werden kann
function buildErrorInfoContent(rowId) {
  return `
    <div class="w2h-iw">
      <div class="iw-bd">
        <strong>Fehler beim Anzeigen dieses Spots (#${rowId}).</strong><br/>
        Die Daten sind vorhanden, aber das Infofenster konnte nicht gerendert werden.
      </div>
    </div>
  `;
}

export default function GoogleMapClient({ lang = 'de' }) {
  const mapRef = useRef(null);
  const mapObj = useRef(null);
  const markers = useRef([]);
  const layerState = useRef(new Map()); // category_id -> boolean
  const infoWin = useRef(null);
  const iconCache = useRef(new Map()); // category_id -> google.maps.Icon
  const [booted, setBooted] = useState(false);

  // 🔹 Marker-Map & Locations für Suche
  const markerMapRef = useRef(new Map()); // location_id -> Marker
  const locationsRef = useRef([]); // aktuell sichtbare Locations (nach Deduplizierung)

  // 🔹 Meta pro Location (für Suche/InfoWindow)
  const metaByLocRef = useRef(new Map()); // location_id -> aggregated meta (kv)

  // 🔹 Attribute-Definitionen Cache (dynamische InfoWindow-Felder)
  // { byId: Map<number, def>, byKey: Map<string, def>, hasVisibility: bool }
  const attrSchemaRef = useRef(null);

  // Galerie-Lightbox
  const [gallery, setGallery] = useState(null);

  // Winddaten-Modal (mit Daten)
  const [windModal, setWindModal] = useState(null);

  // ✅ KI-Report Modal (wird erst bei Klick gerendert = Lazy-Render)
  // { locationId, title, loading, error, report, createdAt }
  const [kiModal, setKiModal] = useState(null);

  // Such-Query-State
  const [searchQuery, setSearchQuery] = useState('');

  // ✅ Search Focus Mode
  const [searchMode, setSearchMode] = useState({
    active: false,
    query: '',
    results: [], // [{ row, score }]
    message: '', // Hinweise (z.B. Kategorie deaktiviert)
    matchedCategories: [], // [{id, name, group_key}]
  });
  const prevVisibilityRef = useRef(null); // Map(markerId -> bool) zur Restore-Logik

  // ✅ Regions aus Supabase (fitBounds)
  const [regions, setRegions] = useState([]); // rows aus public.regions
  const [selectedRegion, setSelectedRegion] = useState('all'); // 'all' oder region.slug
  const [regionMode, setRegionMode] = useState('auto'); // 'auto' | 'manual'

  // ✅ Track, ob InfoWindow zuletzt durch Marker geöffnet wurde
  const infoWinOpenedByMarkerRef = useRef(false);

  // ✅ Helper: InfoWindow schließen
  const closeInfoWindow = () => {
    try {
      if (infoWin.current) infoWin.current.close();
    } catch {
      // ignore
    }
  };

  // ---------------------------------------------
  // Helpers: KI-Report API (GET cached / POST refresh)
  // Lazy: Requests werden ausschließlich per Klick ausgelöst.
  // ---------------------------------------------
  async function fetchKiReport({ locationId, langCode }) {
    const res = await fetch(
      `/api/ki-report?location_id=${encodeURIComponent(String(locationId))}&lang=${encodeURIComponent(langCode)}`,
      { method: 'GET', headers: { Accept: 'application/json' } }
    );
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(txt || `GET ki-report failed (${res.status})`);
    }
    return res.json();
  }

  async function refreshKiReport({ locationId, langCode }) {
    const res = await fetch(`/api/ki-report/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ location_id: locationId, lang: langCode }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(txt || `POST ki-report/refresh failed (${res.status})`);
    }
    return res.json();
  }

  // ---------------------------------------------
  // Helpers: Google Photo Proxy + HTML escaper
  // ---------------------------------------------
  // ✅ (1) photoUrl() sendet zusätzlich place_id + location_id mit (für on-demand refresh im /api/gphoto)
  const photoUrl = (ref, max = 800, row = null) => {
    let url = `/api/gphoto?photo_reference=${encodeURIComponent(ref)}&maxwidth=${max}`;
    if (row?.google_place_id) url += `&place_id=${encodeURIComponent(row.google_place_id)}`;
    if (row?.id !== undefined && row?.id !== null) url += `&location_id=${encodeURIComponent(String(row.id))}`;
    return url;
  };

  // ✅ (2) Optional: onError UX (React Images) – step-down maxwidth, dann Placeholder
  function handleImgError(e) {
    try {
      const img = e?.currentTarget;
      if (!img) return;

      const step = Number(img.dataset?.w2hStep || 0);
      const src = String(img.getAttribute('src') || '');

      // Nur für unsere gphoto URLs sinnvoll (enthält maxwidth=)
      if (src.includes('/api/gphoto') && src.includes('maxwidth=')) {
        if (step === 0) {
          img.dataset.w2hStep = '1';
          img.src = src.replace(/maxwidth=\d+/i, 'maxwidth=600');
          return;
        }
        if (step === 1) {
          img.dataset.w2hStep = '2';
          img.src = src.replace(/maxwidth=\d+/i, 'maxwidth=400');
          return;
        }
      }

      // endgültig: Placeholder
      img.onerror = null;
      img.src = IMG_PLACEHOLDER_URL;
      img.style.opacity = '0.75';
    } catch {
      // ignore
    }
  }

  function escapeHtml(str = '') {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function safeHref(raw = '') {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (s.startsWith('http://') || s.startsWith('https://')) return s;
    // block "javascript:" etc.
    if (s.includes(':')) return '';
    return `https://${s}`;
  }

  // ✅ SVG niemals roh in HTML injizieren (XSS-Schutz).
  // Stattdessen: Icon als data URL in <img> rendern.
  function svgToImgTag(svgMarkup, size = 20) {
    const rawSvg = svgMarkup && String(svgMarkup).trim().startsWith('<') ? svgMarkup : defaultMarkerSvg;
    const url = svgToDataUrl(rawSvg);
    return `<img src="${escapeHtml(url)}" alt="" width="${size}" height="${size}" style="display:block;" />`;
  }

  // ---------------------------------------------
  // ✅ Regions Helpers (Supabase + fitBounds)
  // ---------------------------------------------
  function pickRegionName(r, langCode) {
    return (
      (langCode === 'de' && r.name_de) ||
      (langCode === 'en' && r.name_en) ||
      (langCode === 'it' && r.name_it) ||
      (langCode === 'fr' && r.name_fr) ||
      (langCode === 'hr' && r.name_hr) ||
      r.name_de ||
      r.name_en ||
      r.slug
    );
  }

  function boundsToLatLngBounds(r) {
    const sw = new google.maps.LatLng(Number(r.bounds_south), Number(r.bounds_west));
    const ne = new google.maps.LatLng(Number(r.bounds_north), Number(r.bounds_east));
    return new google.maps.LatLngBounds(sw, ne);
  }

  function pointInRegion(lat, lng, r) {
    const la = Number(lat);
    const lo = Number(lng);
    return la >= Number(r.bounds_south) && la <= Number(r.bounds_north) && lo >= Number(r.bounds_west) && lo <= Number(r.bounds_east);
  }

  function allLabel(langCode) {
    return langCode === 'de'
      ? 'Alle'
      : langCode === 'it'
        ? 'Tutte'
        : langCode === 'fr'
          ? 'Toutes'
          : langCode === 'hr'
            ? 'Sve'
            : 'All';
  }

  // ---------------------------------------------
  // ✅ Dynamic attributes: schema + formatting
  // ---------------------------------------------
  function getAttrLabel(def, langCode) {
    if (!def) return '';
    const key = def.key || '';
    const raw =
      (langCode === 'de' && def.name_de) ||
      (langCode === 'it' && def.name_it) ||
      (langCode === 'fr' && def.name_fr) ||
      (langCode === 'hr' && def.name_hr) ||
      (langCode === 'en' && def.name_en) ||
      def.name_de ||
      def.name_en ||
      key;
    return String(raw || key || '');
  }

  function applyDisplayFormat(def, rawVal, renderedText) {
    const fmt = (def && def.display_format ? String(def.display_format) : '').trim().toLowerCase();
    if (!fmt) return renderedText;

    try {
      if (fmt === 'upper') return escapeHtml(String(rawVal).toUpperCase());
      if (fmt === 'lower') return escapeHtml(String(rawVal).toLowerCase());

      if (fmt === 'percent') {
        const n = typeof rawVal === 'number' ? rawVal : Number(String(rawVal));
        if (Number.isFinite(n)) return escapeHtml(`${n}%`);
        return renderedText;
      }

      if (fmt === 'currency_eur') {
        const n = typeof rawVal === 'number' ? rawVal : Number(String(rawVal));
        if (Number.isFinite(n)) return escapeHtml(`${n.toFixed(2)} €`);
        return renderedText;
      }

      if (fmt === 'stars') {
        const n = typeof rawVal === 'number' ? rawVal : Number(String(rawVal));
        if (!Number.isFinite(n)) return renderedText;
        const rInt = Math.max(0, Math.min(5, Math.round(n)));
        const stars = '★'.repeat(rInt) + '☆'.repeat(5 - rInt);
        return escapeHtml(`${stars} ${n.toFixed(1)}`);
      }

      if (fmt === 'json_pretty') {
        const v = typeof rawVal === 'object' ? rawVal : JSON.parse(String(rawVal));
        const pretty = JSON.stringify(v, null, 2);
        return `<pre style="white-space:pre-wrap;margin:0;">${escapeHtml(pretty)}</pre>`;
      }
    } catch {
      // ignore
    }

    return renderedText;
  }

  function formatDynamicValue({ def, val, langCode }) {
    const inputType = (def && def.input_type) || '';
    if (val === null || val === undefined) return '';

    const isObj = typeof val === 'object';
    const asText = isObj ? JSON.stringify(val) : String(val);

    // bool
    if (inputType === 'bool' || typeof val === 'boolean') {
      const b = val === true || val === 'true' || val === 1 || val === '1';
      const out = b ? (langCode === 'de' ? 'Ja' : 'Yes') : langCode === 'de' ? 'Nein' : 'No';
      return applyDisplayFormat(def, val, escapeHtml(out));
    }

    // url/link
    if (inputType === 'url' || inputType === 'link') {
      const href = safeHref(asText);
      if (!href) return applyDisplayFormat(def, asText, escapeHtml(asText));
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(asText)}</a>`;
    }

    // options/select
    if (inputType === 'option' || inputType === 'select') {
      try {
        const opts = def && def.options ? def.options : null;
        const j = typeof opts === 'string' ? JSON.parse(opts) : opts;
        if (Array.isArray(j)) {
          const hit = j.find((o) => String(o.value) === String(val));
          if (hit && hit.label) return applyDisplayFormat(def, val, escapeHtml(String(hit.label)));
        } else if (j && typeof j === 'object') {
          const hit = j[String(val)];
          if (typeof hit === 'string') return applyDisplayFormat(def, val, escapeHtml(hit));
          if (hit && typeof hit === 'object' && hit.label) return applyDisplayFormat(def, val, escapeHtml(String(hit.label)));
        }
      } catch {
        // ignore
      }
      return applyDisplayFormat(def, val, escapeHtml(asText));
    }

    return applyDisplayFormat(def, val, escapeHtml(asText));
  }

  /**
   * Lädt attribute_definitions in attrSchemaRef.
   * Primärschlüssel/ID-Spalte: "attribute_id".
   */
  async function ensureAttributeSchema() {
    if (attrSchemaRef.current) return attrSchemaRef.current;

    const baseSelect =
      'attribute_id,key,input_type,options,sort_order,is_active,multilingual,' +
      'name_de,name_en,name_it,name_fr,name_hr,' +
      'description_de,description_en,description_it,description_fr,description_hr,' +
      'show_in_infowindow,infowindow_group,infowindow_order,display_format';
    const selectWithVisibility = `${baseSelect},visibility_level`;

    let data = null;
    let hasVisibility = false;

    {
      const { data: d1, error: e1 } = await supabase.from('attribute_definitions').select(selectWithVisibility);
      if (!e1) {
        data = d1 || [];
        hasVisibility = true;
      } else {
        const { data: d2, error: e2 } = await supabase.from('attribute_definitions').select(baseSelect);
        if (e2) {
          console.warn('[w2h] attribute_definitions load failed:', e2.message);
          data = [];
        } else {
          data = d2 || [];
        }
        hasVisibility = false;
      }
    }

    const byId = new Map();
    const byKey = new Map();

    (data || []).forEach((def) => {
      if (!def) return;
      const id = def.attribute_id;
      const key = def.key;
      if (id !== null && id !== undefined) byId.set(Number(id), def);
      if (key) byKey.set(String(key), def);
    });

    attrSchemaRef.current = { byId, byKey, hasVisibility };

    if (DEBUG_LOG) {
      console.log('[w2h] attribute schema loaded', {
        count: byId.size,
        hasVisibility,
        sample: data && data[0] ? data[0] : null,
      });
    }

    return attrSchemaRef.current;
  }

  // ------------------------------
  // ✅ Lightbox + WindModal + KiReportModal
  // ------------------------------
  function Lightbox({ gallery: g, onClose }) {
    if (!g) return null;

    let items = [];
    try {
      if (Array.isArray(g.photos)) items = g.photos;
      else if (typeof g.photos === 'string') {
        const parsed = JSON.parse(g.photos);
        items = Array.isArray(parsed) ? parsed : parsed?.photos || [];
      } else if (g.photos && typeof g.photos === 'object') {
        items = Array.isArray(g.photos.photos) ? g.photos.photos : [];
      }
    } catch (err) {
      console.warn('[w2h] Lightbox parse failed', err);
      items = [];
    }

    return (
      <div
        className="w2h-lbx"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,.7)',
          zIndex: 9999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          onClick={(ev) => ev.stopPropagation()}
          style={{
            background: '#fff',
            borderRadius: 14,
            maxWidth: 1100,
            width: '95vw',
            maxHeight: '90vh',
            overflow: 'auto',
            padding: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
              {g.title} – {items.length} Fotos
            </h3>
            <button onClick={onClose} style={{ fontSize: 24, lineHeight: 1, background: 'transparent', border: 'none', cursor: 'pointer' }}>
              ×
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {items
              .map((p, idx) => {
                const isGoogle = !!(p.photo_reference || p.photoreference);
                const isUser = !!(p.public_url || p.url || p.thumb);

                let src = '';
                if (isGoogle) {
                  const ref = p.photo_reference || p.photoreference;
                  const w = Math.min(1200, Number(p.width || 0) || 640);
                  src = photoUrl(ref, w, g.row || null); // ✅ place_id + location_id werden mitgeschickt
                } else if (isUser) {
                  src = p.thumb || p.public_url || p.url || '';
                }

                if (!src) return null;

                return (
                  <figure key={p.public_url || p.url || p.photo_reference || p.photoreference || idx} style={{ margin: 0 }}>
                    <div
                      style={{
                        background: '#fafafa',
                        border: '1px solid #eee',
                        borderRadius: 10,
                        minHeight: 160,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                      }}
                    >
                      <img
                        src={src}
                        alt={p.caption || ''}
                        loading="lazy"
                        decoding="async"
                        data-w2h-step="0"
                        onError={handleImgError} // ✅ Optional UX
                        style={{ width: '100%', height: 'auto', display: 'block' }}
                      />
                    </div>

                    {isGoogle ? (
                      Array.isArray(p.html_attributions) && p.html_attributions[0] ? (
                        <figcaption style={{ fontSize: 12, color: '#666', padding: '6px 2px' }} dangerouslySetInnerHTML={{ __html: p.html_attributions[0] }} />
                      ) : null
                    ) : p.caption || p.author ? (
                      <figcaption style={{ fontSize: 12, color: '#666', padding: '6px 2px' }}>
                        {[p.caption, p.author && `© ${p.author}`].filter(Boolean).join(' · ')}
                      </figcaption>
                    ) : null}
                  </figure>
                );
              })
              .filter(Boolean)}
          </div>
        </div>
      </div>
    );
  }

  function WindModal({ modal, onClose }) {
    if (!modal) return null;

    const windProfile = modal.windProfile || null;
    const windHint = modal.windHint || {};
    const hintText = windHint[lang] || windHint.de || windHint.en || '';
    const liveWindStation = modal.liveWindStation || null;
    const liveWindStationName = modal.liveWindStationName || null;

    return (
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,.65)',
          zIndex: 10000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          onClick={(ev) => ev.stopPropagation()}
          style={{
            background: '#f9fafb',
            borderRadius: 16,
            maxWidth: 960,
            width: '95vw',
            maxHeight: '90vh',
            padding: 20,
            boxShadow: '0 10px 30px rgba(0,0,0,.25)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <h2 style={{ margin: 0, fontSize: 20 }}>💨 Winddaten · {modal.title} (#{modal.id})</h2>
            <button onClick={onClose} style={{ fontSize: 24, lineHeight: 1, background: 'transparent', border: 'none', cursor: 'pointer' }}>
              ×
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 0.9fr)', gap: 20 }}>
            <div style={{ background: '#fff', borderRadius: 14, padding: 12, border: '1px solid #e5e7eb' }}>
              <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Wind &amp; Schwell-Rosette</h3>
              {windProfile ? (
                <WindSwellRose size={260} wind={windProfile.wind || {}} swell={windProfile.swell || {}} />
              ) : (
                <p style={{ margin: 0, fontSize: 14, color: '#6b7280' }}>Für diesen Spot sind aktuell keine Wind-/Schwellprofile hinterlegt.</p>
              )}
            </div>

            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ background: '#fff', borderRadius: 14, padding: 12, border: '1px solid #e5e7eb' }}>
                <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>Hinweis</h3>
                {hintText ? (
                  <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' }}>{hintText}</p>
                ) : (
                  <p style={{ margin: 0, fontSize: 14, color: '#9ca3af' }}>Kein spezieller Hinweistext hinterlegt.</p>
                )}
              </div>

              <div style={{ background: '#fff', borderRadius: 14, padding: 12, border: '1px solid #e5e7eb' }}>
                <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>LiveWind</h3>
                {liveWindStation ? (
                  <>
                    <p style={{ margin: '0 0 6px', fontSize: 12, color: '#6b7280' }}>
                      Station: <strong>{liveWindStation}{liveWindStationName ? ` – ${liveWindStationName}` : ''}</strong>
                    </p>
                    <iframe
                      src={`https://w2hlivewind.netlify.app?station=${encodeURIComponent(String(liveWindStation))}`}
                      style={{ width: '100%', height: 70, border: 'none', borderRadius: 8 }}
                      loading="lazy"
                      title="LiveWind"
                    />
                  </>
                ) : (
                  <p style={{ margin: 0, fontSize: 14, color: '#9ca3af' }}>Für diesen Spot ist noch keine Live-Wind-Station verknüpft.</p>
                )}
              </div>
            </div>
          </div>

          <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>Hinweis: Darstellung aktuell nur zur internen Kontrolle. Feintuning folgt.</p>
        </div>
      </div>
    );
  }

  function KiReportModal({ modal, onClose, onRefresh }) {
    if (!modal) return null;

    const { loading, error, report, title } = modal;

    return (
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,.65)',
          zIndex: 10001,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          onClick={(ev) => ev.stopPropagation()}
          style={{
            background: '#fff',
            borderRadius: 16,
            maxWidth: 980,
            width: '95vw',
            maxHeight: '90vh',
            padding: 18,
            boxShadow: '0 10px 30px rgba(0,0,0,.25)',
            overflow: 'auto',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#6b7280' }}>KI-Report</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: '#111827' }}>{title || 'Spot'}</div>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button
                onClick={onRefresh}
                disabled={!!loading}
                style={{
                  background: loading ? '#e5e7eb' : '#111827',
                  color: loading ? '#6b7280' : '#fff',
                  border: 'none',
                  borderRadius: 10,
                  padding: '10px 12px',
                  cursor: loading ? 'default' : 'pointer',
                  fontWeight: 800,
                  fontSize: 12,
                }}
              >
                {loading ? 'Lädt…' : 'Aktualisieren'}
              </button>

              <button onClick={onClose} style={{ fontSize: 24, lineHeight: 1, background: 'transparent', border: 'none', cursor: 'pointer' }}>
                ×
              </button>
            </div>
          </div>

          {error ? (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: 12, color: '#7f1d1d', fontSize: 13 }}>
              {String(error)}
            </div>
          ) : null}

          {loading ? (
            <div style={{ fontSize: 13, color: '#6b7280' }}>Report wird geladen…</div>
          ) : report ? (
            <div style={{ display: 'grid', gap: 12 }}>
              {renderKiReportPretty(report, lang)}
              <div style={{ fontSize: 11, color: '#9ca3af' }}>Quelle: Datenbank + Live-Abfrage. Inhalte werden bei Aktualisierung überschrieben (wenn so konfiguriert).</div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#6b7280' }}>Kein Report vorhanden.</div>
          )}
        </div>
      </div>
    );
  }

  function renderKiReportPretty(report, langCode) {
    if (!report || typeof report !== 'object') return null;

    const title = report.title || '';
    const summary = report.summary || '';
    const highlights = Array.isArray(report.highlights) ? report.highlights : [];
    const attrs = Array.isArray(report.attributes) ? report.attributes : [];
    const pi = report.practical_info && typeof report.practical_info === 'object' ? report.practical_info : {};

    const rows = [];

    if (pi.address) rows.push({ k: langCode === 'de' ? 'Adresse' : 'Address', v: String(pi.address) });
    if (pi.phone) rows.push({ k: langCode === 'de' ? 'Telefon' : 'Phone', v: String(pi.phone) });
    if (pi.website) rows.push({ k: 'Website', v: String(pi.website) });
    if (pi.rating !== undefined && pi.rating !== null) rows.push({ k: 'Rating', v: String(pi.rating) });
    if (pi.price_level !== undefined && pi.price_level !== null) rows.push({ k: langCode === 'de' ? 'Preisniveau' : 'Price level', v: String(pi.price_level) });

    return (
      <div style={{ display: 'grid', gap: 12 }}>
        {title ? <div style={{ fontSize: 13, fontWeight: 800 }}>{title}</div> : null}

        {summary ? (
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e5e7eb',
              borderRadius: 12,
              padding: 12,
              fontSize: 13,
              lineHeight: 1.45,
              color: '#111827',
            }}
          >
            {summary}
          </div>
        ) : null}

        {highlights.length ? (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 6, color: '#111827' }}>{langCode === 'de' ? 'Highlights' : 'Highlights'}</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#374151' }}>
              {highlights.map((h, i) => (
                <li key={`${h}-${i}`}>{String(h)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {rows.length ? (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 8, color: '#111827' }}>{langCode === 'de' ? 'Praktische Infos' : 'Practical info'}</div>

            <div style={{ display: 'grid', gap: 8 }}>
              {rows.map((r) => {
                const isUrl = r.k === 'Website' && String(r.v).startsWith('http');
                return (
                  <div key={r.k} style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 10, alignItems: 'start' }}>
                    <div style={{ fontSize: 12, fontWeight: 800, color: '#111827' }}>{r.k}</div>
                    <div style={{ fontSize: 13, color: '#374151', wordBreak: 'break-word' }}>
                      {isUrl ? (
                        <a href={r.v} target="_blank" rel="noopener" style={{ color: '#1f6aa2', textDecoration: 'underline' }}>
                          {r.v}
                        </a>
                      ) : (
                        r.v
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {attrs.length ? (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 8, color: '#111827' }}>{langCode === 'de' ? 'Attribute' : 'Attributes'}</div>

            <div style={{ display: 'grid', gap: 10 }}>
              {attrs.map((a, idx) => (
                <div key={`${a.label || 'attr'}-${idx}`} style={{ borderTop: idx ? '1px solid #f1f5f9' : 'none', paddingTop: idx ? 10 : 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: '#111827' }}>{String(a.label || '')}</div>
                  {a.value ? <div style={{ fontSize: 13, color: '#374151', marginTop: 4, whiteSpace: 'pre-wrap' }}>{String(a.value)}</div> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  // ---------------------------------------------
  // ✅ Map & Data boot
  // ---------------------------------------------
  function ensureInfoWindow() {
    if (!infoWin.current && typeof google !== 'undefined' && google.maps?.InfoWindow) {
      infoWin.current = new google.maps.InfoWindow({ disableAutoPan: false });
    }
    return infoWin.current;
  }

  async function loadRegions() {
    const { data, error } = await supabase.from('regions').select('*').order('sort_order', { ascending: true });
    if (error) {
      console.warn('[w2h] regions load failed:', error.message);
      return [];
    }
    setRegions(data || []);
    return data || [];
  }

  // Minimal: categories for LayerPanel
  async function loadCategories() {
    const cols =
      'id,group_key,sort_order,is_active,' +
      'name_de,name_en,name_it,name_fr,name_hr,' +
      'marker_svg,marker_color,icon_url';

    const { data, error } = await supabase.from('categories').select(cols).order('sort_order', { ascending: true });
    if (error) {
      console.warn('[w2h] categories load failed:', error.message);
      return [];
    }
    return data || [];
  }

  async function loadLocations() {
    const cols =
      'id,category_id,lat,lng,display_name,name_de,name_en,name_it,name_fr,name_hr,' +
      'google_place_id,plus_code,source_type';

    // NOTE: filter/regions layer happens client-side.
    const { data, error } = await supabase.from('locations').select(cols);
    if (error) {
      console.warn('[w2h] locations load failed:', error.message);
      return [];
    }
    return data || [];
  }

  async function loadLocationValues(locationIds) {
    if (!Array.isArray(locationIds) || !locationIds.length) return [];

    const cols =
      'id,location_id,attribute_id,value_text,value_number,value_bool,value_json,' +
      'lang,created_at,updated_at';

    const { data, error } = await supabase.from('location_values').select(cols).in('location_id', locationIds);
    if (error) {
      console.warn('[w2h] location_values load failed:', error.message);
      return [];
    }
    return data || [];
  }

  function pickTitle(row) {
    return (
      (lang === 'de' && (row.display_name || row.name_de)) ||
      (lang === 'en' && row.name_en) ||
      (lang === 'it' && row.name_it) ||
      (lang === 'fr' && row.name_fr) ||
      (lang === 'hr' && row.name_hr) ||
      row.display_name ||
      row.name_de ||
      row.name_en ||
      `Spot #${row.id}`
    );
  }

  function buildMarkerIcon(category, sizePx = 30) {
    if (!category) {
      const url = svgToDataUrl(defaultMarkerSvg);
      return {
        url,
        scaledSize: new google.maps.Size(sizePx, sizePx),
        anchor: new google.maps.Point(sizePx / 2, sizePx),
      };
    }

    // priority: marker_svg (our svg), else icon_url, else default
    const cached = iconCache.current.get(category.id);
    if (cached) return cached;

    let url = '';
    if (category.marker_svg && String(category.marker_svg).trim().startsWith('<')) {
      url = svgToDataUrl(String(category.marker_svg));
    } else if (category.icon_url) {
      url = String(category.icon_url);
    } else {
      url = svgToDataUrl(defaultMarkerSvg);
    }

    const icon = {
      url,
      scaledSize: new google.maps.Size(sizePx, sizePx),
      anchor: new google.maps.Point(sizePx / 2, sizePx),
    };

    iconCache.current.set(category.id, icon);
    return icon;
  }

  function clearMarkers() {
    markers.current.forEach((m) => {
      try {
        m.setMap(null);
      } catch {
        // ignore
      }
    });
    markers.current = [];
    markerMapRef.current = new Map();
  }

  function setMarkerVisibilityByCategory(categoryId, visible) {
    markers.current.forEach((m) => {
      const cid = m.__w2hCategoryId;
      if (cid === categoryId) m.setVisible(!!visible);
    });
  }

  function computeAggregatedMeta(values, schema, langCode) {
    // returns { photos, windProfile, windHint, liveWindStation, ...dynamicKVs }
    const out = {};

    // helper to choose "best" value from LV row
    const valFromRow = (r) => {
      if (r.value_json !== null && r.value_json !== undefined) return r.value_json;
      if (r.value_text !== null && r.value_text !== undefined) return r.value_text;
      if (r.value_number !== null && r.value_number !== undefined) return r.value_number;
      if (r.value_bool !== null && r.value_bool !== undefined) return r.value_bool;
      return null;
    };

    (values || []).forEach((r) => {
      if (!r) return;

      const def = schema?.byId?.get?.(Number(r.attribute_id)) || null;
      const key = def?.key || String(r.attribute_id);

      // multilingual: prefer current lang rows; otherwise keep first
      if (def?.multilingual) {
        if (r.lang === langCode) {
          out[key] = valFromRow(r);
        } else if (out[key] === undefined) {
          out[key] = valFromRow(r);
        }
      } else {
        // non multilingual: keep first
        if (out[key] === undefined) out[key] = valFromRow(r);
      }
    });

    return out;
  }

  function deriveSpecialMeta(meta) {
    // optional keys used by our UI
    const out = {
      photos: null,
      windProfile: null,
      windHint: null,
      liveWindStation: null,
      liveWindStationName: null,
    };

    // photos: supports various shapes
    if (meta?.photos) out.photos = meta.photos;
    if (meta?.gallery) out.photos = meta.gallery;

    // wind profile / hint
    if (meta?.wind_profile) out.windProfile = meta.wind_profile;
    if (meta?.windProfile) out.windProfile = meta.windProfile;

    if (meta?.wind_hint) out.windHint = meta.wind_hint;
    if (meta?.windHint) out.windHint = meta.windHint;

    // live wind station
    if (meta?.livewind_station) out.liveWindStation = meta.livewind_station;
    if (meta?.liveWindStation) out.liveWindStation = meta.liveWindStation;

    if (meta?.livewind_station_name) out.liveWindStationName = meta.livewind_station_name;
    if (meta?.liveWindStationName) out.liveWindStationName = meta.liveWindStationName;

    return out;
  }

  function buildDynamicInfoRows(row, values, schema) {
    // Build HTML rows for dynamic attributes based on attribute_definitions
    // Filters:
    // - is_active true
    // - show_in_infowindow true (unless smoke test)
    // - visibility_level <= INFO_VISIBILITY_MAX and <= USER_VISIBILITY_TIER
    const byAttr = new Map(); // attribute_id -> row value object
    (values || []).forEach((v) => {
      const id = Number(v.attribute_id);
      if (!byAttr.has(id)) byAttr.set(id, []);
      byAttr.get(id).push(v);
    });

    const defs = Array.from(schema?.byId?.values?.() || []);
    defs.sort((a, b) => {
      const ga = String(a.infowindow_group || '');
      const gb = String(b.infowindow_group || '');
      if (ga !== gb) return ga.localeCompare(gb);
      const oa = Number(a.infowindow_order ?? a.sort_order ?? 9999);
      const ob = Number(b.infowindow_order ?? b.sort_order ?? 9999);
      return oa - ob;
    });

    const rows = [];
    defs.forEach((def) => {
      if (!def) return;
      if (def.is_active === false) return;

      const visLevel = schema?.hasVisibility ? Number(def.visibility_level ?? 0) : 0;
      if (!Number.isFinite(visLevel)) return;
      if (visLevel > INFO_VISIBILITY_MAX) return;
      if (visLevel > USER_VISIBILITY_TIER) return;

      const show = def.show_in_infowindow === true;
      if (!show && !DYNAMIC_SMOKE_TEST) return;

      const vals = byAttr.get(Number(def.attribute_id)) || [];
      if (!vals.length) return;

      // choose best row for language (if multilingual)
      let chosen = vals[0];
      if (def.multilingual) {
        const hit = vals.find((v) => v.lang === lang);
        if (hit) chosen = hit;
      }

      const rawVal = (chosen.value_json ?? chosen.value_text ?? chosen.value_number ?? chosen.value_bool);
      if (rawVal === null || rawVal === undefined || rawVal === '') return;

      const label = getAttrLabel(def, lang);
      const rendered = formatDynamicValue({ def, val: rawVal, langCode: lang });

      rows.push(
        `<div class="iw-row">
          <div class="iw-k">${escapeHtml(label || def.key || '')}</div>
          <div class="iw-v">${rendered}</div>
        </div>`
      );
    });

    return rows;
  }

  function buildInfoWindowHtml({ row, category, meta, dynamicRows }) {
    const title = escapeHtml(pickTitle(row));
    const catName =
      (lang === 'de' && category?.name_de) ||
      (lang === 'en' && category?.name_en) ||
      (lang === 'it' && category?.name_it) ||
      (lang === 'fr' && category?.name_fr) ||
      (lang === 'hr' && category?.name_hr) ||
      category?.name_de ||
      category?.name_en ||
      '';

    const iconTag = svgToImgTag(category?.marker_svg || defaultMarkerSvg, 18);

    const pid = row.google_place_id ? escapeHtml(row.google_place_id) : '';
    const plus = row.plus_code ? escapeHtml(row.plus_code) : '';

    const buttons = `
      <div class="iw-actions">
        <button class="w2h-btn" data-action="gallery">Fotos</button>
        <button class="w2h-btn" data-action="wind">Wind</button>
        <button class="w2h-btn primary" data-action="ki">KI-Report</button>
      </div>
    `;

    const metaLine = `
      <div class="iw-meta">
        ${catName ? `<span class="iw-cat">${iconTag}<span>${escapeHtml(catName)}</span></span>` : ''}
        ${pid ? `<span class="iw-chip">Place</span>` : ''}
        ${plus ? `<span class="iw-chip">${plus}</span>` : ''}
      </div>
    `;

    const dyn = dynamicRows.length
      ? `<div class="iw-dyn">${dynamicRows.join('')}</div>`
      : `<div class="iw-empty">${lang === 'de' ? 'Noch keine Detailwerte hinterlegt.' : 'No details yet.'}</div>`;

    return `
      <style>
        .w2h-iw{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:340px}
        .w2h-iw .iw-hd{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
        .w2h-iw .iw-title{font-weight:900;font-size:15px;line-height:1.2;margin:0;color:#111827}
        .w2h-iw .iw-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
        .w2h-iw .iw-cat{display:inline-flex;align-items:center;gap:6px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:999px;padding:4px 8px;font-size:12px;color:#0f172a}
        .w2h-iw .iw-chip{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:999px;padding:4px 8px;font-size:12px}
        .w2h-iw .iw-actions{display:flex;gap:8px;margin-top:10px}
        .w2h-btn{border:1px solid #e5e7eb;background:#fff;border-radius:10px;padding:7px 10px;font-size:12px;font-weight:800;cursor:pointer}
        .w2h-btn.primary{background:#111827;color:#fff;border-color:#111827}
        .iw-dyn{margin-top:12px;display:grid;gap:10px}
        .iw-row{display:grid;grid-template-columns:1fr 1.2fr;gap:10px;align-items:start}
        .iw-k{font-size:12px;font-weight:900;color:#111827}
        .iw-v{font-size:12px;color:#374151;word-break:break-word}
        .iw-empty{margin-top:12px;font-size:12px;color:#6b7280}
      </style>

      <div class="w2h-iw" data-location-id="${escapeHtml(String(row.id))}">
        <div class="iw-hd">
          <div>
            <h3 class="iw-title">${title}</h3>
            ${metaLine}
          </div>
        </div>
        ${buttons}
        ${dyn}
      </div>
    `;
  }

  function attachInfoWindowHandlers({ row, category, meta }) {
    // Add click listeners to InfoWindow DOM after it is rendered.
    // Note: google maps renders into its own container; we query by data-location-id.
    window.setTimeout(() => {
      try {
        const root = document.querySelector(`.w2h-iw[data-location-id="${CSS.escape(String(row.id))}"]`);
        if (!root) return;

        const btnGallery = root.querySelector('button[data-action="gallery"]');
        const btnWind = root.querySelector('button[data-action="wind"]');
        const btnKi = root.querySelector('button[data-action="ki"]');

        if (btnGallery) {
          btnGallery.onclick = () => {
            const derived = deriveSpecialMeta(meta);
            setGallery({
              title: pickTitle(row),
              photos: derived.photos || meta?.photos || [],
              row,
            });
          };
        }

        if (btnWind) {
          btnWind.onclick = () => {
            const derived = deriveSpecialMeta(meta);
            setWindModal({
              id: row.id,
              title: pickTitle(row),
              windProfile: derived.windProfile || null,
              windHint: derived.windHint || null,
              liveWindStation: derived.liveWindStation || null,
              liveWindStationName: derived.liveWindStationName || null,
            });
          };
        }

        if (btnKi) {
          btnKi.onclick = async () => {
            const locationId = row.id;
            const title = pickTitle(row);

            setKiModal({ locationId, title, loading: true, error: null, report: null, createdAt: null });

            try {
              const data = await fetchKiReport({ locationId, langCode: lang });
              setKiModal({
                locationId,
                title,
                loading: false,
                error: null,
                report: data?.report || data,
                createdAt: data?.createdAt || data?.created_at || null,
              });
            } catch (err) {
              setKiModal({ locationId, title, loading: false, error: err?.message || String(err), report: null, createdAt: null });
            }
          };
        }
      } catch (err) {
        console.warn('[w2h] attachInfoWindowHandlers failed', err);
      }
    }, 0);
  }

  async function openInfoWindowForRow(row, category, values) {
    const iw = ensureInfoWindow();
    if (!iw) return;

    try {
      const schema = await ensureAttributeSchema();
      const dynamicRows = buildDynamicInfoRows(row, values, schema);

      const meta = computeAggregatedMeta(values, schema, lang);
      const html = buildInfoWindowHtml({ row, category, meta, dynamicRows });

      iw.setContent(html);
      iw.open({ map: mapObj.current, anchor: markerMapRef.current.get(row.id) || undefined });

      attachInfoWindowHandlers({ row, category, meta });
    } catch (err) {
      console.warn('[w2h] InfoWindow build failed', err);
      iw.setContent(buildErrorInfoContent(row.id));
      iw.open({ map: mapObj.current, anchor: markerMapRef.current.get(row.id) || undefined });
    }
  }

  function applyRegionFilter(rows) {
    if (selectedRegion === 'all') return rows || [];
    const r = regions.find((x) => x.slug === selectedRegion);
    if (!r) return rows || [];
    return (rows || []).filter((row) => pointInRegion(row.lat, row.lng, r));
  }

  function fitToRegion() {
    if (!mapObj.current || !regions.length) return;

    if (selectedRegion === 'all') {
      // Fit to all markers if possible
      const rows = locationsRef.current || [];
      if (!rows.length) return;
      const b = new google.maps.LatLngBounds();
      rows.forEach((r) => b.extend(new google.maps.LatLng(Number(r.lat), Number(r.lng))));
      mapObj.current.fitBounds(b, 40);
      return;
    }

    const r = regions.find((x) => x.slug === selectedRegion);
    if (!r) return;
    mapObj.current.fitBounds(boundsToLatLngBounds(r), 40);
  }

  async function boot() {
    if (booted) return;
    if (!mapRef.current) return;
    if (typeof window === 'undefined') return;
    if (!window.google?.maps) {
      console.warn('[w2h] google.maps not available yet (script missing?)');
      return;
    }

    // Map init
    const map = new google.maps.Map(mapRef.current, {
      center: { lat: 45.2, lng: 13.6 },
      zoom: 7,
      mapTypeControl: false,
      fullscreenControl: true,
      streetViewControl: false,
      clickableIcons: false,
      styles: GOOGLE_MAP_STYLE,
    });

    mapObj.current = map;
    ensureInfoWindow();

    // Data load (parallel)
    const [cats, regs] = await Promise.all([loadCategories(), loadRegions()]);

    // init layer state: default = visible for active categories
    const ls = new Map();
    (cats || []).forEach((c) => {
      if (!c) return;
      if (c.is_active === false) return;
      ls.set(Number(c.id), true);
    });
    layerState.current = ls;

    // Load locations + values
    const locsAll = await loadLocations();
    const locs = applyRegionFilter(locsAll);
    locationsRef.current = locs;

    const schema = await ensureAttributeSchema();
    const locIds = locs.map((l) => l.id);
    const lvs = await loadLocationValues(locIds);

    // group location_values by location_id
    const byLoc = new Map();
    lvs.forEach((r) => {
      if (!r) return;
      const id = Number(r.location_id);
      if (!byLoc.has(id)) byLoc.set(id, []);
      byLoc.get(id).push(r);
    });

    // build metaByLocRef
    const metaByLoc = new Map();
    locs.forEach((row) => {
      const vals = byLoc.get(Number(row.id)) || [];
      metaByLoc.set(Number(row.id), computeAggregatedMeta(vals, schema, lang));
    });
    metaByLocRef.current = metaByLoc;

    // markers
    clearMarkers();

    const catById = new Map((cats || []).map((c) => [Number(c.id), c]));
    locs.forEach((row) => {
      const cat = catById.get(Number(row.category_id)) || null;
      const visible = layerState.current.get(Number(row.category_id)) !== false;

      const marker = new google.maps.Marker({
        position: { lat: Number(row.lat), lng: Number(row.lng) },
        map,
        title: pickTitle(row),
        icon: DEBUG_MARKERS ? undefined : buildMarkerIcon(cat, 32),
        optimized: true,
        clickable: true,
        zIndex: 1,
        visible,
      });

      marker.__w2hRow = row;
      marker.__w2hCategoryId = Number(row.category_id);

      marker.addListener('click', async () => {
        infoWinOpenedByMarkerRef.current = true;
        const vals = byLoc.get(Number(row.id)) || [];
        await openInfoWindowForRow(row, cat, vals);
      });

      markers.current.push(marker);
      markerMapRef.current.set(Number(row.id), marker);
    });

    if (DEBUG_BOUNDING) {
      // simple bounding circles for debug
      markers.current.forEach((m) => {
        const pos = m.getPosition();
        if (!pos) return;
        new google.maps.Circle({
          map,
          center: pos,
          radius: 20,
          strokeColor: '#ff0000',
          strokeOpacity: 0.9,
          strokeWeight: 1,
          fillOpacity: 0,
        });
      });
    }

    // initial fit
    if ((regs || []).length) fitToRegion();

    // close iw on map click (but not when clicking inside iw)
    map.addListener('click', () => {
      infoWinOpenedByMarkerRef.current = false;
      closeInfoWindow();
    });

    setBooted(true);

    if (DEBUG_LOG) {
      console.log('[w2h] boot ok', { categories: cats?.length || 0, regions: regs?.length || 0, locations: locs?.length || 0, values: lvs?.length || 0 });
    }
  }

  // ---------------------------------------------
  // ✅ Effects
  // ---------------------------------------------
  useEffect(() => {
    boot().catch((e) => console.warn('[w2h] boot failed', e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Region change: refilter & refresh markers (simple rebuild)
  useEffect(() => {
    if (!booted) return;

    (async () => {
      const locsAll = await loadLocations();
      const locs = applyRegionFilter(locsAll);
      locationsRef.current = locs;

      const schema = await ensureAttributeSchema();
      const locIds = locs.map((l) => l.id);
      const lvs = await loadLocationValues(locIds);

      const byLoc = new Map();
      lvs.forEach((r) => {
        if (!r) return;
        const id = Number(r.location_id);
        if (!byLoc.has(id)) byLoc.set(id, []);
        byLoc.get(id).push(r);
      });

      // rebuild meta
      const metaByLoc = new Map();
      locs.forEach((row) => metaByLoc.set(Number(row.id), computeAggregatedMeta(byLoc.get(Number(row.id)) || [], schema, lang)));
      metaByLocRef.current = metaByLoc;

      // rebuild markers
      const cats = await loadCategories();
      const catById = new Map((cats || []).map((c) => [Number(c.id), c]));
      clearMarkers();

      locs.forEach((row) => {
        const cat = catById.get(Number(row.category_id)) || null;
        const visible = layerState.current.get(Number(row.category_id)) !== false;

        const marker = new google.maps.Marker({
          position: { lat: Number(row.lat), lng: Number(row.lng) },
          map: mapObj.current,
          title: pickTitle(row),
          icon: DEBUG_MARKERS ? undefined : buildMarkerIcon(cat, 32),
          optimized: true,
          clickable: true,
          visible,
        });

        marker.__w2hRow = row;
        marker.__w2hCategoryId = Number(row.category_id);

        marker.addListener('click', async () => {
          infoWinOpenedByMarkerRef.current = true;
          const vals = byLoc.get(Number(row.id)) || [];
          await openInfoWindowForRow(row, cat, vals);
        });

        markers.current.push(marker);
        markerMapRef.current.set(Number(row.id), marker);
      });

      if (regionMode === 'auto') fitToRegion();
    })().catch((e) => console.warn('[w2h] region refresh failed', e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRegion, regionMode, booted]);

  // ---------------------------------------------
  // ✅ LayerPanel handlers
  // ---------------------------------------------
  const onToggleLayer = (categoryId, nextVisible) => {
    layerState.current.set(Number(categoryId), !!nextVisible);
    setMarkerVisibilityByCategory(Number(categoryId), !!nextVisible);
  };

  // ---------------------------------------------
  // ✅ Search (simple: title + plus_code + place_id)
  // ---------------------------------------------
  const searchResults = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) return [];
    const rows = locationsRef.current || [];
    const out = [];

    rows.forEach((row) => {
      const t = pickTitle(row).toLowerCase();
      const p = String(row.plus_code || '').toLowerCase();
      const g = String(row.google_place_id || '').toLowerCase();

      const hay = `${t} ${p} ${g}`;
      if (hay.includes(q)) out.push(row);
    });

    return out.slice(0, 20);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, booted, selectedRegion]);

  const focusRow = async (row) => {
    if (!row || !mapObj.current) return;
    const marker = markerMapRef.current.get(Number(row.id));
    if (marker) {
      mapObj.current.panTo(marker.getPosition());
      mapObj.current.setZoom(Math.max(mapObj.current.getZoom() || 8, 12));
      google.maps.event.trigger(marker, 'click');
    }
  };

  // ---------------------------------------------
  // ✅ Ki Modal refresh handler
  // ---------------------------------------------
  const onRefreshKi = async () => {
    if (!kiModal?.locationId) return;
    const locationId = kiModal.locationId;
    setKiModal((m) => ({ ...(m || {}), loading: true, error: null }));

    try {
      const data = await refreshKiReport({ locationId, langCode: lang });
      setKiModal((m) => ({
        ...(m || {}),
        loading: false,
        error: null,
        report: data?.report || data,
        createdAt: data?.createdAt || data?.created_at || null,
      }));
    } catch (err) {
      setKiModal((m) => ({ ...(m || {}), loading: false, error: err?.message || String(err) }));
    }
  };

  // ---------------------------------------------
  // UI
  // ---------------------------------------------
  return (
    <div style={{ position: 'relative' }}>
      {/* Map */}
      <div ref={mapRef} style={{ width: '100%', height: '70vh', borderRadius: 18, overflow: 'hidden' }} />

      {/* Layer Panel (floating) */}
      <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 3 }}>
        <LayerPanel
          lang={lang}
          onToggleLayer={onToggleLayer}
          selectedRegion={selectedRegion}
          onSelectRegion={(slug) => {
            setSelectedRegion(slug);
            setRegionMode('auto');
          }}
          regions={regions}
          allLabel={allLabel(lang)}
        />
      </div>

      {/* Search */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 3,
          width: 320,
          maxWidth: '92vw',
          background: 'rgba(255,255,255,.92)',
          border: '1px solid #e5e7eb',
          borderRadius: 14,
          padding: 10,
          boxShadow: '0 10px 30px rgba(0,0,0,.12)',
        }}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={lang === 'de' ? 'Suchen… (Name / Pluscode / Place ID)' : 'Search…'}
            style={{
              width: '100%',
              border: '1px solid #e5e7eb',
              borderRadius: 12,
              padding: '10px 12px',
              fontSize: 13,
              outline: 'none',
              background: '#fff',
            }}
          />
          <button
            onClick={() => setSearchQuery('')}
            style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 12, padding: '10px 10px', fontWeight: 800, cursor: 'pointer' }}
            title={lang === 'de' ? 'Leeren' : 'Clear'}
          >
            ×
          </button>
        </div>

        {searchResults.length ? (
          <div style={{ marginTop: 8, maxHeight: 300, overflow: 'auto', display: 'grid', gap: 6 }}>
            {searchResults.map((r) => (
              <button
                key={r.id}
                onClick={() => focusRow(r)}
                style={{
                  textAlign: 'left',
                  border: '1px solid #e5e7eb',
                  background: '#fff',
                  borderRadius: 12,
                  padding: '8px 10px',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 900, color: '#111827' }}>{pickTitle(r)}</div>
                <div style={{ fontSize: 11, color: '#6b7280' }}>
                  #{r.id} · {r.plus_code ? r.plus_code : r.google_place_id ? 'Place' : ''}
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Modals */}
      <Lightbox gallery={gallery} onClose={() => setGallery(null)} />
      <WindModal modal={windModal} onClose={() => setWindModal(null)} />
      <KiReportModal modal={kiModal} onClose={() => setKiModal(null)} onRefresh={onRefreshKi} />
    </div>
  );
}
