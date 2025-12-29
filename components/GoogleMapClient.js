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
  const layerState = useRef(new Map());
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
  const photoUrl = (ref, max = 800) => `/api/gphoto?photoreference=${encodeURIComponent(ref)}&maxwidth=${max}`;

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
   * Wichtig: Primärschlüssel/ID-Spalte heißt bei dir "attribute_id".
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
                  src = photoUrl(ref, w);
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
                      <img src={src} alt={p.caption || ''} loading="lazy" decoding="async" style={{ width: '100%', height: 'auto', display: 'block' }} />
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

    const created = modal.createdAt ? new Date(modal.createdAt).toLocaleString() : '';

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
            overflow: 'auto',
            padding: 18,
            boxShadow: '0 10px 30px rgba(0,0,0,.25)',
            display: 'grid',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>
                🧠 {label('kiReport', lang)} · {modal.title}
              </h2>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                Spot #{modal.locationId}
                {created ? ` · ${label('createdAt', lang)}: ${created}` : ''}
              </div>
            </div>

            <button onClick={onClose} style={{ fontSize: 24, lineHeight: 1, background: 'transparent', border: 'none', cursor: 'pointer' }}>
              ×
            </button>
          </div>

          {modal.loading ? (
            <div style={{ fontSize: 14, color: '#374151' }}>{label('loadingReport', lang)}</div>
          ) : modal.error ? (
            <div style={{ fontSize: 14, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', padding: 10, borderRadius: 12 }}>
              {modal.error}
            </div>
          ) : modal.report ? (
            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
              {JSON.stringify(modal.report, null, 2)}
            </pre>
          ) : (
            <div style={{ fontSize: 14, color: '#6b7280' }}>{label('noReport', lang)}</div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              onClick={onRefresh}
              disabled={modal.loading}
              style={{
                border: 'none',
                borderRadius: 12,
                padding: '10px 14px',
                fontSize: 13,
                fontWeight: 800,
                background: '#0284c7',
                color: '#fff',
                cursor: 'pointer',
                opacity: modal.loading ? 0.6 : 1,
              }}
            >
              {label('refreshReport', lang)}
            </button>
            <button
              onClick={onClose}
              style={{
                border: '1px solid #d1d5db',
                borderRadius: 12,
                padding: '10px 14px',
                fontSize: 13,
                fontWeight: 700,
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              {label('closeModal', lang)}
            </button>
          </div>

          <p style={{ fontSize: 11, color: '#9ca3af', margin: 0 }}>
            Hinweis: Aktuell wird der Report als JSON angezeigt (Debug/MVP). UI-Rendering der Abschnitte folgt.
          </p>
        </div>
      </div>
    );
  }

  function loadGoogleMaps(language) {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.maps) return resolve();
      const existing = document.querySelector('script[data-w2h-gmaps]');
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', (ev) => reject(ev), { once: true });
        return;
      }
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=marker&language=${language}`;
      s.async = true;
      s.defer = true;
      s.dataset.w2hGmaps = '1';
      s.addEventListener('load', () => resolve(), { once: true });
      s.addEventListener('error', (ev) => reject(ev), { once: true });
      document.head.appendChild(s);
    });
  }

  function repairMojibake(s = '') {
    // eslint-disable-next-line no-undef
    return /Ã|Å|Â/.test(s) ? decodeURIComponent(escape(s)) : s;
  }

  function pickName(row, langCode) {
    const raw =
      (langCode === 'de' && row.name_de) ||
      (langCode === 'it' && row.name_it) ||
      (langCode === 'fr' && row.name_fr) ||
      (langCode === 'hr' && row.name_hr) ||
      (langCode === 'en' && row.name_en) ||
      row.display_name ||
      row.name_de ||
      row.name_en ||
      '';
    return repairMojibake(raw);
  }

  function pickDescriptionFromRow(row, langCode) {
    return (
      (langCode === 'de' && row.description_de) ||
      (langCode === 'it' && row.description_it) ||
      (langCode === 'fr' && row.description_fr) ||
      (langCode === 'hr' && row.description_hr) ||
      (langCode === 'en' && row.description_en) ||
      ''
    );
  }

  function label(key, langCode) {
    const L = {
      route: { de: 'Route', en: 'Directions', it: 'Itinerario', hr: 'Ruta', fr: 'Itinéraire' },
      website: { de: 'Website', en: 'Website', it: 'Sito', hr: 'Web', fr: 'Site' },
      call: { de: 'Anrufen', en: 'Call', it: 'Chiama', hr: 'Nazovi', fr: 'Appeler' },
      open: { de: 'Geöffnet', en: 'Open now', it: 'Aperto', hr: 'Otvoreno', fr: 'Ouvert' },
      closed: { de: 'Geschlossen', en: 'Closed', it: 'Chiuso', hr: 'Zatvoreno', fr: 'Fermé' },
      photos: { de: 'Fotos', en: 'Photos', it: 'Foto', hr: 'Fotografije', fr: 'Photos' },
      wind: { de: 'Winddaten', en: 'Wind data', it: 'Dati vento', hr: 'Podaci o vjetru', fr: 'Données vent' },
      searchResults: { de: 'Suchergebnisse', en: 'Search results', it: 'Risultati', hr: 'Rezultati', fr: 'Résultats' },
      resetSearch: { de: 'Suche aufheben', en: 'Clear search', it: 'Annulla', hr: 'Poništi', fr: 'Réinitialiser' },
      disabledCat: { de: 'Kategorie ist deaktiviert', en: 'Category is disabled', it: 'Categoria disattivata', hr: 'Kategorija isključena', fr: 'Catégorie désactivée' },
      paywalledCat: { de: 'Kategorie ist in dieser Version nicht verfügbar', en: 'Not available in this plan', it: 'Non disponibile', hr: 'Nije dostupno', fr: 'Non disponible' },

      // ✅ KI-Report UI
      kiReport: { de: 'KI-Report', en: 'AI report', it: 'Report AI', hr: 'AI izvještaj', fr: 'Rapport IA' },
      refreshReport: { de: 'Aktualisieren', en: 'Refresh', it: 'Aggiorna', hr: 'Osvježi', fr: 'Actualiser' },
      closeModal: { de: 'Schließen', en: 'Close', it: 'Chiudi', hr: 'Zatvori', fr: 'Fermer' },
      createdAt: { de: 'erstellt', en: 'created', it: 'creato', hr: 'izrađeno', fr: 'créé' },
      loadingReport: { de: 'Report wird geladen…', en: 'Loading report…', it: 'Caricamento…', hr: 'Učitavanje…', fr: 'Chargement…' },
      noReport: { de: 'Kein Report vorhanden.', en: 'No report available.', it: 'Nessun report.', hr: 'Nema izvještaja.', fr: 'Aucun rapport.' },

      // ✅ Datenblock (immer sichtbar)
      dataBlock: { de: 'Daten', en: 'Data', it: 'Dati', hr: 'Podaci', fr: 'Données' },
    };
    return (L[key] && (L[key][langCode] || L[key].en)) || key;
  }

  const DAY_OUTPUT = {
    de: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'],
    en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    it: ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'],
    fr: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'],
    hr: ['Ponedjeljak', 'Utorak', 'Srijeda', 'Četvrtak', 'Petak', 'Subota', 'Nedjelja'],
  };

  const DAY_ALIASES = new Map([
    ['monday', 0], ['mon', 0],
    ['tuesday', 1], ['tue', 1], ['tues', 1],
    ['wednesday', 2], ['wed', 2],
    ['thursday', 3], ['thu', 3], ['thur', 3], ['thurs', 3],
    ['friday', 4], ['fri', 4],
    ['saturday', 5], ['sat', 5],
    ['sunday', 6], ['sun', 6],
    ['montag', 0], ['mo', 0],
    ['dienstag', 1], ['di', 1],
    ['mittwoch', 2], ['mi', 2],
    ['donnerstag', 3], ['do', 3],
    ['freitag', 4], ['fr', 4],
    ['samstag', 5], ['sa', 5],
    ['sonntag', 6], ['so', 6],
    ['lunedì', 0], ['lunedi', 0], ['lun', 0],
    ['martedì', 1], ['martedi', 1], ['mar', 1],
    ['mercoledì', 2], ['mercoledi', 2], ['mer', 2],
    ['giovedì', 3], ['giovedi', 3], ['gio', 3],
    ['venerdì', 4], ['venerdi', 4], ['ven', 4],
    ['sabato', 5], ['sab', 5],
    ['domenica', 6], ['dom', 6],
    ['lundi', 0],
    ['mardi', 1],
    ['mercredi', 2],
    ['jeudi', 3],
    ['vendredi', 4],
    ['samedi', 5],
    ['dimanche', 6],
    ['ponedjeljak', 0], ['pon', 0],
    ['utorak', 1], ['uto', 1],
    ['srijeda', 2], ['sri', 2],
    ['četvrtak', 3], ['cetvrtak', 3], ['čet', 3], ['cet', 3],
    ['petak', 4], ['pet', 4],
    ['subota', 5], ['sub', 5],
    ['nedjelja', 6], ['ned', 6],
  ]);

  function localizeHoursLine(line = '', langCode = 'de') {
    const m = String(line).match(/^\s*([^:]+):\s*(.*)$/);
    if (!m) return line;
    const head = m[1].trim();
    const rest = m[2].trim();
    const idx = DAY_ALIASES.get(head.toLowerCase());
    if (idx === undefined) return line;
    const outDay = (DAY_OUTPUT[langCode] || DAY_OUTPUT.en)[idx];
    return `${outDay}: ${rest}`;
  }

  function localizeHoursList(list = [], langCode = 'de') {
    return list.map((ln) => localizeHoursLine(String(ln), langCode));
  }

  // Mapping per ID (bestehende Felder)
  const FIELD_MAP_BY_ID = {
    5: 'address',
    28: 'address',
    29: 'website',
    25: 'website',
    30: 'phone',
    34: 'phone',
    14: 'opening_now',
    16: 'opening_hours',
    37: 'opening_hours',
    38: 'opening_hours',
    39: 'opening_hours',
    40: 'opening_hours',
    41: 'opening_hours',
    42: 'opening_hours',
    43: 'opening_hours',
    22: 'rating',
    26: 'rating_total',
    21: 'price',
    33: 'description',
    17: 'photos',
    102: 'wind_profile',
    105: 'wind_hint',
    107: 'livewind_station',
  };

  const FIELD_MAP_BY_KEY = {
    wind_profile: 'wind_profile',
    wind_swell_profile: 'wind_profile',
    wind_profile_info: 'wind_hint',
    wind_hint: 'wind_hint',
    wind_note: 'wind_hint',
    livewind_station: 'livewind_station',
  };

  // ---- Canonical duplicate handling (Fix B) -------------------------
  const LANG_PREF = (langCode) => [langCode, 'de', 'en', 'it', 'fr', 'hr', ''];

  function toStrMaybe(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }

  function isMeaningfulValueForCanon(canon, v) {
    if (v === null || v === undefined) return false;
    if (canon === 'rating' || canon === 'rating_total' || canon === 'price') {
      const n = typeof v === 'number' ? v : Number(String(v));
      return Number.isFinite(n) && n !== 0; // 0 ist oft "leer"
    }
    const s = String(v).trim();
    if (!s) return false;

    // AI-Ausreden/Fehlermeldungen in value_text bei website/phone etc. nicht bevorzugen
    const badSnippets = [
      'entschuldigung',
      'ich kann',
      'ne mogu',
      'žao mi je',
      'je suis',
      'i am not able',
      'cannot',
      'kann den angegebenen inhalt nicht',
      'nicht übersetzen',
    ];
    const low = s.toLowerCase();
    if ((canon === 'website' || canon === 'phone') && badSnippets.some((b) => low.includes(b))) return false;

    return true;
  }

  function shouldReplaceCanon(existingVal, existingLang, candidateVal, candidateLang, canon, langCode) {
    const pref = LANG_PREF(langCode);

    const exOk = isMeaningfulValueForCanon(canon, existingVal);
    const caOk = isMeaningfulValueForCanon(canon, candidateVal);

    if (!exOk && caOk) return true;
    if (exOk && !caOk) return false;
    if (!exOk && !caOk) return false;

    const exL = (existingLang || '').toLowerCase();
    const caL = (candidateLang || '').toLowerCase();

    const exRank = pref.indexOf(exL) === -1 ? 999 : pref.indexOf(exL);
    const caRank = pref.indexOf(caL) === -1 ? 999 : pref.indexOf(caL);

    return caRank < exRank;
  }

  function setCanon(obj, canon, val, lc, langCode) {
    obj._canonLang = obj._canonLang || {};
    const existing = obj[canon];
    const existingLc = obj._canonLang[canon];

    if (existing === undefined) {
      obj[canon] = val;
      obj._canonLang[canon] = (lc || '').toLowerCase();
      return;
    }

    if (shouldReplaceCanon(existing, existingLc, val, lc, canon, langCode)) {
      obj[canon] = val;
      obj._canonLang[canon] = (lc || '').toLowerCase();
    } else if (DEBUG_LOG) {
      console.warn(`[w2h] skip weaker duplicate "${canon}"`, { existing, existingLc, candidate: val, lc });
    }
  }

  function getMarkerIcon(catId, svgMarkup) {
    if (DEBUG_MARKERS && typeof google !== 'undefined' && google.maps && google.maps.SymbolPath) {
      return { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillOpacity: 0.9, strokeWeight: 2 };
    }

    const key = String(catId ?? 'default');
    if (iconCache.current.has(key)) return iconCache.current.get(key);
    const rawSvg = svgMarkup && String(svgMarkup).trim().startsWith('<') ? svgMarkup : defaultMarkerSvg;

    const icon = {
      url: svgToDataUrl(rawSvg),
      scaledSize: new google.maps.Size(40, 40),
      anchor: new google.maps.Point(20, 40),
    };

    iconCache.current.set(key, icon);
    return icon;
  }

  function createDebugOverlay(map, locations) {
    if (!DEBUG_BOUNDING) return;
    if (typeof google === 'undefined' || !google.maps || !google.maps.OverlayView) return;

    class MarkerDebugOverlay extends google.maps.OverlayView {
      constructor(locs) {
        super();
        this.locations = locs;
        this.div = document.createElement('div');
        this.div.style.position = 'absolute';
      }

      onAdd() {
        const panes = this.getPanes();
        if (panes && panes.overlayMouseTarget) panes.overlayMouseTarget.appendChild(this.div);
      }

      draw() {
        const projection = this.getProjection();
        if (!projection || !this.locations) return;

        const size = 40;
        const html = this.locations
          .map((loc) => {
            const latLng = new google.maps.LatLng(loc.lat, loc.lng);
            const pos = projection.fromLatLngToDivPixel(latLng);
            if (!pos) return '';
            const left = pos.x - size / 2;
            const top = pos.y - size;

            return `<div style="position:absolute;left:${left}px;top:${top}px;width:${size}px;height:${size}px;border:1px solid red;box-sizing:border-box;pointer-events:none;"></div>`;
          })
          .join('');

        this.div.innerHTML = html;
      }

      onRemove() {
        if (this.div && this.div.parentNode) this.div.parentNode.removeChild(this.div);
      }
    }

    const overlay = new MarkerDebugOverlay(locations);
    overlay.setMap(map);
  }

  function normalizeGooglePhotos(val) {
    try {
      let arr = null;
      if (Array.isArray(val)) arr = val;
      else if (typeof val === 'string' && val.trim().startsWith('[')) arr = JSON.parse(val);
      if (!Array.isArray(arr)) return [];
      return arr
        .map((p) => ({
          photo_reference: p.photo_reference || p.photoreference,
          width: p.width || null,
          height: p.height || null,
          html_attributions: p.html_attributions || null,
          source: 'google',
        }))
        .filter((p) => p.photo_reference);
    } catch (errPhotos) {
      console.warn('[w2h] normalizeGooglePhotos failed', errPhotos);
      return [];
    }
  }

  function pickFirstThumb(photos) {
    if (!Array.isArray(photos) || !photos.length) return null;

    // 1) User-Fotos (verschiedene Feldnamen tolerieren)
    const user = photos.find((p) => p && (p.thumb || p.public_url || p.url || p.image_url));
    if (user) return user.thumb || user.public_url || user.url || user.image_url;

    // 2) Google-Fotos (verschiedene Feldnamen tolerieren)
    const g = photos.find(
      (p) =>
        p &&
        (p.photo_reference ||
          p.photoreference ||
          p.photoRef ||
          p.photo_ref ||
          (p.ref && typeof p.ref === 'string'))
    );

    const ref =
      (g && (g.photo_reference || g.photoreference || g.photoRef || g.photo_ref || g.ref)) || null;

    if (ref) return photoUrl(ref, 600);

    return null;
   }


  // ✅ InfoWindow HTML: eigener Datenblock immer sichtbar; KI-Report ausschließlich per Klick (Modal).
  function buildInfoContent(row, kvRaw, iconSvgRaw, langCode) {
    const kv = kvRaw && typeof kvRaw === 'object' ? kvRaw : {};
    const title = escapeHtml(pickName(row, langCode));
    const desc = escapeHtml(pickDescriptionFromRow(row, langCode) || kv.description || '');

    const addrByLang = kv.addressByLang && typeof kv.addressByLang === 'object' ? kv.addressByLang : {};
    const pref = [langCode, 'de', 'en', 'it', 'fr', 'hr'];

    let addrSel = '';
    for (const L of pref) {
      if (addrByLang[L]) {
        addrSel = addrByLang[L];
        break;
      }
    }

    // ✅ WICHTIG: Fallback auf locations.address
    const addressRaw = addrSel || kv.address || row.address || '';
    const address = escapeHtml(addressRaw);

    const website = kv.website || row.website || '';
    const phone = kv.phone || row.phone || '';

    const ratingVal = kv.rating !== undefined && kv.rating !== null && kv.rating !== '' ? kv.rating : row.rating;
    const rating = ratingVal !== undefined && ratingVal !== null && ratingVal !== '' ? Number(ratingVal) : null;

    const ratingTotal = kv.rating_total ? parseInt(kv.rating_total, 10) : null;

    // ✅ price_level in locations, "price" in kv
    const priceVal = kv.price !== undefined && kv.price !== null && kv.price !== '' ? kv.price : row.price_level;
    const priceLevel = priceVal !== undefined && priceVal !== null && priceVal !== '' ? parseInt(priceVal, 10) : null;

    const openNow = kv.opening_now === 'true' || kv.opening_now === true;

    const hoursByLang = kv.hoursByLang && typeof kv.hoursByLang === 'object' ? kv.hoursByLang : {};
    let hoursArr = null;
    for (const L of pref) {
      if (Array.isArray(hoursByLang[L]) && hoursByLang[L].length) {
        hoursArr = hoursByLang[L];
        break;
      }
    }
    const hoursLocalized = hoursArr ? localizeHoursList(hoursArr, langCode) : null;

    const photos = Array.isArray(kv.photos) ? kv.photos : [];
    const firstThumb = pickFirstThumb(photos);

    const dirHref = `https://www.google.com/maps/dir/?api=1&destination=${row.lat},${row.lng}`;
    const siteHref = website && String(website).startsWith('http') ? website : website ? `https://${website}` : '';
    const telHref = phone ? `tel:${String(phone).replace(/\s+/g, '')}` : '';

    // ✅ Icon safe render
    const iconSvg = iconSvgRaw || defaultMarkerSvg;
    const iconImg = svgToImgTag(iconSvg, 20);

    const btnRoute = `<a class="iw-btn" href="${dirHref}" target="_blank" rel="noopener">📍 ${label('route', langCode)}</a>`;
    const btnSite = siteHref
      ? `<a class="iw-btn" href="${escapeHtml(siteHref)}" target="_blank" rel="noopener">🌐 ${label('website', langCode)}</a>`
      : '';
    const btnTel = telHref ? `<a class="iw-btn" href="${escapeHtml(telHref)}">📞 ${label('call', langCode)}</a>` : '';

    let ratingHtml = '';
    if (rating !== null && !Number.isNaN(rating)) {
      const rInt = Math.max(0, Math.min(5, Math.round(rating)));
      const stars = '★'.repeat(rInt) + '☆'.repeat(5 - rInt);
      const formatted = Number.isFinite(rating) && rating.toFixed ? rating.toFixed(1) : String(rating);
      ratingHtml = `<div class="iw-row iw-rating">${stars} ${formatted}${ratingTotal ? ` (${ratingTotal})` : ''}</div>`;
    }

    let priceHtml = '';
    if (priceLevel !== null && !Number.isNaN(priceLevel)) {
      const p = Math.max(0, Math.min(4, priceLevel));
      priceHtml = `<div class="iw-row iw-price">${'€'.repeat(p || 0)}</div>`;
    }

    let openingHtml = '';
    if (kv.opening_now !== undefined) {
      openingHtml += `<div class="iw-row iw-open">${openNow ? `🟢 ${label('open', langCode)}` : `🔴 ${label('closed', langCode)}`}</div>`;
    }
    if (hoursLocalized && hoursLocalized.length) {
      openingHtml += `<ul class="iw-hours">${hoursLocalized.map((h) => `<li>${escapeHtml(String(h))}</li>`).join('')}</ul>`;
    }

    const thumbHtml = photos.length
      ? `
        <div style="margin:6px 0 10px 0;">
          ${
            firstThumb
              ? `<img src="${escapeHtml(firstThumb)}" alt="" loading="lazy" decoding="async"
                  style="width:100%;height:auto;display:block;border-radius:10px;border:1px solid #eee;background:#fafafa;" />`
              : `<div style="width:100%;border-radius:10px;border:1px dashed #cbd5e1;background:#f8fafc;
                   padding:10px;font-size:12px;color:#64748b;">
                   Fotos vorhanden (${photos.length}), Vorschau konnte nicht geladen werden.
                 </div>`
          }
        </div>
      `
      : '';


    const btnPhotos = photos.length
      ? `<button id="phbtn-${row.id}" class="iw-btn" style="background:#6b7280;">🖼️ ${label('photos', langCode)} (${photos.length})</button>`
      : '';

    const windProfile = kv.wind_profile || null;
    const hasWindProfile = !!windProfile;
    const hasWindStation = !!kv.livewind_station;
    const hasWindHint = kv.wind_hint && typeof kv.wind_hint === 'object' && Object.keys(kv.wind_hint).length > 0;
    const showWindBtn = hasWindProfile || hasWindStation || hasWindHint;

    const btnWind = showWindBtn ? `<button id="windbtn-${row.id}" class="iw-btn iw-btn-wind">💨 ${label('wind', langCode)}</button>` : '';

    // ✅ KI-Report Button (nur nach Klick; kein Preload)
    const btnKi = `<button id="kibtn-${row.id}" class="iw-btn iw-btn-ki">🧠 ${label('kiReport', langCode)}</button>`;

    // ✅ Dynamische Attribute: Gruppiert rendern (infowindow_group)
    let dynamicHtml = '';
    if (Array.isArray(kv.dynamic) && kv.dynamic.length) {
      const groups = new Map(); // groupName -> items[]
      for (const it of kv.dynamic) {
        const g = (it.group || '').trim();
        const key = g || '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(it);
      }

      const orderedGroupKeys = Array.from(groups.keys()).sort((a, b) => {
        if (!a && b) return 1;
        if (a && !b) return -1;
        return String(a).localeCompare(String(b));
      });

      const blocks = orderedGroupKeys
        .map((gk) => {
          const items = groups.get(gk) || [];
          if (!items.length) return '';

          const rows = items
            .map((it) => {
              const k = escapeHtml(it.label || it.key || '');
              const v = it.htmlValue || '';
              if (!k || !v) return '';
              return `<div class="iw-row iw-dyn-row"><span class="iw-dyn-k">${k}</span><span class="iw-dyn-v">${v}</span></div>`;
            })
            .filter(Boolean)
            .join('');

          if (!rows) return '';

          const head = gk ? `<div class="iw-dyn-group">${escapeHtml(gk)}</div>` : '';
          return `<div class="iw-dyn-block">${head}${rows}</div>`;
        })
        .filter(Boolean)
        .join('');

      if (blocks) dynamicHtml = `<div class="iw-dyn">${blocks}</div>`;
    }

    // ✅ Datenblock immer sichtbar (optische Kapselung, keine Funktionseinschränkung)
    const dataBlock = `
      <div class="iw-block iw-block-data">
        <div class="iw-block-hd">${escapeHtml(label('dataBlock', langCode))}</div>
        <div class="iw-block-bd">
          ${thumbHtml}
          ${address ? `<div class="iw-row iw-addr">📌 ${address}</div>` : ''}
          ${desc ? `<div class="iw-row iw-desc">${desc}</div>` : ''}
          ${ratingHtml}
          ${priceHtml}
          ${openingHtml}
          ${dynamicHtml}
        </div>
      </div>
    `;

    return `
      <div class="w2h-iw">
        <div class="iw-hd">
          <span class="iw-ic">${iconImg}</span>
          <div class="iw-title">
            ${title}
            <span class="iw-id">#${row.id}</span>
          </div>
        </div>

        <div class="iw-bd">
          ${dataBlock}
        </div>

        <div class="iw-actions">
          ${btnKi}${btnWind}${btnRoute}${btnSite}${btnTel}${btnPhotos}
        </div>
      </div>
    `;
  }

  // ------------------------------
  // ✅ Suche: Result-Set + Search Focus Mode
  // ------------------------------
  function normalizeTextForSearch(input) {
    const s = String(input || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ''); // diacritics
    return s.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function pickCategoryName(cat, langCode) {
    if (!cat) return '';
    const raw =
      (langCode === 'de' && cat.name_de) ||
      (langCode === 'it' && cat.name_it) ||
      (langCode === 'fr' && cat.name_fr) ||
      (langCode === 'hr' && cat.name_hr) ||
      (langCode === 'en' && cat.name_en) ||
      cat.name_de ||
      cat.name_en ||
      '';
    return String(raw || '').trim();
  }

  // ✅ Kategorie-Index aus geladenen Locations (inkl. group_key / visibility_tier)
  const categoryIndex = useMemo(() => {
    const idx = new Map(); // catId -> {id, group_key, visibility_tier, namesNorm:Set, displayName}
    const locs = locationsRef.current || [];
    for (const row of locs) {
      const c = row.categories;
      if (!c) continue;
      const id = row.category_id;
      if (id === null || id === undefined) continue;
      const key = String(id);
      if (!idx.has(key)) {
        const names = [
          pickCategoryName(c, 'de'),
          pickCategoryName(c, 'en'),
          pickCategoryName(c, 'it'),
          pickCategoryName(c, 'fr'),
          pickCategoryName(c, 'hr'),
          c.google_cat_id ? String(c.google_cat_id) : '',
        ].filter(Boolean);
        const namesNorm = new Set(names.map((n) => normalizeTextForSearch(n)).filter(Boolean));

        idx.set(key, {
          id: String(id),
          group_key: c.group_key || null,
          visibility_tier: Number.isFinite(Number(c.visibility_tier)) ? Number(c.visibility_tier) : 0,
          namesNorm,
          displayName: pickCategoryName(c, lang) || pickCategoryName(c, 'de') || pickCategoryName(c, 'en') || `#${id}`,
        });
      }
    }
    return idx;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang, selectedRegion, regions, booted]);

  function buildSearchHaystack(row, meta, langCode) {
    const parts = [];

    // names
    parts.push(row.display_name, row.name_de, row.name_en, row.name_it, row.name_fr, row.name_hr);

    // descriptions
    parts.push(row.description_de, row.description_en, row.description_it, row.description_fr, row.description_hr);

    // ids / plus codes
    parts.push(row.google_place_id, row.plus_code);

    // ✅ locations table: address/phone/website
    parts.push(row.address, row.phone, row.website);

    // category names + google type
    if (row.categories) {
      parts.push(
        pickCategoryName(row.categories, 'de'),
        pickCategoryName(row.categories, 'en'),
        pickCategoryName(row.categories, 'it'),
        pickCategoryName(row.categories, 'fr'),
        pickCategoryName(row.categories, 'hr')
      );
      if (row.categories.google_cat_id) parts.push(String(row.categories.google_cat_id));
    }

    // meta address / website / phone (optional but helpful)
    if (meta && typeof meta === 'object') {
      if (meta.address) parts.push(meta.address);
      if (meta.addressByLang && typeof meta.addressByLang === 'object') Object.values(meta.addressByLang).forEach((v) => parts.push(v));
      if (meta.website) parts.push(meta.website);
      if (meta.phone) parts.push(meta.phone);
      if (meta.description) parts.push(meta.description);
    }

    const joined = parts.filter(Boolean).join(' ');
    return normalizeTextForSearch(joined);
  }

  function scoreMatch({ hay, tokens, nameHay }) {
    // All tokens must match (AND). Score rewards tighter matches.
    let score = 0;

    for (const t of tokens) {
      if (!t) continue;

      // exact word bonus
      const wordRe = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (wordRe.test(hay)) score += 30;
      else if (hay.includes(t)) score += 15;
      else return -1; // AND requirement: token missing
    }

    // prefer name/title matches
    if (nameHay) {
      for (const t of tokens) {
        if (!t) continue;
        if (nameHay === t) score += 40;
        else if (nameHay.startsWith(t)) score += 25;
        else if (nameHay.includes(t)) score += 10;
      }
    }

    return score;
  }

  // ✅ Kategorie-Erkennung aus Query (z.B. "Porec Restaurant")
  function detectCategoriesFromQuery(qNorm) {
    const hits = [];
    if (!qNorm) return hits;
    for (const [catId, rec] of categoryIndex.entries()) {
      for (const n of rec.namesNorm) {
        if (!n) continue;
        if (qNorm === n || qNorm.includes(` ${n} `) || qNorm.endsWith(` ${n}`) || qNorm.startsWith(`${n} `) || qNorm.includes(n)) {
          hits.push({ id: catId, group_key: rec.group_key, name: rec.displayName, visibility_tier: rec.visibility_tier });
          break;
        }
      }
    }
    // dedupe
    const seen = new Set();
    return hits.filter((h) => {
      const k = `${h.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  function getGroupMembers(catHitIds) {
    // Wenn Kategorie in einer Gruppe ist -> alle IDs mit gleichem group_key zurückgeben
    const groups = new Set();
    for (const id of catHitIds) {
      const rec = categoryIndex.get(String(id));
      if (rec && rec.group_key) groups.add(String(rec.group_key));
    }
    const out = new Set(catHitIds.map((x) => String(x)));
    if (!groups.size) return Array.from(out);

    for (const [id, rec] of categoryIndex.entries()) {
      if (rec.group_key && groups.has(String(rec.group_key))) out.add(String(id));
    }
    return Array.from(out);
  }

  function isCategoryAllowedByTier(catId) {
    const rec = categoryIndex.get(String(catId));
    if (!rec) return true;
    const tier = Number(rec.visibility_tier || 0);
    return tier <= USER_VISIBILITY_TIER;
  }

  function isLayerEnabled(catId) {
    // layerState ist Map<string,bool> (catId als string)
    const v = layerState.current.get(String(catId));
    return v ?? true;
  }

  // ✅ Search Focus: Marker Visibility Override
  function enterSearchFocus(resultRows) {
    if (!mapObj.current) return;

    // Save current marker visibility
    const prev = new Map();
    for (const m of markers.current) prev.set(m, m.getVisible());
    prevVisibilityRef.current = prev;

    // Hide all, then show only results
    for (const m of markers.current) m.setVisible(false);
    for (const row of resultRows) {
      const marker = markerMapRef.current.get(row.id);
      if (marker) marker.setVisible(true);
    }

    // fitBounds
    try {
      const b = new google.maps.LatLngBounds();
      resultRows.forEach((r) => b.extend(new google.maps.LatLng(r.lat, r.lng)));
      if (!b.isEmpty()) mapObj.current.fitBounds(b, 60);
    } catch (e) {
      console.warn('[w2h] fitBounds in search focus failed', e);
    }
  }

  function exitSearchFocus() {
    // Restore marker visibility using normal layer logic
    prevVisibilityRef.current = null;
    applyLayerVisibility();
  }

  function clearSearchMode() {
    closeInfoWindow();
    setSearchMode({ active: false, query: '', results: [], message: '', matchedCategories: [] });
    exitSearchFocus();
  }

  function openResult(row) {
    const marker = markerMapRef.current.get(row.id);
    if (marker && window.google && window.google.maps && google.maps.event) {
      google.maps.event.trigger(marker, 'click');
    } else if (mapObj.current) {
      mapObj.current.panTo({ lat: row.lat, lng: row.lng });
      mapObj.current.setZoom(16);
    }
  }

  function handleSearch() {
    const raw = searchQuery.trim();
    if (!raw || !mapObj.current || !locationsRef.current.length) return;

    const qNorm = normalizeTextForSearch(raw);
    if (!qNorm) return;

    const tokens = qNorm.split(' ').filter((t) => t.length >= 2);
    if (!tokens.length) return;

    // Kategorie-Hits + Gruppen-Erweiterung
    const catHits = detectCategoriesFromQuery(` ${qNorm} `);
    const catIds = catHits.map((h) => h.id);
    const groupExpandedCatIds = catIds.length ? getGroupMembers(catIds) : [];

    // Tier-Block (Paywall)
    const tierBlocked = groupExpandedCatIds.filter((id) => !isCategoryAllowedByTier(id));
    if (catIds.length && tierBlocked.length) {
      setSearchMode({
        active: true,
        query: raw,
        results: [],
        message: `${label('paywalledCat', lang)}: ${catHits.map((h) => h.name).join(', ')}`,
        matchedCategories: catHits,
      });
      exitSearchFocus();
      return;
    }

    // Layer-Block (Deaktiviert)
    if (catIds.length) {
      const enabledAny = groupExpandedCatIds.some((id) => isLayerEnabled(id));
      if (!enabledAny) {
        setSearchMode({
          active: true,
          query: raw,
          results: [],
          message: `${label('disabledCat', lang)}: ${catHits.map((h) => h.name).join(', ')}`,
          matchedCategories: catHits,
        });
        exitSearchFocus();
        return;
      }
    }

    const results = [];
    for (const row of locationsRef.current) {
      const meta = metaByLocRef.current.get(row.id) || {};
      const hay = buildSearchHaystack(row, meta, lang);
      if (!hay) continue;

      if (catIds.length) {
        const inCat = groupExpandedCatIds.includes(String(row.category_id));
        if (!inCat) continue;
      }

      const nameHay = normalizeTextForSearch(
        [
          row.display_name,
          row.name_de,
          row.name_en,
          row.name_it,
          row.name_fr,
          row.name_hr,
          pickCategoryName(row.categories, lang),
        ]
          .filter(Boolean)
          .join(' ')
      );

      const s = scoreMatch({ hay, tokens, nameHay });
      if (s >= 0) results.push({ row, score: s });
    }

    results.sort((a, b) => b.score - a.score);
    const limited = results.slice(0, 50);

    if (!limited.length) {
      const regionLabel =
        selectedRegion === 'all'
          ? allLabel(lang)
          : pickRegionName(regions.find((r) => r.slug === selectedRegion) || { slug: selectedRegion }, lang);

      setSearchMode({
        active: true,
        query: raw,
        results: [],
        message: `Keine Treffer. Tipp: Region prüfen (aktuell: ${regionLabel}) oder Query vereinfachen.`,
        matchedCategories: catHits,
      });
      exitSearchFocus();
      return;
    }

    setSearchMode({ active: true, query: raw, results: limited, message: '', matchedCategories: catHits });
    enterSearchFocus(limited.map((x) => x.row));
  }

  // ✅ Auto-Region anhand Geolocation + Regions-Bounds (wenn regions geladen)
  useEffect(() => {
    if (!booted || !mapObj.current) return;
    if (regionMode !== 'auto') return;
    if (!regions.length) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    const onSuccess = (pos) => {
      const { latitude, longitude } = pos.coords;
      const hit = regions.find((r) => pointInRegion(latitude, longitude, r)) || null;

      if (hit) {
        setSelectedRegion(hit.slug);
        if (mapObj.current && window.google) {
          const b = boundsToLatLngBounds(hit);
          setTimeout(() => {
            try {
              mapObj.current.fitBounds(b, 40);
            } catch (e) {
              console.warn('[w2h] fitBounds failed', e);
            }
          }, 0);
        }
      } else {
        setSelectedRegion('all');
      }
    };

    const onError = (err) => {
      console.warn('[w2h] Geolocation failed/denied:', err);
      setRegionMode('manual');
    };

    navigator.geolocation.getCurrentPosition(onSuccess, onError, {
      enableHighAccuracy: false,
      timeout: 5000,
      maximumAge: 600000,
    });
  }, [booted, regionMode, regions]);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        await loadGoogleMaps(lang);
        if (cancelled || !mapRef.current) return;

        mapObj.current = new google.maps.Map(mapRef.current, {
          center: { lat: 45.6, lng: 13.8 },
          zoom: 7,
          clickableIcons: false,
          styles: GOOGLE_MAP_STYLE,
        });

        infoWin.current = new google.maps.InfoWindow();

        // ✅ Klick in die Karte schließt InfoWindow
        mapObj.current.addListener('click', () => {
          closeInfoWindow();
          infoWinOpenedByMarkerRef.current = false;
        });

        setBooted(true);
      } catch (errBoot) {
        console.error('[w2h] Google Maps load failed:', errBoot);
      }
    }

    boot();
    return () => {
      cancelled = true;
    };
  }, [lang]);

  // ✅ Regions laden (Supabase)
  useEffect(() => {
    if (!booted) return;

    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from('regions')
        .select('slug,name_de,name_en,name_it,name_fr,name_hr,bounds_north,bounds_south,bounds_east,bounds_west,sort_order,is_active')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });

      if (cancelled) return;

      if (error) {
        console.warn('[w2h] regions load failed:', error.message);
        setRegions([]);
        return;
      }

      setRegions(data || []);
    })();

    return () => {
      cancelled = true;
    };
  }, [booted]);

  useEffect(() => {
    if (!booted || !mapObj.current) return;
    loadMarkers(lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, lang, selectedRegion, regions]);

  async function loadMarkers(langCode) {
    const schema = await ensureAttributeSchema();

    // ✅ WICHTIG: address/phone/website/rating/price_level aus locations laden
    let locQuery = supabase.from('locations').select(`
        id,lat,lng,category_id,display_name,
        google_place_id,plus_code,
        address,phone,website,rating,price_level,
        name_de,name_en,name_hr,name_it,name_fr,
        description_de,description_en,description_hr,description_it,description_fr,active,
        categories:category_id ( id, icon_svg, google_cat_id, name_de, name_en, name_it, name_fr, name_hr, group_key, visibility_tier )
      `);

    const r = selectedRegion === 'all' ? null : regions.find((x) => x.slug === selectedRegion);
    if (r) {
      locQuery = locQuery.gte('lat', r.bounds_south).lte('lat', r.bounds_north).gte('lng', r.bounds_west).lte('lng', r.bounds_east);
    }

    const { data: locs, error: errLocs } = await locQuery;
    if (errLocs) {
      console.error(errLocs);
      return;
    }

    const allLocs = locs || [];
    const visibleLocs = allLocs.filter((l) => l.active !== false);

    // Dedup (place_id / plus_code / latlng)
    const seen = new Set();
    const locList = [];
    for (const row of visibleLocs) {
      const key =
        (row.google_place_id && `pid:${row.google_place_id}`) ||
        (row.plus_code && `pc:${row.plus_code}`) ||
        `ll:${row.lat?.toFixed(5)}|${row.lng?.toFixed(5)}`;
      if (seen.has(key)) {
        if (DEBUG_LOG) console.log('[w2h] skip duplicate location for key', key, 'id', row.id);
        continue;
      }
      seen.add(key);
      locList.push(row);
    }

    const locIds = locList.map((l) => l.id);

    // location_values laden
    let kvRows = [];
    if (locIds.length) {
      const { data, error } = await supabase
        .from('location_values')
        .select('location_id, attribute_id, value_text, value_number, value_option, value_bool, value_json, name, language_code')
        .in('location_id', locIds);

      if (error) console.warn('[w2h] location_values load:', error.message);
      else kvRows = data || [];
    }

    if (DEBUG_LOG) {
      console.log('[w2h] schema.byId size:', schema?.byId?.size);
      console.log('[w2h] kvRows length:', kvRows?.length);
    }

    // Aggregation pro Location
    const kvByLoc = new Map();

    function ensureDyn(obj) {
      if (!obj._dyn) obj._dyn = new Map(); // dynKey -> { def, valuesByLang: {}, any, attrId }
      return obj._dyn;
    }

    (kvRows || []).forEach((r2) => {
      const locId = r2.location_id;
      const attrId = Number(r2.attribute_id);
      if (!Number.isFinite(attrId)) return;

      if (!kvByLoc.has(locId)) kvByLoc.set(locId, {});
      const obj = kvByLoc.get(locId);

      const lc = (r2.language_code || '').toLowerCase();

      // ✅ Definition/Key aus Schema holen
      const defById = schema && schema.byId ? schema.byId.get(attrId) : null;
      const key = (defById && defById.key ? String(defById.key) : '').trim() || null;

      const canon = FIELD_MAP_BY_ID[attrId] || (key && FIELD_MAP_BY_KEY[key]);

      // 1) Canonical Fields (mit Fix B)
      if (canon) {
        if (canon === 'photos') {
          const googleArr = normalizeGooglePhotos(r2.value_json !== null && r2.value_json !== undefined ? r2.value_json : r2.value_text || null);
          if (googleArr.length) obj.photos = (obj.photos || []).concat(googleArr);
          return;
        }

        if (canon === 'wind_profile') {
          try {
            const j = r2.value_json && typeof r2.value_json === 'object' ? r2.value_json : JSON.parse(r2.value_json || '{}');
            obj.wind_profile = j || null;
          } catch (errWp) {
            console.warn('[w2h] wind_profile JSON parse failed', errWp);
            obj.wind_profile = null;
          }
          return;
        }

        if (canon === 'wind_hint') {
          obj.wind_hint = obj.wind_hint || {};
          let text = '';
          if (r2.value_text && String(r2.value_text).trim()) text = String(r2.value_text);
          else if (r2.value_json) {
            try {
              const j = typeof r2.value_json === 'object' ? r2.value_json : JSON.parse(r2.value_json);
              if (typeof j === 'string') text = j;
              else if (Array.isArray(j) && j.length) text = String(j[0]);
              else if (j && typeof j === 'object' && j.text) text = String(j.text);
            } catch (errWh) {
              console.warn('[w2h] wind_hint JSON parse failed', errWh, r2);
            }
          }
          if (lc && text) obj.wind_hint[lc] = text;
          return;
        }

        if (canon === 'livewind_station') {
          let stationId = '';
          if (r2.value_text && String(r2.value_text).trim()) stationId = String(r2.value_text).trim();
          else if (r2.value_json) {
            try {
              const j = typeof r2.value_json === 'object' ? r2.value_json : JSON.parse(r2.value_json);
              if (typeof j === 'string' || typeof j === 'number') stationId = String(j).trim();
            } catch (errLs) {
              console.warn('[w2h] livewind_station JSON parse failed', errLs, r2);
            }
          }

          const stationName = r2.name && String(r2.name).trim() ? String(r2.name).trim() : null;
          if (stationId) {
            obj.livewind_station = stationId;
            if (stationName) obj.livewind_station_name = stationName;
          }
          return;
        }

        // Value pick
        let val = null;
        if (r2.value_json !== null && r2.value_json !== undefined && r2.value_json !== '') val = r2.value_json;
        else if (r2.value_text !== null && r2.value_text !== undefined && r2.value_text !== '') val = r2.value_text;
        else if (r2.value_option !== null && r2.value_option !== undefined && r2.value_option !== '') val = r2.value_option;
        else if (r2.value_number !== null && r2.value_number !== undefined) val = r2.value_number;
        else if (r2.value_bool !== null && r2.value_bool !== undefined) val = r2.value_bool;

        if (val === null || val === undefined || val === '') return;

        // Canon per-type handling
        if (canon === 'opening_hours') {
          obj.hoursByLang = obj.hoursByLang || {};
          let arr = null;
          if (Array.isArray(val)) arr = val;
          else if (typeof val === 'string' && val.trim().startsWith('[')) {
            try {
              arr = JSON.parse(val);
            } catch {
              arr = [String(val)];
            }
          }
          if (!arr) arr = String(val).split('\n');
          if (lc) obj.hoursByLang[lc] = (obj.hoursByLang[lc] || []).concat(arr);
          else obj.hoursByLang._ = (obj.hoursByLang._ || []).concat(arr);
          return;
        }

        if (canon === 'address') {
          obj.addressByLang = obj.addressByLang || {};
          const v = toStrMaybe(val);
          if (lc) obj.addressByLang[lc] = obj.addressByLang[lc] || v;
          else obj.address = obj.address || v;
          return;
        }

        if (canon === 'description') {
          const v = toStrMaybe(val);
          if (!obj.description) obj.description = v;
          else if (lc && lc === langCode) obj.description = v;
          return;
        }

        if (canon === 'rating' || canon === 'rating_total' || canon === 'price') {
          const n = typeof val === 'number' ? val : Number(String(val));
          if (!Number.isFinite(n)) return;
          setCanon(obj, canon, n, lc, langCode);
          return;
        }

        setCanon(obj, canon, toStrMaybe(val), lc, langCode);
        return;
      }

      // 2) Dynamische Attribute
      let def = defById || null;

      if (def && def.is_active === false) return;
      if (!DYNAMIC_SMOKE_TEST && def && def.show_in_infowindow === false) return;

      if (def && schema && schema.hasVisibility && def.visibility_level !== null && def.visibility_level !== undefined) {
        const lvl = Number(def.visibility_level);
        if (!Number.isNaN(lvl) && lvl > INFO_VISIBILITY_MAX) return;
      }

      // Value-Pick
      let val = null;
      if (r2.value_json !== null && r2.value_json !== undefined && r2.value_json !== '') val = r2.value_json;
      else if (r2.value_text !== null && r2.value_text !== undefined && r2.value_text !== '') val = r2.value_text;
      else if (r2.value_option !== null && r2.value_option !== undefined && r2.value_option !== '') val = r2.value_option;
      else if (r2.value_number !== null && r2.value_number !== undefined) val = r2.value_number;
      else if (r2.value_bool !== null && r2.value_bool !== undefined) val = r2.value_bool;

      if (val === null || val === undefined || val === '') return;

      const dynKey = (key || (def && def.key) || `attr_${attrId}`).toString();
      const dyn = ensureDyn(obj);
      if (!dyn.has(dynKey)) dyn.set(dynKey, { def, valuesByLang: {}, any: null, attrId });
      const entry = dyn.get(dynKey);

      entry.any = entry.any ?? val;
      entry.attrId = entry.attrId ?? attrId;

      if (lc) entry.valuesByLang[lc] = val;
      else entry.valuesByLang._ = val;
    });

    // 3) Dyn finalisieren
    let dynCountTotal = 0;

    for (const loc of locList) {
      const obj = kvByLoc.get(loc.id) || {};

      if (obj._dyn && obj._dyn instanceof Map && obj._dyn.size) {
        const pref = [langCode, 'de', 'en', 'it', 'fr', 'hr', '_'];
        const list = [];

        for (const [k, entry] of obj._dyn.entries()) {
          const def = entry.def || null;
          const attrId = entry.attrId ?? null;

          let chosen = null;
          for (const L of pref) {
            if (entry.valuesByLang && entry.valuesByLang[L] !== undefined) {
              chosen = entry.valuesByLang[L];
              break;
            }
          }

          const v = chosen !== null && chosen !== undefined ? chosen : entry.any;
          if (v === null || v === undefined || v === '') continue;

          const labelTxt = def ? getAttrLabel(def, langCode) : DYNAMIC_SMOKE_TEST ? `Attr ${attrId}` : '';
          const htmlValue = formatDynamicValue({ def: def || {}, val: v, langCode });
          if (!labelTxt || !htmlValue) continue;

          const ord = def ? def.infowindow_order ?? def.sort_order ?? 9999 : 9999;
          const grp = def ? def.infowindow_group ?? '' : '';

          list.push({
            key: k,
            attribute_id: def ? def.attribute_id : attrId,
            sort_order: ord,
            group: grp,
            label: labelTxt,
            htmlValue,
          });
        }

        list.sort((a, b) => {
          const ga = String(a.group || '');
          const gb = String(b.group || '');
          if (ga !== gb) {
            if (!ga && gb) return 1;
            if (ga && !gb) return -1;
            return ga.localeCompare(gb);
          }
          const sa = Number(a.sort_order ?? 9999);
          const sb = Number(b.sort_order ?? 9999);
          if (sa !== sb) return sa - sb;
          return String(a.label).localeCompare(String(b.label));
        });

        obj.dynamic = list;
        dynCountTotal += list.length;
      } else {
        obj.dynamic = [];
      }

      delete obj._dyn;
      delete obj._canonLang;
      kvByLoc.set(loc.id, obj);
    }

    if (DEBUG_LOG) console.log('[w2h] dynamic total count:', dynCountTotal);

    // 🔹 Locations + Meta für Suche speichern
    locationsRef.current = locList;
    metaByLocRef.current = kvByLoc;

    // Alte Marker entfernen
    markers.current.forEach((m) => m.setMap(null));
    markers.current = [];
    markerMapRef.current = new Map();

    // Marker erzeugen
    locList.forEach((row) => {
      const title = pickName(row, langCode);
      const svg = (row.categories && row.categories.icon_svg) || defaultMarkerSvg;

      const marker = new google.maps.Marker({
        position: { lat: row.lat, lng: row.lng },
        title,
        icon: getMarkerIcon(row.category_id, svg),
        map: mapObj.current,
        zIndex: 1000 + (row.category_id || 0),
        clickable: true,
      });

      marker._cat = String(row.category_id);
      markerMapRef.current.set(row.id, marker);

      marker.addListener('click', () => {
        infoWinOpenedByMarkerRef.current = true;

        const meta = kvByLoc.get(row.id) || {};
        let html;
        try {
          html = buildInfoContent(row, meta, svg, langCode);
        } catch (errBI) {
          console.error('[w2h] buildInfoContent failed for location', row.id, errBI, { row, meta });
          html = buildErrorInfoContent(row.id);
        }

        infoWin.current.setContent(html);
        infoWin.current.open({ map: mapObj.current, anchor: marker });

        if (mapObj.current && typeof mapObj.current.panBy === 'function') {
          setTimeout(() => {
            try {
              let offsetX = 160;
              let offsetY = -140;

              if (typeof window !== 'undefined') {
                const w = window.innerWidth;
                const h = window.innerHeight;
                if (w <= 1024) {
                  offsetX = 140;
                  offsetY = -160;
                }
                if (w <= 640 && h > w) {
                  offsetX = 120;
                  offsetY = -220;
                }
              }
              mapObj.current.panBy(offsetX, offsetY);
            } catch (e) {
              console.warn('[w2h] panBy failed', e);
            }
          }, 0);
        }

        google.maps.event.addListenerOnce(infoWin.current, 'domready', () => {
          try {
            const kvNow = kvByLoc.get(row.id) || meta;

            const btn = document.getElementById(`phbtn-${row.id}`);
            if (btn) {
              btn.addEventListener('click', () => {
                const photos = kvNow.photos && Array.isArray(kvNow.photos) ? kvNow.photos : [];
                if (photos.length) setGallery({ title: pickName(row, langCode), photos });
              });
            }

            const wbtn = document.getElementById(`windbtn-${row.id}`);
            if (wbtn) {
              wbtn.addEventListener('click', () => {
                setWindModal({
                  id: row.id,
                  title: pickName(row, langCode),
                  windProfile: kvNow.wind_profile || null,
                  windHint: kvNow.wind_hint || {},
                  liveWindStation: kvNow.livewind_station || null,
                  liveWindStationName: kvNow.livewind_station_name || null,
                });
              });
            }

            // ✅ KI-Report Button (Lazy: Modal + Fetch nur nach Klick)
            const kibtn = document.getElementById(`kibtn-${row.id}`);
            if (kibtn) {
              kibtn.addEventListener('click', async () => {
                const titleNow = pickName(row, langCode);

                // Modal sofort öffnen (Loading)
                setKiModal({
                  locationId: row.id,
                  title: titleNow,
                  loading: true,
                  error: '',
                  report: null,
                  createdAt: null,
                });

                try {
                  const data = await fetchKiReport({ locationId: row.id, langCode });
                  const reportObj = data.report_json || data.report || data;
                  const createdAt = data.created_at || reportObj?.created_at || null;

                  setKiModal((prev) => ({
                    ...(prev || {}),
                    locationId: row.id,
                    title: titleNow,
                    loading: false,
                    error: '',
                    report: reportObj,
                    createdAt,
                  }));
                } catch (e) {
                  setKiModal((prev) => ({
                    ...(prev || {}),
                    locationId: row.id,
                    title: titleNow,
                    loading: false,
                    error: e?.message || 'KI-Report konnte nicht geladen werden.',
                    report: null,
                    createdAt: null,
                  }));
                }
              });
            }
          } catch (errDom) {
            console.error('[w2h] domready handler failed for location', row.id, errDom);
          }
        });
      });

      markers.current.push(marker);
    });

    if (DEBUG_BOUNDING) createDebugOverlay(mapObj.current, locList);

    // Wenn Search Focus aktiv war, neu anwenden (z.B. Region gewechselt)
    if (searchMode.active && searchMode.results && searchMode.results.length) enterSearchFocus(searchMode.results.map((x) => x.row));
    else applyLayerVisibility();

    if (DEBUG_LOG) {
      const some = locList[0];
      if (some) console.log('[w2h] sample loc', some.id, 'dynamic:', (kvByLoc.get(some.id) || {}).dynamic);
    }
  }

  function applyLayerVisibility() {
    // Wenn Search Focus aktiv: nicht überschreiben
    if (searchMode.active && prevVisibilityRef.current) return;

    markers.current.forEach((m) => {
      const vis = layerState.current.get(m._cat);
      m.setVisible(vis ?? true);
    });
  }

  // ------------------------------
  // ✅ UI: Search Results Panel
  // ------------------------------
  const resultPanelTitle = `${label('searchResults', lang)}${searchMode.active ? ` (${searchMode.results.length})` : ''}`;

  return (
    <div className="w2h-map-wrap">
      <div
        className="w2h-region-panel"
        style={{
          zIndex: 5,
          background: 'rgba(255,255,255,0.92)',
          borderRadius: 12,
          padding: '6px 8px',
          boxShadow: '0 4px 12px rgba(0,0,0,.12)',
          fontSize: 12,
        }}
      >
        <div style={{ marginBottom: 4, fontWeight: 600 }}>Region</div>
        <select
          value={selectedRegion}
          onChange={(e) => {
            const slug = e.target.value;
            setRegionMode('manual');
            setSelectedRegion(slug);

            // Bei Regionwechsel: Search Focus aufheben
            if (searchMode.active) clearSearchMode();

            if (!mapObj.current || !window.google) return;

            if (slug === 'all') {
              mapObj.current.setCenter({ lat: 45.6, lng: 13.8 });
              mapObj.current.setZoom(7);
              return;
            }

            const r = regions.find((x) => x.slug === slug);
            if (r) {
              const b = boundsToLatLngBounds(r);
              setTimeout(() => {
                try {
                  mapObj.current.fitBounds(b, 40);
                } catch (err) {
                  console.warn('[w2h] fitBounds failed', err);
                }
              }, 0);
            }
          }}
          style={{
            width: '100%',
            fontSize: 12,
            padding: '3px 6px',
            borderRadius: 8,
            border: '1px solid #d1d5db',
            marginBottom: 4,
          }}
        >
          <option value="all">{allLabel(lang)}</option>
          {regions.map((r) => (
            <option key={r.slug} value={r.slug}>
              {pickRegionName(r, lang)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            if (searchMode.active) clearSearchMode();
            setRegionMode('auto');
          }}
          style={{
            width: '100%',
            fontSize: 11,
            padding: '3px 6px',
            borderRadius: 8,
            border: '1px solid #e5e7eb',
            background: '#f3f4f6',
            cursor: 'pointer',
          }}
        >
          Auto (mein Standort)
        </button>
      </div>

      {/* Search Bar */}
      <div
        style={{
          position: 'absolute',
          top: 10,
          right: 20,
          zIndex: 10,
          background: 'rgba(255,255,255,0.92)',
          borderRadius: 9999,
          padding: '6px 10px',
          boxShadow: '0 6px 18px rgba(0,0,0,.15)',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
        }}
      >
        <input
          type="text"
          placeholder="Ort oder Name suchen…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearch();
            if (e.key === 'Escape') {
              setSearchQuery('');
              if (searchMode.active) clearSearchMode();
            }
          }}
          style={{
            border: '1px solid #d1d5db',
            borderRadius: 9999,
            padding: '4px 10px',
            fontSize: 13,
            minWidth: 220,
          }}
        />
        <button
          type="button"
          onClick={handleSearch}
          style={{
            border: 'none',
            borderRadius: 9999,
            padding: '5px 12px',
            fontSize: 13,
            fontWeight: 600,
            background: '#0284c7',
            color: '#fff',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          Suchen
        </button>

        {searchMode.active ? (
          <button
            type="button"
            onClick={clearSearchMode}
            style={{
              border: '1px solid #d1d5db',
              borderRadius: 9999,
              padding: '5px 10px',
              fontSize: 13,
              fontWeight: 600,
              background: '#fff',
              color: '#111',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
            title={label('resetSearch', lang)}
          >
            {label('resetSearch', lang)}
          </button>
        ) : null}
      </div>

      {/* Search Results Panel */}
      {searchMode.active ? (
        <div
          className="w2h-search-panel"
          style={{
            position: 'absolute',
            top: 58,
            right: 20,
            zIndex: 10,
            width: 360,
            maxWidth: '92vw',
            maxHeight: '70vh',
            overflow: 'auto',
            background: 'rgba(255,255,255,0.96)',
            borderRadius: 14,
            padding: 12,
            boxShadow: '0 10px 28px rgba(0,0,0,.18)',
            border: '1px solid rgba(0,0,0,.06)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 13 }}>{resultPanelTitle}</div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>{searchMode.query}</div>
          </div>

          {searchMode.message ? (
            <div
              style={{
                marginTop: 10,
                padding: '10px 10px',
                borderRadius: 10,
                background: '#fff7ed',
                border: '1px solid #fed7aa',
                color: '#7c2d12',
                fontSize: 12,
                lineHeight: 1.35,
              }}
            >
              {searchMode.message}
              {searchMode.matchedCategories && searchMode.matchedCategories.length ? (
                <div style={{ marginTop: 6, color: '#9a3412' }}>Hinweis: Aktiviere die Kategorie im Layer-Menü, um Ergebnisse zu sehen.</div>
              ) : null}
            </div>
          ) : null}

          {searchMode.results && searchMode.results.length ? (
            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              {searchMode.results.map(({ row, score }) => {
                const catName = row.categories ? pickCategoryName(row.categories, lang) : '';
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => openResult(row)}
                    style={{
                      textAlign: 'left',
                      border: '1px solid #e5e7eb',
                      background: '#fff',
                      borderRadius: 12,
                      padding: '10px 10px',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ fontWeight: 800, fontSize: 13 }}>{pickName(row, lang)}</div>
                      <div style={{ fontSize: 11, color: '#9ca3af' }}>#{row.id}</div>
                    </div>
                    {catName ? <div style={{ fontSize: 12, color: '#374151', marginTop: 2 }}>{catName}</div> : null}
                    <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>{Number.isFinite(score) ? `Score: ${score}` : ''}</div>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      <div ref={mapRef} className="w2h-map" />

      <LayerPanel
        lang={lang}
        onInit={(initialMap) => {
          layerState.current = new Map(initialMap);
          applyLayerVisibility();
        }}
        onToggle={(catKey, visible, meta) => {
          // ✅ Gruppenlogik: wenn LayerPanel meta.affected_category_ids liefert
          const affected = meta && Array.isArray(meta.affected_category_ids) ? meta.affected_category_ids : [catKey];

          for (const k of affected) layerState.current.set(String(k), visible);

          // Wenn Search Focus aktiv ist: nicht überschreiben
          if (!searchMode.active) applyLayerVisibility();
        }}
        onToggleAll={(visible) => {
          const updated = new Map();
          layerState.current.forEach((_v, key) => updated.set(key, visible));
          layerState.current = updated;
          if (!searchMode.active) applyLayerVisibility();
        }}
      />

      <Lightbox gallery={gallery} onClose={() => setGallery(null)} />
      <WindModal modal={windModal} onClose={() => setWindModal(null)} />

      {/* ✅ Lazy-Render: KiReportModal existiert nur wenn wirklich geöffnet */}
      {kiModal ? (
        <KiReportModal
          modal={kiModal}
          onClose={() => setKiModal(null)}
          onRefresh={async () => {
            if (!kiModal?.locationId) return;

            setKiModal((prev) => ({ ...(prev || {}), loading: true, error: '' }));
            try {
              const data = await refreshKiReport({ locationId: kiModal.locationId, langCode: lang });
              const reportObj = data.report_json || data.report || data;
              const createdAt = data.created_at || reportObj?.created_at || null;

              setKiModal((prev) => ({
                ...(prev || {}),
                loading: false,
                error: '',
                report: reportObj,
                createdAt,
              }));
            } catch (e) {
              setKiModal((prev) => ({
                ...(prev || {}),
                loading: false,
                error: e?.message || 'Aktualisieren fehlgeschlagen.',
              }));
            }
          }}
        />
      ) : null}

      <style jsx>{`
        .w2h-map-wrap {
          position: relative;
          height: 100vh;
          width: 100%;
        }
        .w2h-map {
          height: 100%;
          width: 100%;
        }
        .w2h-region-panel {
          position: absolute;
          top: 64px;
          left: 50%;
          transform: translateX(-50%);
          min-width: 210px;
          max-width: 320px;
        }
        @media (max-width: 640px) {
          .w2h-region-panel {
            top: 80px;
            right: 10px;
            left: auto;
            transform: none;
            min-width: 170px;
            max-width: 230px;
            width: 60vw;
          }
          .w2h-search-panel {
            top: 110px !important;
            right: 10px !important;
            width: min(92vw, 360px) !important;
            max-height: 62vh !important;
          }
        }
      `}</style>

      <style jsx global>{`
        .gm-style .w2h-iw {
          max-width: 340px;
          font: 13px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
          color: #1a1a1a;
        }
        .gm-style .w2h-iw .iw-hd {
          display: grid;
          grid-template-columns: 22px 1fr;
          gap: 8px;
          align-items: center;
          margin-bottom: 6px;
        }
        .gm-style .w2h-iw .iw-ic img {
          width: 20px;
          height: 20px;
          display: block;
        }
        .gm-style .w2h-iw .iw-title {
          font-weight: 700;
          font-size: 14px;
        }
        .gm-style .w2h-iw .iw-id {
          font-weight: 400;
          font-size: 11px;
          color: #9ca3af;
          margin-left: 4px;
        }
        .gm-style .w2h-iw .iw-row {
          margin: 6px 0;
        }
        .gm-style .w2h-iw .iw-desc {
          color: #444;
          white-space: normal;
        }
        .gm-style .w2h-iw .iw-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 10px;
        }
        .gm-style .w2h-iw .iw-btn {
          display: inline-block;
          padding: 6px 10px;
          border-radius: 8px;
          background: #1f6aa2;
          color: #fff;
          text-decoration: none;
          font-weight: 600;
          font-size: 12px;
          cursor: pointer;
          border: none;
        }
        .gm-style .w2h-iw .iw-btn:hover {
          filter: brightness(0.95);
        }
        .gm-style .w2h-iw .iw-btn-wind {
          background: #0ea5e9;
        }
        .gm-style .w2h-iw .iw-btn-ki {
          background: #111827;
        }
        .gm-style .w2h-iw .iw-btn-ki:hover {
          filter: brightness(1.05);
        }
        .gm-style .w2h-iw .iw-rating {
          font-size: 13px;
          color: #f39c12;
        }
        .gm-style .w2h-iw .iw-price {
          font-size: 13px;
          color: #27ae60;
        }
        .gm-style .w2h-iw .iw-open {
          font-size: 13px;
        }
        .gm-style .w2h-iw .iw-hours {
          padding-left: 16px;
          margin: 4px 0;
        }

        /* ✅ Datenblock (immer sichtbar) */
        .gm-style .w2h-iw .iw-block {
          border: 1px solid #eef2f7;
          background: #ffffff;
          border-radius: 12px;
          padding: 10px;
        }
        .gm-style .w2h-iw .iw-block-hd {
          font-weight: 900;
          font-size: 12px;
          letter-spacing: 0.2px;
          color: #111;
          margin-bottom: 6px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .gm-style .w2h-iw .iw-block-bd {
          display: block;
        }

        /* ✅ Dynamische Attribute */
        .gm-style .w2h-iw .iw-dyn {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid #eee;
          display: grid;
          gap: 10px;
        }
        .gm-style .w2h-iw .iw-dyn-block {
          display: grid;
          gap: 6px;
        }
        .gm-style .w2h-iw .iw-dyn-group {
          font-weight: 800;
          font-size: 12px;
          letter-spacing: 0.2px;
          color: #111;
          margin-top: 2px;
        }
        .gm-style .w2h-iw .iw-dyn-row {
          display: grid;
          grid-template-columns: 1fr 1.2fr;
          gap: 10px;
          align-items: start;
        }
        .gm-style .w2h-iw .iw-dyn-k {
          font-weight: 600;
          color: #111;
        }
        .gm-style .w2h-iw .iw-dyn-v {
          color: #374151;
          word-break: break-word;
        }
        .gm-style .w2h-iw .iw-dyn-v a {
          color: #1f6aa2;
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
