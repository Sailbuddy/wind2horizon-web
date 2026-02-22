'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import LayerPanel from '@/components/LayerPanel';
import { defaultMarkerSvg } from '@/components/DefaultMarkerSvg';
import { svgToDataUrl } from '@/lib/utils';
import { hydrateUserPhotos } from '@/lib/w2h/userPhotosHydrate';
import WelcomeOverlay from './welcomeOverlay';
import { initFloatingTools } from '@/lib/w2h/ui/floatingTools.js';
import { floatingToolsTranslations } from '@/lib/w2h/ui/floatingTools.i18n.js';
import PanelHost from '@/components/panels/PanelHost';
import BoraPanel from '@/components/panels/BoraPanel';
import { boraTexts } from '@/lib/i18n/boraTexts';
import SeaWeatherPanel from '@/components/panels/SeaWeatherPanel';





// 🔧 Debug-Schalter
const DEBUG_MARKERS = false; // true = einfache Kreis-Symbole statt SVG
const DEBUG_BOUNDING = false; // true = rote Bounding-Boxen über den Markern
const DEBUG_LOG = false; // true = extra Console-Logs

// 🔒 Sichtbarkeit dynamischer Attribute (falls Spalte vorhanden)
// 0 = öffentlich, 1 = erweitert, 2+ = intern (Beispiel). Passe bei Bedarf an.
const INFO_VISIBILITY_MAX = 1;

// ✅ Smoke-Test: zeigt dynamische Werte auch ohne attribute_definitions (Fallback-Label)
// Zusätzlich: übersteuert show_in_infowindow-Filter (zeigt auch wenn false)
const DYNAMIC_SMOKE_TEST = false;

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

  const s = normBool(swell);
  const w = normBool(wind);

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
  const [locVersion, setLocVersion] = useState(0);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [welcomeClosed, setWelcomeClosed] = useState(false);
  const [activePanel, setActivePanel] = useState(null);
  const [seaWarning, setSeaWarning] = useState(null);
  const [seaWarningClosed, setSeaWarningClosed] = useState(false);

  function closeSeaWarning() {
    if (seaWarning?.issuedAt) {
      localStorage.setItem('w2h_sea_warning_issued', seaWarning.issuedAt);
    }
    setSeaWarningClosed(true);
  }

  useEffect(() => {
  console.log('[w2h] activePanel changed →', activePanel);
}, [activePanel]);

  // 🔹 Marker-Map & Locations für Suche
  const markerMapRef = useRef(new Map()); // location_id -> Marker
  const locationsRef = useRef([]); // aktuell sichtbare Locations (nach Deduplizierung)

  // 🔹 Meta pro Location (für Suche/InfoWindow)
  const metaByLocRef = useRef(new Map()); // location_id -> aggregated meta (kv)

  // 🔹 Attribute-Definitionen Cache (dynamische InfoWindow-Felder)
  // { byId: Map<number, def>, byKey: Map<string, def>, hasVisibility: bool }
  const attrSchemaRef = useRef(null);

useEffect(() => {
  if (process.env.NODE_ENV !== 'development') return;
  console.log("W2H MAP KEY present?", !!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);
  console.log("W2H MAP KEY prefix:", process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.slice(0, 6));
}, []);

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

  // ✅ Locate UI
  const [locateBusy, setLocateBusy] = useState(false);
  const [locateErr, setLocateErr] = useState('');

  // ✅ User Location / Locate UI Refs
  const userPosRef = useRef(null); // { lat, lng, accuracy }
  const userMarkerRef = useRef(null);
  const userAccuracyCircleRef = useRef(null);

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

  // Load SeaWarning 
  //------------------------------
  
  async function loadSeaWarning(lang) {
    const l = (lang === 'fr') ? 'en' : lang;

    const url = `/api/seewetter?lang=${encodeURIComponent(l)}&t=${Date.now()}`;

    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache'
      }
    });

    const data = await res.json();
    if (!data?.ok) return null;

      const issuedAt = data?.issuedAt;
      const warning = data?.blocks?.warning?.text?.trim();
      const synopsis = data?.blocks?.synopsis?.text?.trim() || '';

    if (!issuedAt || !warning) return null;

    return {
      issuedAt,
      warning,
      synopsis,
      sourceUrl: data.sourceUrl,
    };
  }



  // ---------------------------------------------
  // Helpers: Google Photo Proxy + HTML escaper
  // ---------------------------------------------
  const photoUrl = (ref, max = 800, row) =>
    `/api/gphoto?photo_reference=${encodeURIComponent(ref)}&maxwidth=${max}` +
    (row?.google_place_id ? `&place_id=${encodeURIComponent(row.google_place_id)}` : '') +
    (row?.id ? `&location_id=${encodeURIComponent(String(row.id))}` : '');

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

    // unwrap meta wrapper objects/arrays
    val = unwrapMetaValue(val, langCode);

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
  // ✅ Locate helpers (Marker + Accuracy-Kreis + Centering + Geolocation)
  // ------------------------------
  function upsertUserMarker(lat, lng) {
    if (!mapObj.current || !window.google) return;

    const pos = { lat, lng };

    if (!userMarkerRef.current) {
      userMarkerRef.current = new google.maps.Marker({
        position: pos,
        map: mapObj.current,
        clickable: false,
        zIndex: 999999,
        title: 'Mein Standort',
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 6,
          fillOpacity: 1,
          strokeWeight: 2,
        },
      });
    } else {
      userMarkerRef.current.setPosition(pos);
      if (!userMarkerRef.current.getMap()) userMarkerRef.current.setMap(mapObj.current);
    }
  }

  function upsertAccuracyCircle(lat, lng, accuracyMeters, enabled = true) {
    if (!mapObj.current || !window.google) return;

    if (!enabled || !Number.isFinite(Number(accuracyMeters)) || Number(accuracyMeters) <= 0) {
      if (userAccuracyCircleRef.current) userAccuracyCircleRef.current.setMap(null);
      userAccuracyCircleRef.current = null;
      return;
    }

    const center = { lat, lng };
    const radius = Math.max(5, Number(accuracyMeters));

    if (!userAccuracyCircleRef.current) {
      userAccuracyCircleRef.current = new google.maps.Circle({
        map: mapObj.current,
        center,
        radius,
        clickable: false,
        zIndex: 999998,
        strokeOpacity: 0.25,
        strokeWeight: 1,
        fillOpacity: 0.08,
      });
    } else {
      userAccuracyCircleRef.current.setCenter(center);
      userAccuracyCircleRef.current.setRadius(radius);
      if (!userAccuracyCircleRef.current.getMap()) userAccuracyCircleRef.current.setMap(mapObj.current);
    }
  }

  function centerMapOn(lat, lng, opts = {}) {
    if (!mapObj.current) return;
    const { zoom = 12, pan = true } = opts;
    const pos = { lat, lng };

    try {
      if (pan && typeof mapObj.current.panTo === 'function') mapObj.current.panTo(pos);
      else mapObj.current.setCenter(pos);

      const z = mapObj.current.getZoom?.();
      if (!Number.isFinite(z) || z < zoom) mapObj.current.setZoom(zoom);
    } catch (e) {
      console.warn('[w2h] centerMapOn failed', e);
    }
  }

  async function requestAndApplyGeolocation({ reason = 'auto', alsoSetAutoRegion = true, showAccuracy = true } = {}) {
    if (!mapObj.current) return false;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return false;

    const onSuccess = (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;

      userPosRef.current = { lat: latitude, lng: longitude, accuracy: Number(accuracy || 0) };

      // ✅ 1) Immer auf echte Position zentrieren
      centerMapOn(latitude, longitude, { zoom: reason === 'button' ? 13 : 12, pan: true });

      // ✅ 2) Marker + optional Accuracy-Kreis
      upsertUserMarker(latitude, longitude);
      upsertAccuracyCircle(latitude, longitude, accuracy, showAccuracy);

      // ✅ 3) Optional: Auto-Region zusätzlich anwenden (wenn regions vorhanden)
      if (alsoSetAutoRegion && regions && regions.length) {
        const hit = regions.find((r) => pointInRegion(latitude, longitude, r)) || null;

        if (hit) {
          setSelectedRegion(hit.slug);
          try {
            const b = boundsToLatLngBounds(hit);
            setTimeout(() => {
              try {
                mapObj.current?.fitBounds(b, 40);
              } catch (e) {
                console.warn('[w2h] fitBounds (auto-region) failed', e);
              }
            }, 0);
          } catch (e) {
            console.warn('[w2h] fitBounds (auto-region) failed', e);
          }
        } else {
          setSelectedRegion('all');
        }
      }
    };

    const onError = (err) => {
      const code = err?.code;
      const msg = err?.message || '';
      console.warn('[w2h] Geolocation failed/denied:', { code, message: msg });

      // UI-Hinweis nur, wenn User aktiv klickt (bei Auto-Init möglichst still)
      if (reason === 'button') {
        if (code === 1) setLocateErr('Standortzugriff wurde abgelehnt.');
        else if (code === 2) setLocateErr('Standort aktuell nicht verfügbar.');
        else if (code === 3) setLocateErr('Standortabfrage ist abgelaufen.');
        else setLocateErr('Standortabfrage fehlgeschlagen.');
      }
    };

    navigator.geolocation.getCurrentPosition(onSuccess, onError, {
      enableHighAccuracy: reason === 'button',
      timeout: 12000,
      maximumAge: 300000,
    });

    return true;
  }

  // ------------------------------
  //Sprachauswahl zur Weiterleitung auf die jeweilige Seite
  // ------------------------------
  
  const goLang = (code) => {
  // gleiche Seite, nur Sprach-Prefix tauschen: /de, /en, /it, /fr, /hr
  const path = window.location.pathname || '/';
  const parts = path.split('/').filter(Boolean);

  // Wenn bereits /de|/en|/it|/hr vorne steht -> ersetzen, sonst vorne einfügen
  const supported = new Set(['de', 'en', 'it', 'fr', 'hr']);
  if (parts.length > 0 && supported.has(parts[0])) {
    parts[0] = code;
  } else {
    parts.unshift(code);
  }

  const newPath = '/' + parts.join('/') + window.location.search + window.location.hash;

  // harter Redirect (robust in allen Umgebungen)
  window.location.href = newPath;
};


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
  const ref = String(p.photo_reference || p.photoreference || '').trim();
  const w = Math.min(1200, Number(p.width || 0) || 640);

  // ✅ Fix 2: URL sicher bauen (encoding), ohne photoUrl()
  const qs = new URLSearchParams();
  qs.set('photo_reference', ref);
  qs.set('maxwidth', String(w));

  const placeId = g?.row?.google_place_id ? String(g.row.google_place_id).trim() : '';
  const locationId = g?.row?.id ? String(g.row.id).trim() : '';

  if (placeId) qs.set('place_id', placeId);
  if (locationId) qs.set('location_id', locationId);

  const u = `/api/gphoto?${qs.toString()}`;

  // ✅ Debug (wie bei dir)
  console.log('[dbg:lightbox]', { idx, ref, w, url: u });

  src = u;
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
            <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 6, color: '#111827' }}>
              {langCode === 'de' ? 'Highlights' : 'Highlights'}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#374151' }}>
              {highlights.map((h, i) => (
                <li key={`${h}-${i}`}>{String(h)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {rows.length ? (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 8, color: '#111827' }}>
              {langCode === 'de' ? 'Praktische Infos' : 'Practical info'}
            </div>

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
            <div style={{ fontSize: 12, fontWeight: 900, marginBottom: 8, color: '#111827' }}>
              {langCode === 'de' ? 'Attribute' : 'Attributes'}
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              {attrs.map((a, idx) => (
                <div key={`${a.label || 'attr'}-${idx}`} style={{ borderTop: idx ? '1px solid #f1f5f9' : 'none', paddingTop: idx ? 10 : 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 900, color: '#111827' }}>{a.label || ''}</div>
                  <div style={{ fontSize: 13, color: '#374151', marginTop: 4, whiteSpace: 'pre-wrap' }}>
                    {typeof a.value === 'object' ? JSON.stringify(a.value, null, 2) : String(a.value ?? '')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
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
            <div>
              {renderKiReportPretty(modal.report, lang)}
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: 'pointer', fontSize: 12, color: '#64748b' }}>Debug: JSON anzeigen</summary>
                <pre
                  style={{
                    marginTop: 8,
                    whiteSpace: 'pre-wrap',
                    fontSize: 12,
                    background: '#f9fafb',
                    border: '1px solid #e5e7eb',
                    borderRadius: 12,
                    padding: 12,
                  }}
                >
                  {JSON.stringify(modal.report, null, 2)}
                </pre>
              </details>
            </div>
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
      searchPlaceholder: {
      de: 'Ort oder Name suchen…',
      en: 'Search place or name…',
      it: 'Cerca luogo o nome…',
      hr: 'Traži mjesto ili naziv…',
      fr: 'Rechercher un lieu ou un nom…',

  },

      welcomeIntro: {
      de: 'Willkommen an Bord. Ein kurzer Überblick – dann geht’s direkt zur Karte.',
      en: 'Welcome aboard. A short overview – then straight to the map.',
      it: 'Benvenuto a bordo. Una breve panoramica – poi direttamente alla mappa.',
      hr: 'Dobrodošli na brod. Kratki pregled – zatim izravno na kartu.',
      fr: 'Bienvenue à bord. Un bref aperçu – puis directement à la carte.',
      },

      welcomeBullet1: {
      de: 'Interaktive Karte mit nautischem Fokus',
      en: 'Interactive map with nautical focus',
      it: 'Mappa interattiva con focus nautico',
      hr: 'Interaktivna karta s nautičkim fokusom',
      fr: 'Carte interactive avec focus nautique',
      },

      welcomeBullet2: {
      de: 'Wind- & Wetterinfos direkt am Ort',
      en: 'Wind & weather information directly on site',
      it: 'Informazioni su vento e meteo direttamente sul posto',
      hr: 'Podaci o vjetru i vremenu izravno na lokaciji',
      fr: 'Informations vent et météo directement sur place',
      },

      welcomeBullet3: {
      de: 'Erlebnisse, Häfen und Tipps entlang der Adria',
      en: 'Experiences, harbors and tips along the Adriatic',
      it: 'Esperienze, porti e consigli lungo l’Adriatico',
      hr: 'Doživljaji, luke i savjeti duž Jadrana',
      fr: 'Expériences, ports et conseils le long de l’Adriatique',
      },

      welcomeButton: {
      de: 'Zur Karte',
      en: 'To the map',
      it: 'Alla mappa',
      hr: 'Na kartu',
      fr: 'Vers la carte',
      },

      close: {
      de: 'Schließen',
      en: 'Close',
      it: 'Chiudi',
      hr: 'Zatvori',
      fr: 'Fermer',
      },
 
      searchButton: {
      de: 'Suchen',
      en: 'Search',
      it: 'Cerca',
      hr: 'Traži',
      fr: 'Rechercher',
  },

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
    // 1) bestehende Inline-Labels (UI)
    const hit = L[key] && (L[key][langCode] || L[key].en);
    if (hit) return hit;

    // 2) Bora-Texts (externes Dictionary)
    const b =
      (boraTexts?.[langCode] && boraTexts[langCode][key]) ||
      (boraTexts?.en && boraTexts.en[key]) ||
      (boraTexts?.de && boraTexts.de[key]);

    if (typeof b === 'string' && b.trim()) return b;

    // 3) Fallback: Key zurückgeben (Debug sichtbar)
    return key;

    } // ✅ label() endet hier


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

  /**
   * Robust “Unwrap” für eure Value-Formate:
   * - Arrays wie [true,{ai:false},...] -> true
   * - Objekte wie {value: "...", ai:false} -> "..."
   * - Übersetzungsobjekte {de:"..",en:".."} oder {text:".."} -> best match
   * - reine Metaobjekte -> null
   */
  function unwrapMetaValue(v, preferredLang = 'de') {
    if (v === null || v === undefined) return null;

    // 1) Array-Wrapper: nur für skalare Meta-Wrapper [value,{ai/...},...] entpacken.
    // Strukturierte Arrays (z. B. Google Photos) bleiben Arrays.
    if (Array.isArray(v)) {
      if (v.length === 0) return null;

      const primary = v[0];
      const looksScalar =
        primary === null ||
        primary === undefined ||
        typeof primary === 'string' ||
        typeof primary === 'number' ||
        typeof primary === 'boolean';

      const looksMeta =
        v.length >= 2 &&
        v.slice(1).some((m) => m && typeof m === 'object' && !Array.isArray(m) && ('ai' in m || 'by' in m || 'ts' in m || 'source' in m));

      if (looksScalar && looksMeta) {
        return unwrapMetaValue(primary, preferredLang);
      }

      return v;
    }

    // 2) Primitive
    if (typeof v !== 'object') return v;

    // 3) Objekt mit value/text
    if ('value' in v) return unwrapMetaValue(v.value, preferredLang);
    if (typeof v.text === 'string' && v.text.trim()) return v.text;

    // 4) Übersetzungsobjekte: de/en/hr/it/fr ...
    for (const k of [preferredLang, 'de', 'en', 'hr', 'it', 'fr']) {
      if (k in v) return unwrapMetaValue(v[k], preferredLang);
    }

    // 5) Spezialfall { tr: ... }
    if ('tr' in v) return unwrapMetaValue(v.tr, preferredLang);

    // 6) Meta-only => nicht anzeigen
    const keys = Object.keys(v);
    const metaKeys = new Set(['ai', 'by', 'ts', 'source', 'sources', 'meta', 'confidence']);
    if (keys.length && keys.every((k) => metaKeys.has(k))) return null;

    // 7) sonst: Objekt zurückgeben (wird später JSON-stringified falls nötig)
    return v;
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
      const ex = String(existing ?? '');
      const ca = String(val ?? '');
      // Nur loggen, wenn wirklich unterschiedlich (sonst Console-Spam)
      if (ex.trim() !== ca.trim()) {
        console.warn(`[w2h] skip weaker duplicate "${canon}"`, { existing, existingLc, candidate: val, lc });
      }
    }
  }

  function getMarkerIcon(catId, svgMarkup) {
    if (DEBUG_MARKERS && typeof google !== 'undefined' && google.maps && google.maps.SymbolPath) {
      return { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillOpacity: 0.9, strokeWeight: 2 };
    }

    const key = String(catId ?? 'default');
    if (iconCache.current.has(key)) return iconCache.current.get(key);
    const rawSvg = svgMarkup && String(svgMarkup).trim().startsWith('<') ? svgMarkup : defaultMarkerSvg;

    let url;
    try {
      url = svgToDataUrl(rawSvg);
    } catch (e) {
      if (DEBUG_LOG) console.error('[w2h] svgToDataUrl failed – falling back to default marker', e);
      return undefined;
    }

    const icon = {
      url,
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

  function pickFirstThumb(photos, row) {
    if (!Array.isArray(photos) || !photos.length) return null;

    // 1) User-Fotos
    const user = photos.find((p) => p && (p.thumb || p.public_url || p.url || p.image_url));
    if (user) return user.thumb || user.public_url || user.url || user.image_url;

    // 2) Google-Fotos
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

    if (ref) return photoUrl(ref, 600, row);

    return null;
  }

  // ✅ InfoWindow HTML: eigener Datenblock immer sichtbar; KI-Report ausschließlich per Klick (Modal).
  function buildInfoContent(row, kvRaw, iconSvgRaw, langCode) {
    const kv = kvRaw && typeof kvRaw === 'object' ? kvRaw : {};
    const title = escapeHtml(pickName(row, langCode));
    const rawDesc = pickDescriptionFromRow(row, langCode) || unwrapMetaValue(kv.description, langCode) || '';
    const desc = escapeHtml(toStrMaybe(rawDesc));

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

    const googlePhotos = Array.isArray(kv.photos) ? kv.photos : [];
    const userThumb = kv.user_photo_thumb || '';
    const userCount = Number(kv.user_photo_count || 0);

    const firstThumb = userThumb || pickFirstThumb(googlePhotos, row);
    const totalPhotos = googlePhotos.length + userCount;
    const btnPhotos = totalPhotos
      ? `<button id="phbtn-${row.id}" class="iw-btn">🖼️ ${label('photos', langCode)} (${totalPhotos})</button>`
      : '';

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

    const thumbHtml = totalPhotos
      ? `
        <div style="margin:6px 0 10px 0;">
          ${
            firstThumb
              ? `<img src="${escapeHtml(firstThumb)}" alt="" loading="lazy" decoding="async"
                  style="width:100%;height:auto;display:block;border-radius:10px;border:1px solid #eee;background:#fafafa;" />`
              : `<div style="width:100%;border-radius:10px;border:1px dashed #cbd5e1;background:#f8fafc;
                   padding:10px;font-size:12px;color:#64748b;">
                   Fotos vorhanden (${totalPhotos}), Vorschau konnte nicht geladen werden.
                 </div>`
          }
        </div>
      `
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
  }, [lang, selectedRegion, regions, booted, locVersion]);

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
    const prev = prevVisibilityRef.current;
    if (prev) {
      for (const m of markers.current) {
        const v = prev.get(m);
        if (v !== undefined) m.setVisible(v);
      }
    } else {
      applyLayerVisibility();
    }
    prevVisibilityRef.current = null;
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

  // ✅ Aktive Layer-Kategorien (UI-Checkboxes) als Basisfilter
  const activeLayerCatIds = new Set();
  if (layerState?.current) {
    layerState.current.forEach((isOn, catId) => {
      if (isOn) activeLayerCatIds.add(String(catId));
    });
  }

  // Kategorie-Hits + Gruppen-Erweiterung (aus Query)
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

  // Layer-Block (Deaktiviert) – nur wenn Query explizite Kategorien enthält
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

    // ✅ 1) Basisfilter: nur Kategorien, die im Layer-Panel aktiv sind
    // (Wenn activeLayerCatIds leer wäre, lassen wir alles durch – sollte praktisch nicht passieren.)
    const rowCatId = String(row.category_id);
    if (activeLayerCatIds.size && !activeLayerCatIds.has(rowCatId)) continue;

    // ✅ 2) Zusatzfilter: wenn Query Kategorie nennt, weiter einschränken (Intersection)
    if (catIds.length) {
      const inCat = groupExpandedCatIds.includes(rowCatId);
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

    // ✅ Hinweis: Layerfilter kann Ursache sein (nur wenn nicht "alle" aktiv sind)
    const layerHint =
      activeLayerCatIds.size && activeLayerCatIds.size < (layerState?.current?.size || activeLayerCatIds.size)
        ? ' Tipp: Kategorie-Layer prüfen (evtl. sind passende Kategorien deaktiviert).'
        : '';

    setSearchMode({
      active: true,
      query: raw,
      results: [],
      message: `Keine Treffer. Tipp: Region prüfen (aktuell: ${regionLabel}) oder Query vereinfachen.${layerHint}`,
      matchedCategories: catHits,
    });
    exitSearchFocus();
    return;
  }

  setSearchMode({ active: true, query: raw, results: limited, message: '', matchedCategories: catHits });
  enterSearchFocus(limited.map((x) => x.row));
}


 // ❌ Auto-Geolocation beim Boot deaktiviert (wird nach Welcome ausgelöst)


  //Neuer Auto-Geolocation Trigger nach Overlay
  useEffect(() => {
    if (!mapLoaded) return;
    if (regionMode !== 'auto') return;
    if (!welcomeClosed) return;

    requestAndApplyGeolocation({
      reason: 'auto_after_welcome',
      alsoSetAutoRegion: true,
      showAccuracy: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLoaded, regionMode, welcomeClosed]);

  useEffect(() => {
    if (!mapLoaded) return;
    if (regionMode !== 'auto') return;
    if (!welcomeClosed) return;

    let alive = true;

    (async () => {
      try {
        const lastSeen = localStorage.getItem('w2h_sea_warning_issued');

        const sw = await loadSeaWarning(lang);
        if (!alive || !sw) return;

        // nur wenn neu
        if (lastSeen === sw.issuedAt) return;

        setSeaWarning(sw);
        setSeaWarningClosed(false);
      } catch (e) {
        console.warn('[w2h] seewetter warning fetch failed', e);
      }
    })();

  return () => { alive = false; };
  }, [mapLoaded, regionMode, welcomeClosed, lang]);


  // ✅ Sobald Regions geladen sind: wenn wir schon eine Position haben -> Region nachziehen
  useEffect(() => {
    if (!booted || !mapObj.current) return;
    if (regionMode !== 'auto') return;
    if (!regions.length) return;

    const p = userPosRef.current;
    if (!p) return;

    const hit = regions.find((r) => pointInRegion(p.lat, p.lng, r)) || null;
    if (hit) setSelectedRegion(hit.slug);
    else setSelectedRegion('all');
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

        // Map idle Event setzen
        window.google.maps.event.addListenerOnce(mapObj.current, 'idle', () => {
        setMapLoaded(true);
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
      try {
        if (userMarkerRef.current) userMarkerRef.current.setMap(null);
        userMarkerRef.current = null;
        if (userAccuracyCircleRef.current) userAccuracyCircleRef.current.setMap(null);
        userAccuracyCircleRef.current = null;
      } catch {
        // ignore
      }
    };
  }, [lang]);

  const floatingCleanupRef = useRef(null);

useEffect(() => {
  if (!booted) return;
  if (!mapRef.current) return; // wichtig: Container prüfen, nicht mapObj

  // Bei Sprachwechsel alte FloatingTools entfernen
  if (typeof floatingCleanupRef.current === 'function') {
    floatingCleanupRef.current();
    floatingCleanupRef.current = null;
  }

  const texts = floatingToolsTranslations?.[lang];

  floatingCleanupRef.current = initFloatingTools({
    mapContainer: mapRef.current, // WICHTIG: Container, nicht mapObj
    langCode: lang,
    texts,
    actions: {
      onOpenBoraOverlay: () => {
        setActivePanel((p) => (p === 'bora' ? null : 'bora'));
      },
      openSeaWeather: () => {
        setActivePanel((p) => (p === 'seewetter' ? null : 'seewetter'));
      },
    },
  });

  return () => {
    if (typeof floatingCleanupRef.current === 'function') {
      floatingCleanupRef.current();
      floatingCleanupRef.current = null;
    }
  };
}, [booted, lang]);


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
    // ------------------------------
    // ✅ User-Photos Meta (Count + First Preview URL) aus public.user_photos
    // ------------------------------
    let userPhotoRows = [];
    if (locIds.length) {
      const { data: up, error: upErr } = await supabase
        .from('user_photos')
        .select('location_id, public_url, created_at, source_tag')
        .in('location_id', locIds)
        .order('created_at', { ascending: false });

      if (upErr) {
        console.warn('[w2h] user_photos meta load failed:', upErr.message, upErr);
        userPhotoRows = [];
      } else {
        userPhotoRows = up || [];
      }

      if (DEBUG_LOG) {
        console.log('[w2h] user_photos meta rows:', userPhotoRows.length, userPhotoRows.slice(0, 3));
      }
    }

    // Map: location_id -> { count, firstUrl }
    const userPhotoMeta = new Map();
    for (const p of userPhotoRows) {
      const id = Number(p.location_id);
      if (!Number.isFinite(id)) continue;

      if (!userPhotoMeta.has(id)) userPhotoMeta.set(id, { count: 0, firstUrl: '' });
      const rec = userPhotoMeta.get(id);

      rec.count += 1;
      // Da wir created_at DESC laden, ist das erste Vorkommen das "neueste" Foto
      if (!rec.firstUrl && p.public_url) rec.firstUrl = String(p.public_url);

      if (!rec.aiCount) rec.aiCount = 0;
      const st = String(p.source_tag || '').toLowerCase();
      if (st.includes('ai')) rec.aiCount += 1;
    }

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
      try {
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

          // unwrap {value,ai:false} etc.
          val = unwrapMetaValue(val, langCode);

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

        // unwrap {value,ai:false} etc.
        val = unwrapMetaValue(val, langCode);

        if (val === null || val === undefined || val === '') return;

        const dynKey = (key || (def && def.key) || `attr_${attrId}`).toString();
        const dyn = ensureDyn(obj);
        if (!dyn.has(dynKey)) dyn.set(dynKey, { def, valuesByLang: {}, any: null, attrId });
        const entry = dyn.get(dynKey);

        entry.any = entry.any ?? val;
        entry.attrId = entry.attrId ?? attrId;

        if (lc) entry.valuesByLang[lc] = val;
        else entry.valuesByLang._ = val;
      } catch (e) {
        if (DEBUG_LOG) console.error('[w2h] location_values parse failed', e, r2);
      }
    });

    // 3) Dyn finalisieren
    let dynCountTotal = 0;

    for (const loc of locList) {
      const obj = kvByLoc.get(loc.id) || {};
      // ✅ User-Foto Meta anhängen (für InfoWindow Thumb + Button)
      const up = userPhotoMeta.get(loc.id);
      obj.user_photo_count = up ? Number(up.count || 0) : 0;
      obj.user_photo_thumb = up && up.firstUrl ? String(up.firstUrl) : '';

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

          const kLower = String(k || '').toLowerCase();
          if (kLower.includes('wind_profile') || kLower.includes('wind_swell') || kLower.includes('wind_hint') || kLower.includes('livewind_station')) {
            continue;
          }

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

    setLocVersion((v) => v + 1);

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

            // ---------------------------
            // Fotos Button: User + Google (gemischt)
            // ---------------------------
            const btn = document.getElementById(`phbtn-${row.id}`);
            if (btn) {
              btn.addEventListener('click', async () => {
                try {
                  const titleNow = pickName(row, langCode);

                  const googlePhotos = kvNow.photos && Array.isArray(kvNow.photos) ? kvNow.photos : [];
                  const userPhotos = await hydrateUserPhotos(row.id, langCode);

                  // Dedupe (Google: photo_reference | User: url/public_url/thumb/image_url)
                  const seen = new Set();
                  const merged = [];

                  const pushUnique = (p) => {
                    if (!p) return;

                    const gRef = p.photo_reference || p.photoreference || p.photoRef || p.photo_ref || p.ref;
                    if (gRef) {
                      const k = `g:${String(gRef)}`;
                      if (seen.has(k)) return;
                      seen.add(k);
                      merged.push(p);
                      return;
                    }

                    const u = p.public_url || p.url || p.thumb || p.image_url;
                    if (u) {
                      const k = `u:${String(u)}`;
                      if (seen.has(k)) return;
                      seen.add(k);
                      merged.push(p);
                    }
                  };

                  


                  // Reihenfolge: User zuerst, dann Google
                  (Array.isArray(userPhotos) ? userPhotos : []).forEach(pushUnique);
                  googlePhotos.forEach(pushUnique);
  
 console.log('[dbg:gallery:merged] googlePhotos count', googlePhotos.length);
console.log(
  '[dbg:gallery:merged] google photo_refs',
  googlePhotos.map(p =>
    p.photo_reference || p.photoreference || p.photoRef || p.photo_ref || p.ref
  )
);

console.log('[dbg:gallery:merged] userPhotos count', (userPhotos || []).length);
console.log(
  '[dbg:gallery:merged] user urls',
  (userPhotos || []).map(p => p.public_url || p.url || p.thumb || p.image_url)
);

console.log('[dbg:gallery:merged] merged count', merged.length);
console.log(
  '[dbg:gallery:merged] merged keys',
  merged.map(p => p.photo_reference || p.public_url || p.url || p.thumb || p.image_url)
);

if (googlePhotos?.length) {
  const uniq = new Set(
    googlePhotos.map(p => String(p.photo_reference || p.photoreference || p.photoRef || p.photo_ref || p.ref || ''))
  );
  console.log('[dbg:gallery:merged] google unique refs', uniq.size);
}                 
                  
                  if (merged.length) {
                    setGallery({ title: titleNow, photos: merged, row });
                  }
                } catch (e) {
                  console.warn('[w2h] merge gallery failed', e);
                  const googlePhotos = kvNow.photos && Array.isArray(kvNow.photos) ? kvNow.photos : [];

console.log('[dbg:gallery:fallback] googlePhotos count', googlePhotos.length);
console.log(
  '[dbg:gallery:fallback] google photo_refs',
  googlePhotos.map(p =>
    p.photo_reference || p.photoreference || p.photoRef || p.photo_ref || p.ref
  )
);

if (googlePhotos?.length) {
  const uniq = new Set(
    googlePhotos.map(p => String(p.photo_reference || p.photoreference || p.photoRef || p.photo_ref || p.ref || ''))
  );
  console.log('[dbg:gallery:fallback] google unique refs', uniq.size);
}

                  if (googlePhotos.length) {
                    setGallery({ title: pickName(row, langCode), photos: googlePhotos, row });
                  }
                }
              });
            }

            // ---------------------------
            // Wind Button
            // ---------------------------
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

            // ---------------------------
            // KI-Report Button (Lazy Fetch)
            // ---------------------------
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
  const resultPanelTitle = `${label('searchResults', lang)}${
    searchMode.active ? ` (${searchMode.results.length})` : ''
  }`;

  return (
    <>
      <div className="w2h-page">
        {/* ================= HEADER ================= */}
        <div className="w2h-header">
          <div className="w2h-header-inner">
            {/* LEFT: Region */}
            <div className="w2h-header-left">
              <div className="w2h-region-panel">
                <div style={{ marginBottom: 4, fontWeight: 600, color: '#fff' }}>
                  Region
                </div>

                <select
                  value={selectedRegion}
                  onChange={(e) => {
                    const slug = e.target.value;
                    setRegionMode('manual');
                    setSelectedRegion(slug);

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
                >
                  <option value="all">{allLabel(lang)}</option>
                  {regions.map((r) => (
                    <option key={r.slug} value={r.slug}>
                      {pickRegionName(r, lang)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* CENTER: Search */}
            <div className="w2h-header-mid">
              <div className="w2h-searchbar">
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={label('searchPlaceholder', lang)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSearch();
                    if (e.key === 'Escape') {
                      setSearchQuery('');
                      if (searchMode.active) clearSearchMode();
                    }
                  }}
                />

                <button type="button" onClick={handleSearch}>
                  {label('searchButton', lang)}
                </button>

                {searchMode.active ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      clearSearchMode();
                    }}
                    title={label('resetSearch', lang)}
                  >
                    ✕
                  </button>
                ) : null}
              </div>
            </div>

            {/* RIGHT: Language + Layer Button */}
            <div className="w2h-header-right">
              {/* Language Switch */}
              <div className="w2h-lang">
                <button type="button" onClick={() => goLang('de')}>DE</button>
                <button type="button" onClick={() => goLang('en')}>EN</button>
                <button type="button" onClick={() => goLang('it')}>IT</button>
                <button type="button" onClick={() => goLang('fr')}>FR</button>
                <button type="button" onClick={() => goLang('hr')}>HR</button>
              </div>

              {/* Layer Panel Button */}
              <LayerPanel
                lang={lang}
                onInit={(initialMap) => {
                  layerState.current = new Map(initialMap);
                  applyLayerVisibility();
                }}
                onToggle={(catKey, visible, meta) => {
                  const affected =
                    meta && Array.isArray(meta.affected_category_ids)
                      ? meta.affected_category_ids
                      : [catKey];

                  for (const k of affected) layerState.current.set(String(k), visible);
                  if (!searchMode.active) applyLayerVisibility();
                }}
                onToggleAll={(visible) => {
                  const updated = new Map();
                  layerState.current.forEach((_v, key) => updated.set(key, visible));
                  layerState.current = updated;
                  if (!searchMode.active) applyLayerVisibility();
                }}
              />
            </div>
          </div>
        </div>

        {/* ================= MAP ================= */}
        <div className="w2h-map-wrap">
          <div ref={mapRef} className="w2h-map" />

          {seaWarning && !seaWarningClosed && (
            <div
             style={{
               position: 'absolute',
               top: 14,
               left: '50%',
               transform: 'translateX(-50%)',
               zIndex: 50,
               width: 'min(640px, 92%)',
               background: 'rgba(15, 23, 42, 0.96)',
               border: '1px solid rgba(148, 163, 184, 0.25)',
               borderRadius: 16,
               padding: 12,
               boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
               color: 'white',
               pointerEvents: 'auto',
             }}
           >
             <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
               <div style={{ fontWeight: 900 }}>
                 ⚠️ {lang === 'de' ? 'Warnung (Seewetter Split)' : 'Warning (Sea Weather Split)'}
               </div>

               <button
                 onClick={closeSeaWarning}
                 style={{
                   background: 'rgba(255,255,255,0.10)',
                   border: '1px solid rgba(255,255,255,0.15)',
                   borderRadius: 10,
                   padding: '6px 10px',
                   color: 'white',
                   cursor: 'pointer',
                   fontWeight: 800,
                 }}
                 title="Schließen"
               >
                 ✕
               </button>
             </div>

             <div style={{ marginTop: 8, fontSize: 14, lineHeight: 1.35, whiteSpace: 'pre-wrap' }}>
               {seaWarning.warning}
             </div>

             {seaWarning.synopsis ? (
               <div style={{ marginTop: 10, fontSize: 13, opacity: 0.88, whiteSpace: 'pre-wrap' }}>
                 <b>{lang === 'de' ? 'Wetterlage:' : 'Synopsis:'}</b> {seaWarning.synopsis}
               </div>
             ) : null}

             <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
               <button
                 onClick={() => window.open(seaWarning.sourceUrl, '_blank', 'noopener,noreferrer')}
                 style={{
                   background: '#0284c7',
                   border: 'none',
                   borderRadius: 10,
                   padding: '7px 10px',
                   color: 'white',
                   cursor: 'pointer',
                   fontWeight: 900,
                 }}
                 title="Quelle in neuem Tab öffnen"
               >
                 ↗ Quelle öffnen
               </button>
             </div>
           </div>
         )}



          {/* Locate Button */}
          <div
            style={{
              position: 'absolute',
              left: 14,
              bottom: 18,
              zIndex: 10,
            }}
          >
            <button
              type="button"
              onClick={async () => {
                setLocateErr('');
                setLocateBusy(true);
                try {
                  const ok = await requestAndApplyGeolocation({
                    reason: 'button',
                    alsoSetAutoRegion: true,
                    showAccuracy: true,
                  });
                  if (!ok) setLocateErr('Geolocation nicht verfügbar.');
                } finally {
                  setTimeout(() => setLocateBusy(false), 350);
                }
              }}
              title="Meinen Standort verwenden"
              style={{
                width: 40,
                height: 40,
                borderRadius: 9999,
                border: '1px solid rgba(0,0,0,.12)',
                background: 'rgba(255,255,255,0.92)',
                boxShadow: '0 6px 18px rgba(0,0,0,.15)',
                cursor: 'pointer',
                display: 'grid',
                placeItems: 'center',
                fontSize: 16,
                lineHeight: 1,
                opacity: locateBusy ? 0.7 : 1,
              }}
            >
              ⦿
            </button>

            {locateErr ? (
              <div
                style={{
                  marginTop: 6,
                  maxWidth: 220,
                  fontSize: 11,
                  color: '#7c2d12',
                  background: 'rgba(255,247,237,0.95)',
                  border: '1px solid #fed7aa',
                  borderRadius: 10,
                  padding: '6px 8px',
                  boxShadow: '0 6px 18px rgba(0,0,0,.10)',
                }}
              >
                {locateErr}
              </div>
            ) : null}
          </div>

          {/* Search Result Panel */}
          {searchMode.active ? (
            <div
              className="w2h-search-panel"
              style={{
                position: 'absolute',
                top: 10,
                left: '50%',
                transform: 'translateX(-50%)',  
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
              <div
                style={{
                  position: 'sticky',
                  top: 0,
                  zIndex: 2,
                  background: 'rgba(255,255,255,0.96)',
                  paddingBottom: 8,
                  marginBottom: 8,
                  borderBottom: '1px solid rgba(0,0,0,.06)',
                }}
              >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
             }}
            >
              <div style={{ fontWeight: 900, fontSize: 13 }}>
                {resultPanelTitle}
              </div>

              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  clearSearchMode();
         }}
              aria-label={label('resetSearch', lang)}
              title={label('resetSearch', lang)}
                style={{
                width: 30,
                height: 30,
                borderRadius: 10,
                border: '1px solid rgba(0,0,0,.12)',
                background: '#fff',
                cursor: 'pointer',
                fontSize: 16,
                fontWeight: 900,
                lineHeight: 1,
                display: 'grid',
                placeItems: 'center',
          }}
    >
      ✕
    </button>
  </div>
</div>


              {searchMode.results?.map(({ row, score }) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => openResult(row)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    border: '1px solid #e5e7eb',
                    background: '#fff',
                    borderRadius: 12,
                    padding: '10px 10px',
                    cursor: 'pointer',
                    marginBottom: 8,
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: 13 }}>
                    {pickName(row, lang)}
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                    {Number.isFinite(score) ? `Score: ${score}` : ''}
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Modals */}
        <Lightbox gallery={gallery} onClose={() => setGallery(null)} />
        <WindModal modal={windModal} onClose={() => setWindModal(null)} />
        {kiModal ? (
          <KiReportModal modal={kiModal} onClose={() => setKiModal(null)} />
        ) : null}
      </div>

      {/* ✅ Overlay nur anzeigen wenn Map geladen */}
      {mapLoaded ? (
        <WelcomeOverlay
          onClose={() => setWelcomeClosed(true)}
          titleNode={
            <>
              <div>
                Wind
                <span style={{ color: '#0284c7', fontWeight: 900 }}>2</span>
                Horizon
              </div>
              <div style={{ fontSize: 14, fontWeight: 400, opacity: 0.8 }}>
                the best of seaside, at one spot
              </div>
            </>
          }
          introText={label('welcomeIntro', lang)}
          bullets={[
            label('welcomeBullet1', lang),
            label('welcomeBullet2', lang),
            label('welcomeBullet3', lang),
          ]}
          buttonLabel={label('welcomeButton', lang)}   // ⚠️ dein Key heißt welcomeButton (nicht welcomeToMap)
          showLangSwitch={true}
          currentLang={lang}
          supportedLangs={['de', 'en', 'it', 'fr', 'hr']}
          label={label} // ✅ WICHTIG: für aria-label close/language
        />


      ) : null}

        {/* ✅ Bora Panel Overlay */}
        <PanelHost
          open={activePanel === 'bora'}
          title={label?.('boraTitle', lang) ?? 'Bora'}
          onClose={() => setActivePanel(null)}
        >
        <BoraPanel lang={lang} label={label} />
        </PanelHost>

        {/* ✅ Seawetter Panel Overlay */}
        <PanelHost
          open={activePanel === 'seewetter'}
          title={label?.('seaWeatherTitle', lang) ?? 'Seewetter'}
          onClose={() => setActivePanel(null)}
        >
        <SeaWeatherPanel lang={lang} label={label} />
        </PanelHost>



      {/* ✅ styles MUST be inside the same return parent (Fragment) */}
      <style jsx>{`
        :global(:root) {
          --w2h-header: #39d0fa;
          --w2h-header-h: 70px;
        }

        .w2h-page {
          height: 100dvh;     /* iOS korrekt */
          min-height: 100dvh;
          width: 100%;
          display: flex;
          flex-direction: column;
        }

        .w2h-header {
          flex: 0 0 var(--w2h-header-h);
          height: var(--w2h-header-h);
          background: var(--w2h-header);
          z-index: 1000;
          position: relative;
        }

        .w2h-header-inner {
          height: 100%;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 0 12px;
          min-width: 0;           /* wichtig: erlaubt Schrumpfen in iOS Safari */
        }

        .w2h-header-left {
          flex: 0 0 auto;
        }

        .w2h-header-mid {
          flex: 1 1 auto;
          display: flex;
          justify-content: center;
          min-width: 0;           /* wichtig */
        }

        .w2h-header-right {
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .w2h-region-panel select {
          width: 210px;
          font-size: 12px;
          padding: 6px 8px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.25);
          background: rgba(255, 255, 255, 0.95);
          outline: none;
        }

        .w2h-searchbar {
          width: 100%;
          max-width: 720px; 
          min-width: 0;           /* wichtig: input darf kleiner werden */
          display: flex;
          gap: 8px;
          align-items: center;
          background: rgba(255, 255, 255, 0.96);
          border-radius: 12px;
          padding: 8px 10px;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.15);
        }

        .w2h-searchbar input {
          width: 100%;
          padding: 10px;
          border-radius: 10px;
          border: 1px solid #ddd;
          font-size: 14px;
          outline: none;
        }

        .w2h-searchbar button {
          padding: 10px 12px;
          border-radius: 10px;
          border: none;
          cursor: pointer;
          background: #1a73e8;
          color: #fff;
          font-size: 14px;
          font-weight: 800;
          white-space: nowrap;
        }

        .w2h-lang button {
          padding: 8px 10px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.35);
          background: rgba(255, 255, 255, 0.12);
          color: #fff;
          cursor: pointer;
          font-weight: 800;
          font-size: 12px;
        }

        .w2h-lang button:hover {
          background: rgba(255, 255, 255, 0.18);
        }

        .w2h-map-wrap {
          position: relative;
          flex: 1 1 auto;
          width: 100%;
          overflow: hidden;
        }

        .w2h-map {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          z-index: 0;
        }

        @media (max-width: 640px) {
          .w2h-header { height: auto; padding: 10px 10px 12px; }
          .w2h-header-inner { display: grid; grid-template-columns: 1fr auto; grid-template-areas: "left right" "mid mid"; gap: 10px; align-items: center; }
          .w2h-header-left { grid-area: left; }
          .w2h-header-right { grid-area: right; }
          .w2h-header-mid { grid-area: mid; }
          .w2h-region-panel { max-width: 220px; }
          .w2h-region-panel select { width: 100%; max-width: 220px; }
          .w2h-searchbar { width: 100%; max-width: none; padding: 8px 10px; }
          .w2h-searchbar input { width: 100%; min-width: 0; }
          .w2h-lang { display: flex; gap: 6px; }
          .w2h-lang button { padding: 6px 8px; font-size: 12px; }
          .w2h-searchbar input {font-size: 16px;  /* verhindert iOS Auto-Zoom */ line-height: 1.2; }
        }
        @media (max-height: 480px) and (orientation: landscape) {
          .w2h-header { height: auto; padding: 10px 10px 12px; }
          .w2h-header-inner {
            display: grid;
            grid-template-columns: 1fr auto;
            grid-template-areas: "left right" "mid mid";
            gap: 10px;
            align-items: center;
       }
          .w2h-header-left { grid-area: left; }
          .w2h-header-right { grid-area: right; }
          .w2h-header-mid { grid-area: mid; }
          .w2h-region-panel { max-width: 220px; }
          .w2h-region-panel select { width: 100%; max-width: 220px; }
          .w2h-searchbar { width: 100%; max-width: none; padding: 8px 10px; }
          .w2h-searchbar input { width: 100%; min-width: 0; font-size: 16px; line-height: 1.2; }
          .w2h-lang { display: flex; gap: 6px; }
          .w2h-lang button { padding: 6px 8px; font-size: 12px; }
        }  
 

`}</style>
    <style jsx global>{`
        .gm-style .w2h-iw {
          max-width: 340px;
          font: 13px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
          color: #1a1a1a;
        }
      `}</style>
    </>
  );

}
