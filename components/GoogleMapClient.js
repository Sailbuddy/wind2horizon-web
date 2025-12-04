'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import LayerPanel from '@/components/LayerPanel';
import { defaultMarkerSvg } from '@/components/DefaultMarkerSvg';
import { svgToDataUrl } from '@/lib/utils';
import { REGIONS, REGION_KEYS, findRegionForPoint } from '@/lib/regions';

// 🔧 Debug-Schalter
const DEBUG_MARKERS = false; // true = einfache Kreis-Symbole statt SVG
const DEBUG_BOUNDING = false; // true = rote Bounding-Boxen über den Markern

// --- Doppel-Wind-/Schwell-Rose (read-only Variante) -----------------
const DIRS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
const ANGLE = { N: 0, NO: 45, O: 90, SO: 135, S: 180, SW: 225, W: 270, NW: 315 };

// 🔹 Map-Style: Google-POI-Icons & Texte ausblenden
const GOOGLE_MAP_STYLE = [
  {
    featureType: 'poi',
    elementType: 'labels.icon',
    stylers: [{ visibility: 'off' }],
  },
  {
    featureType: 'poi',
    elementType: 'labels.text',
    stylers: [{ visibility: 'off' }],
  },
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
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label="Wind & Schwell"
    >
      {/* Ringe */}
      <circle cx={cx} cy={cy} r={outerR} fill="none" stroke="#AFAFAF" strokeWidth={size * 0.03} />
      <circle cx={cx} cy={cy} r={innerR} fill="none" stroke="#AFAFAF" strokeWidth={size * 0.025} />

      {/* Außen: Wind (rot) */}
      {DIRS.map((d) => (
        <polygon
          key={`w-${d}`}
          points={arrow(ANGLE[d], outerR)}
          fill={w[d] ? '#E53E3E' : '#C7C7C7'}
        >
          <title>{`Gefahr bei WIND aus ${d}`}</title>
        </polygon>
      ))}

      {/* Innen: Schwell (blau) */}
      {DIRS.map((d) => (
        <polygon
          key={`s-${d}`}
          points={arrow(ANGLE[d], innerR)}
          fill={s[d] ? '#2563EB' : '#C7C7C7'}
        >
          <title>{`Gefahr bei SCHWELL aus ${d}`}</title>
        </polygon>
      ))}

      {/* Labels */}
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
// -------------------------------------------------------------------

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

  // 🔹 Neu: Marker-Map & Locations für Suche
  const markerMapRef = useRef(new Map()); // location_id -> Marker
  const locationsRef = useRef([]); // aktuell sichtbare Locations (nach Deduplizierung)

  // Galerie-Lightbox
  const [gallery, setGallery] = useState(null);

  // Winddaten-Modal (mit Daten)
  const [windModal, setWindModal] = useState(null);

  // 🔹 Neu: Such-Query-State
  const [searchQuery, setSearchQuery] = useState('');

  // 🔹 Neu: Region-State
  const [selectedRegion, setSelectedRegion] = useState(REGION_KEYS.ALL); // 'all'
  const [regionMode, setRegionMode] = useState('auto'); // 'auto' | 'manual'

  const DEBUG_LOG = false;

  // ---------------------------------------------
  // Helpers: Google Photo Proxy + HTML escaper
  // ---------------------------------------------
  const photoUrl = (ref, max = 800) =>
    `/api/gphoto?photoreference=${encodeURIComponent(ref)}&maxwidth=${max}`;

  function escapeHtml(str = '') {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function Lightbox({ gallery, onClose }) {
    if (!gallery) return null;

    let items = [];
    try {
      if (Array.isArray(gallery.photos)) {
        items = gallery.photos;
      } else if (typeof gallery.photos === 'string') {
        const parsed = JSON.parse(gallery.photos);
        items = Array.isArray(parsed) ? parsed : parsed?.photos || [];
      } else if (gallery.photos && typeof gallery.photos === 'object') {
        items = Array.isArray(gallery.photos.photos) ? gallery.photos.photos : [];
      }
    } catch (errLightbox) {
      console.warn('[w2h] Lightbox parse failed', errLightbox);
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
            maxWidth: '1100px',
            width: '95vw',
            maxHeight: '90vh',
            overflow: 'auto',
            padding: 16,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
              {gallery.title} – {items.length} Fotos
            </h3>
            <button
              onClick={onClose}
              style={{
                fontSize: 24,
                lineHeight: 1,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 12,
            }}
          >
            {items.map((p, idx) => {
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
                <figure
                  key={p.public_url || p.url || p.photo_reference || p.photoreference || idx}
                  style={{ margin: 0 }}
                >
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
                      style={{ width: '100%', height: 'auto', display: 'block' }}
                    />
                  </div>
                  {isGoogle ? (
                    Array.isArray(p.html_attributions) && p.html_attributions[0] ? (
                      <figcaption
                        style={{ fontSize: 12, color: '#666', padding: '6px 2px' }}
                        dangerouslySetInnerHTML={{ __html: p.html_attributions[0] }}
                      />
                    ) : null
                  ) : p.caption || p.author ? (
                    <figcaption style={{ fontSize: 12, color: '#666', padding: '6px 2px' }}>
                      {escapeHtml(
                        [p.caption, p.author && `© ${p.author}`].filter(Boolean).join(' · '),
                      )}
                    </figcaption>
                  ) : null}
                </figure>
              );
            })}
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
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <h2 style={{ margin: 0, fontSize: 20 }}>
              💨 Winddaten · {modal.title} (#{modal.id})
            </h2>
            <button
              onClick={onClose}
              style={{
                fontSize: 24,
                lineHeight: 1,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              ×
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 0.9fr)',
              gap: 20,
              alignItems: 'flex-start',
            }}
          >
            <div
              style={{
                background: '#fff',
                borderRadius: 14,
                padding: 12,
                border: '1px solid #e5e7eb',
              }}
            >
              <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Wind &amp; Schwell-Rosette</h3>
              {windProfile ? (
                <WindSwellRose
                  size={260}
                  wind={windProfile.wind || {}}
                  swell={windProfile.swell || {}}
                />
              ) : (
                <p style={{ margin: 0, fontSize: 14, color: '#6b7280' }}>
                  Für diesen Spot sind aktuell keine Wind-/Schwellprofile hinterlegt.
                </p>
              )}
            </div>

            <div style={{ display: 'grid', gap: 12 }}>
              <div
                style={{
                  background: '#fff',
                  borderRadius: 14,
                  padding: 12,
                  border: '1px solid #e5e7eb',
                }}
              >
                <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>Hinweis</h3>
                {hintText ? (
                  <p style={{ margin: 0, fontSize: 14, whiteSpace: 'pre-wrap' }}>{hintText}</p>
                ) : (
                  <p style={{ margin: 0, fontSize: 14, color: '#9ca3af' }}>
                    Kein spezieller Hinweistext hinterlegt.
                  </p>
                )}
              </div>

              <div
                style={{
                  background: '#fff',
                  borderRadius: 14,
                  padding: 12,
                  border: '1px solid #e5e7eb',
                }}
              >
                <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>LiveWind</h3>
                {liveWindStation ? (
                  <>
                    <p style={{ margin: '0 0 6px', fontSize: 12, color: '#6b7280' }}>
                      Station:{' '}
                      <strong>
                        {liveWindStation}
                        {liveWindStationName ? ` – ${liveWindStationName}` : ''}
                      </strong>
                    </p>
                    <iframe
                      src={`https://w2hlivewind.netlify.app?station=${encodeURIComponent(
                        String(liveWindStation),
                      )}`}
                      style={{ width: '100%', height: 70, border: 'none', borderRadius: 8 }}
                      loading="lazy"
                      title="LiveWind"
                    />
                  </>
                ) : (
                  <p style={{ margin: 0, fontSize: 14, color: '#9ca3af' }}>
                    Für diesen Spot ist noch keine Live-Wind-Station verknüpft.
                  </p>
                )}
              </div>
            </div>
          </div>

          <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 8 }}>
            Hinweis: Darstellung aktuell nur zur internen Kontrolle. Feintuning (windrelevant,
            Stationen, Layout) folgt.
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
        existing.addEventListener(
          'load',
          () => resolve(),
          { once: true },
        );
        existing.addEventListener(
          'error',
          (ev) => reject(ev),
          { once: true },
        );
        return;
      }
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=marker&language=${language}`;
      s.async = true;
      s.defer = true;
      s.dataset.w2hGmaps = '1';
      s.addEventListener(
        'load',
        () => resolve(),
        { once: true },
      );
      s.addEventListener(
        'error',
        (ev) => reject(ev),
        { once: true },
      );
      document.head.appendChild(s);
    });
  }

  function repairMojibake(s = '') {
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
      route: {
        de: 'Route',
        en: 'Directions',
        it: 'Itinerario',
        hr: 'Ruta',
        fr: 'Itinéraire',
      },
      website: { de: 'Website', en: 'Website', it: 'Sito', hr: 'Web', fr: 'Site' },
      call: { de: 'Anrufen', en: 'Call', it: 'Chiama', hr: 'Nazovi', fr: 'Appeler' },
      open: { de: 'Geöffnet', en: 'Open now', it: 'Aperto', hr: 'Otvoreno', fr: 'Ouvert' },
      closed: { de: 'Geschlossen', en: 'Closed', it: 'Chiuso', hr: 'Zatvoreno', fr: 'Fermé' },
      photos: { de: 'Fotos', en: 'Photos', it: 'Foto', hr: 'Fotografije', fr: 'Photos' },
      wind: {
        de: 'Winddaten',
        en: 'Wind data',
        it: 'Dati vento',
        hr: 'Podaci o vjetru',
        fr: 'Données vent',
      },
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
    // EN
    ['monday', 0],
    ['mon', 0],
    ['tuesday', 1],
    ['tue', 1],
    ['tues', 1],
    ['wednesday', 2],
    ['wed', 2],
    ['thursday', 3],
    ['thu', 3],
    ['thur', 3],
    ['thurs', 3],
    ['friday', 4],
    ['fri', 4],
    ['saturday', 5],
    ['sat', 5],
    ['sunday', 6],
    ['sun', 6],
    // DE
    ['montag', 0],
    ['mo', 0],
    ['dienstag', 1],
    ['di', 1],
    ['mittwoch', 2],
    ['mi', 2],
    ['donnerstag', 3],
    ['do', 3],
    ['freitag', 4],
    ['fr', 4],
    ['samstag', 5],
    ['sa', 5],
    ['sonntag', 6],
    ['so', 6],
    // IT
    ['lunedì', 0],
    ['lunedi', 0],
    ['lun', 0],
    ['martedì', 1],
    ['martedi', 1],
    ['mar', 1],
    ['mercoledì', 2],
    ['mercoledi', 2],
    ['mer', 2],
    ['giovedì', 3],
    ['giovedi', 3],
    ['gio', 3],
    ['venerdì', 4],
    ['venerdi', 4],
    ['ven', 4],
    ['sabato', 5],
    ['sab', 5],
    ['domenica', 6],
    ['dom', 6],
    // FR
    ['lundi', 0],
    ['lun', 0],
    ['mardi', 1],
    ['mar', 1],
    ['mercredi', 2],
    ['mer', 2],
    ['jeudi', 3],
    ['jeu', 3],
    ['vendredi', 4],
    ['ven', 4],
    ['samedi', 5],
    ['sam', 5],
    ['dimanche', 6],
    ['dim', 6],
    // HR
    ['ponedjeljak', 0],
    ['pon', 0],
    ['utorak', 1],
    ['uto', 1],
    ['srijeda', 2],
    ['sri', 2],
    ['četvrtak', 3],
    ['cetvrtak', 3],
    ['čet', 3],
    ['cet', 3],
    ['petak', 4],
    ['pet', 4],
    ['subota', 5],
    ['sub', 5],
    ['nedjelja', 6],
    ['ned', 6],
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

    // neue Wind-Felder:
    102: 'wind_profile', // JSON Wind & Schwell
    105: 'wind_hint', // mehrsprachiger Hinweistext

    // LiveWind-Stations-ID
    107: 'livewind_station',
  };

  // Mapping per Attribut-Key
  const FIELD_MAP_BY_KEY = {
    wind_profile: 'wind_profile',
    wind_swell_profile: 'wind_profile',
    wind_profile_info: 'wind_hint',
    wind_hint: 'wind_hint',
    wind_note: 'wind_hint',
    livewind_station: 'livewind_station',
  };

  function getMarkerIcon(catId, svgMarkup) {
    // 🔧 Debug: einfache Kreissymbole ohne SVG
    if (
      DEBUG_MARKERS &&
      typeof google !== 'undefined' &&
      google.maps &&
      google.maps.SymbolPath
    ) {
      return {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 8,
        fillOpacity: 0.9,
        strokeWeight: 2,
      };
    }

    const key = String(catId ?? 'default');
    if (iconCache.current.has(key)) return iconCache.current.get(key);
    const rawSvg =
      svgMarkup && String(svgMarkup).trim().startsWith('<') ? svgMarkup : defaultMarkerSvg;

    // Standard: 40x40, Anchor unten Mitte → Spitze zeigt auf die Koordinate
    const icon = {
      url: svgToDataUrl(rawSvg),
      scaledSize: new google.maps.Size(40, 40),
      anchor: new google.maps.Point(20, 40),
    };

    iconCache.current.set(key, icon);
    return icon;
  }

  // Debug-Overlay: Bounding-Boxen für Marker anzeigen
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
        if (panes && panes.overlayMouseTarget) {
          panes.overlayMouseTarget.appendChild(this.div);
        }
      }

      draw() {
        const projection = this.getProjection();
        if (!projection || !this.locations) return;

        const size = 40; // gleiche Größe wie Marker-Icon
        const html = this.locations
          .map((loc) => {
            const latLng = new google.maps.LatLng(loc.lat, loc.lng);
            const pos = projection.fromLatLngToDivPixel(latLng);
            if (!pos) return '';
            const left = pos.x - size / 2;
            const top = pos.y - size;

            return `<div 
              style="
                position:absolute;
                left:${left}px;
                top:${top}px;
                width:${size}px;
                height:${size}px;
                border:1px solid red;
                box-sizing:border-box;
                pointer-events:none;
              ">
            </div>`;
          })
          .join('');

        this.div.innerHTML = html;
      }

      onRemove() {
        if (this.div && this.div.parentNode) {
          this.div.parentNode.removeChild(this.div);
        }
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

  function mergePhotos(googleArr, userArr) {
    return [...(userArr || []), ...(googleArr || [])];
  }

  function pickFirstThumb(photos) {
    if (!Array.isArray(photos) || !photos.length) return null;
    const user = photos.find((p) => p.thumb || p.public_url || p.url);
    if (user) return user.thumb || user.public_url || user.url;
    const g = photos.find((p) => p.photo_reference || p.photoreference);
    if (g) return photoUrl(g.photo_reference || g.photoreference, 400);
    return null;
  }

  function buildInfoContent(row, kvRaw, iconSvgRaw, langCode) {
    // 🔍 Spezial-DEBUG für Spot #527: ultraminimaler Inhalt, damit er nicht crasht
    if (row && row.id === 527) {
      const safeKv = kvRaw && typeof kvRaw === 'object' ? kvRaw : {};
      const title = escapeHtml(pickName(row, langCode));
      const desc = escapeHtml(pickDescriptionFromRow(row, langCode) || safeKv.description || '');

      return `
        <div class="w2h-iw">
          <div class="iw-hd">
            <div class="iw-title">${title} <span class="iw-id">#${row.id}</span> (DEBUG 527)</div>
          </div>
          <div class="iw-bd">
            ${
              desc
                ? `<div class="iw-row iw-desc">${desc}</div>`
                : '<div class="iw-row iw-desc">Kein Beschreibungstext.</div>'
            }
          </div>
        </div>
      `;
    }

    // Standardpfad für alle anderen Spots – vorsichtig mit den Daten umgehen
    const kv = kvRaw && typeof kvRaw === 'object' ? kvRaw : {};
    const title = escapeHtml(pickName(row, langCode));
    const desc = escapeHtml(pickDescriptionFromRow(row, langCode) || kv.description || '');

    const addrByLang =
      kv.addressByLang && typeof kv.addressByLang === 'object' ? kv.addressByLang : {};
    const pref = [langCode, 'de', 'en', 'it', 'fr', 'hr'];
    let addrSel = '';
    for (const L of pref) {
      if (addrByLang[L]) {
        addrSel = addrByLang[L];
        break;
      }
    }
    const address = escapeHtml(addrSel || kv.address || '');

    const website = kv.website || '';
    const phone = kv.phone || '';

    // 🔁 Neu: robustes Rating-Handling
    const rating =
      kv.rating !== undefined && kv.rating !== null && kv.rating !== ''
        ? Number(kv.rating)
        : null;
    const ratingTotal = kv.rating_total ? parseInt(kv.rating_total, 10) : null;
    const priceLevel = kv.price ? parseInt(kv.price, 10) : null;
    const openNow = kv.opening_now === 'true' || kv.opening_now === true;

    const hoursByLang =
      kv.hoursByLang && typeof kv.hoursByLang === 'object' ? kv.hoursByLang : {};
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
    const siteHref =
      website && website.startsWith('http') ? website : website ? `https://${website}` : '';
    const telHref = phone ? `tel:${String(phone).replace(/\s+/g, '')}` : '';

    const svgMarkup = iconSvgRaw || defaultMarkerSvg;

    const btnRoute = `<a class="iw-btn" href="${dirHref}" target="_blank" rel="noopener">📍 ${label(
      'route',
      langCode,
    )}</a>`;
    const btnSite = siteHref
      ? `<a class="iw-btn" href="${escapeHtml(siteHref)}" target="_blank" rel="noopener">🌐 ${label(
          'website',
          langCode,
        )}</a>`
      : '';
    const btnTel = telHref
      ? `<a class="iw-btn" href="${escapeHtml(telHref)}">📞 ${label('call', langCode)}</a>`
      : '';

    // 🔁 Neu: Rating-Berechnung ohne Shadowing/Fehler
    let ratingHtml = '';
    if (rating !== null && !Number.isNaN(rating)) {
      const rInt = Math.max(0, Math.min(5, Math.round(rating)));
      const stars = '★'.repeat(rInt) + '☆'.repeat(5 - rInt);
      const formatted =
        Number.isFinite(rating) && rating.toFixed ? rating.toFixed(1) : String(rating);
      ratingHtml = `<div class="iw-row iw-rating">${stars} ${formatted}${
        ratingTotal ? ` (${ratingTotal})` : ''
      }</div>`;
    }

    let priceHtml = '';
    if (priceLevel !== null && !Number.isNaN(priceLevel)) {
      const p = Math.max(0, Math.min(4, priceLevel));
      priceHtml = `<div class="iw-row iw-price">${'€'.repeat(p || 0)}</div>`;
    }

    let openingHtml = '';
    if (kv.opening_now !== undefined) {
      openingHtml += `<div class="iw-row iw-open">${
        openNow ? `🟢 ${label('open', langCode)}` : `🔴 ${label('closed', langCode)}`
      }</div>`;
    }
    if (hoursLocalized && hoursLocalized.length) {
      openingHtml += `<ul class="iw-hours">${hoursLocalized
        .map((h) => `<li>${escapeHtml(String(h))}</li>`)
        .join('')}</ul>`;
    }

    const thumbHtml = firstThumb
      ? `<img src="${firstThumb}" alt="" loading="lazy" style="width:100%;border-radius:10px;margin:6px 0 10px 0;" />`
      : '';

    const btnPhotos = photos.length
      ? `<button id="phbtn-${row.id}" class="iw-btn" style="background:#6b7280;">🖼️ ${label(
          'photos',
          langCode,
        )} (${photos.length})</button>`
      : '';

    // 🔹 Wind-Button anzeigen, sobald IRGENDEINE Windinfo existiert
    const windProfile = kv.wind_profile || null;
    const hasWindProfile = !!windProfile;
    const hasWindStation = !!kv.livewind_station;
    const hasWindHint =
      kv.wind_hint && typeof kv.wind_hint === 'object' && Object.keys(kv.wind_hint).length > 0;

    const showWindBtn = hasWindProfile || hasWindStation || hasWindHint;

    const btnWind = showWindBtn
      ? `<button id="windbtn-${row.id}" class="iw-btn iw-btn-wind">💨 ${label(
          'wind',
          langCode,
        )}</button>`
      : '';

    return `
      <div class="w2h-iw">
        <div class="iw-hd">
          <span class="iw-ic">${svgMarkup}</span>
          <div class="iw-title">
            ${title}
            <span class="iw-id">#${row.id}</span>
          </div>
        </div>
        <div class="iw-bd">
          ${thumbHtml}
          ${address ? `<div class="iw-row iw-addr">📌 ${address}</div>` : ''}
          ${desc ? `<div class="iw-row iw-desc">${desc}</div>` : ''}
          ${ratingHtml}
          ${priceHtml}
          ${openingHtml}
        </div>
        <div class="iw-actions">
          ${btnWind}${btnRoute}${btnSite}${btnTel}${btnPhotos}
        </div>
      </div>
    `;
  }

  // 🔍 NEU: Suchlogik – arbeitet auf locationsRef & markerMapRef
  function handleSearch() {
    const query = searchQuery.trim().toLowerCase();
    if (!query || !mapObj.current || !locationsRef.current.length) return;

    const normalizeNames = (row) => {
      const arr = [
        row.display_name,
        row.name_de,
        row.name_en,
        row.name_hr,
        row.name_it,
        row.name_fr,
      ]
        .filter(Boolean)
        .map((n) => String(n).toLowerCase());
      return arr;
    };

    // 1️⃣ Exakter Treffer
    let match =
      locationsRef.current.find((row) => {
        const names = normalizeNames(row);
        return names.some((n) => n === query);
      }) ||
      // 2️⃣ Enthält-Suche
      locationsRef.current.find((row) => {
        const names = normalizeNames(row);
        return names.some((n) => n.includes(query));
      });

    if (!match) {
      alert('Kein passender Ort gefunden.');
      return;
    }

    // Karte zentrieren & zoomen
    mapObj.current.panTo({ lat: match.lat, lng: match.lng });
    mapObj.current.setZoom(16);

    // Marker holen und künstlich klicken → öffnet Infofenster mit bestehender Logik
    const marker = markerMapRef.current.get(match.id);
    if (marker && window.google && window.google.maps && google.maps.event) {
      google.maps.event.trigger(marker, 'click');
    }
  }

  // 🔹 Geolocation-Auto-Region
  useEffect(() => {
    if (!booted || !mapObj.current) return;
    if (regionMode !== 'auto') return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;

    const onSuccess = (pos) => {
      const { latitude, longitude } = pos.coords;
      const region = findRegionForPoint(latitude, longitude);
      setSelectedRegion(region.key);

      if (mapObj.current && window.google) {
        mapObj.current.setCenter({ lat: region.centerLat, lng: region.centerLng });
        mapObj.current.setZoom(region.zoom);
      }
    };

    const onError = (err) => {
      console.warn('[w2h] Geolocation failed/denied:', err);
      // wir bleiben einfach in der aktuellen Ansicht, setzen aber auf "manual"
      setRegionMode('manual');
    };

    navigator.geolocation.getCurrentPosition(onSuccess, onError, {
      enableHighAccuracy: false,
      timeout: 5000,
      maximumAge: 600000,
    });
  }, [booted, regionMode]);

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

  useEffect(() => {
    if (!booted || !mapObj.current) return;
    loadMarkers(lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [booted, lang, selectedRegion]);

  async function loadMarkers(langCode) {
    // 🔹 Region-Filter: Bounding Box auf die Locations-Query anwenden
    let locQuery = supabase
      .from('locations')
      .select(`
        id,lat,lng,category_id,display_name,
        google_place_id,plus_code,
        name_de,name_en,name_hr,name_it,name_fr,
        description_de,description_en,description_hr,description_it,description_fr,active,
        categories:category_id ( icon_svg )
      `);

    const region = REGIONS.find((r) => r.key === selectedRegion);

    if (region && region.key !== REGION_KEYS.ALL) {
      locQuery = locQuery
        .gte('lat', region.south)
        .lte('lat', region.north)
        .gte('lng', region.west)
        .lte('lng', region.east);
    }

    const { data: locs, error: errLocs } = await locQuery;
    if (errLocs) {
      console.error(errLocs);
      return;
    }

    // Nur aktive Locations
    const allLocs = locs || [];
    const visibleLocs = allLocs.filter((l) => l.active !== false);

    // Deduplizierung pro Place (gegen echte Doppel-DB-Einträge)
    const seen = new Set();
    const locList = [];
    for (const row of visibleLocs) {
      const key =
        (row.google_place_id && `pid:${row.google_place_id}`) ||
        (row.plus_code && `pc:${row.plus_code}`) ||
        `ll:${row.lat?.toFixed(5)}|${row.lng?.toFixed(5)}`;
      if (seen.has(key)) {
        if (DEBUG_LOG) {
          console.log('[w2h] skip duplicate location for key', key, 'id', row.id);
        }
        continue;
      }
      seen.add(key);
      locList.push(row);
    }

    // IDs der deduplizierten Locations
    const locIds = locList.map((l) => l.id);

    // 🔹 location_values nur für diese IDs laden
    let kvRows = [];
    if (locIds.length) {
      const { data, error } = await supabase
        .from('location_values')
        .select(
          'location_id, attribute_id, value_text, value_number, value_option, value_bool, value_json, name, language_code, attribute_definitions:attribute_id ( key )',
        )
        .in('location_id', locIds);

      if (error) {
        console.warn('location_values load:', error.message);
      } else {
        kvRows = data || [];
      }
    }

    const kvByLoc = new Map();

    (kvRows || []).forEach((r) => {
      const locId = r.location_id;
      const key = (r.attribute_definitions && r.attribute_definitions.key) || null;
      const canon = FIELD_MAP_BY_ID[r.attribute_id] || (key && FIELD_MAP_BY_KEY[key]);
      if (!canon) return;

      if (!kvByLoc.has(locId)) kvByLoc.set(locId, {});
      const obj = kvByLoc.get(locId);
      const lc = (r.language_code || '').toLowerCase();

      if (
        obj[canon] &&
        canon !== 'opening_hours' &&
        canon !== 'address' &&
        canon !== 'photos' &&
        canon !== 'wind_profile' &&
        canon !== 'wind_hint' &&
        canon !== 'livewind_station'
      ) {
        if (DEBUG_LOG) {
          console.warn(
            `[w2h] WARNUNG: doppeltes Attribut "${canon}" bei location_id=${locId}. Der zusätzliche Eintrag wird ignoriert.`,
            r,
          );
        }
        return;
      }

      if (canon === 'photos') {
        const googleArr = normalizeGooglePhotos(
          r.value_json !== null && r.value_json !== undefined ? r.value_json : r.value_text || null,
        );
        if (googleArr.length) {
          obj.photos = (obj.photos || []).concat(googleArr);
        }
        return;
      }

      if (canon === 'wind_profile') {
        try {
          const j =
            r.value_json && typeof r.value_json === 'object'
              ? r.value_json
              : JSON.parse(r.value_json || '{}');
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
        if (r.value_text && String(r.value_text).trim()) {
          text = String(r.value_text);
        } else if (r.value_json) {
          try {
            const j = typeof r.value_json === 'object' ? r.value_json : JSON.parse(r.value_json);
            if (typeof j === 'string') {
              text = j;
            } else if (Array.isArray(j) && j.length) {
              text = String(j[0]);
            } else if (j && typeof j === 'object' && j.text) {
              text = String(j.text);
            }
          } catch (errWh) {
            console.warn('[w2h] wind_hint JSON parse failed', errWh, r);
          }
        }
        if (lc && text) {
          obj.wind_hint[lc] = text;
        }
        return;
      }

      if (canon === 'livewind_station') {
        let stationId = '';
        if (r.value_text && String(r.value_text).trim()) {
          stationId = String(r.value_text).trim();
        } else if (r.value_json) {
          try {
            const j =
              typeof r.value_json === 'object' ? r.value_json : JSON.parse(r.value_json);
            if (typeof j === 'string' || typeof j === 'number') {
              stationId = String(j).trim();
            }
          } catch (errLs) {
            console.warn('[w2h] livewind_station JSON parse failed', errLs, r);
          }
        }

        const stationName =
          (r.name && String(r.name).trim()) && String(r.name).trim().length
            ? String(r.name).trim()
            : null;

        if (stationId) {
          obj.livewind_station = stationId;
          if (stationName) {
            obj.livewind_station_name = stationName;
          }
        }
        return;
      }

      const val =
        r.value_text ??
        r.value_option ??
        (r.value_number !== null && r.value_number !== undefined
          ? String(r.value_number)
          : '') ??
        (r.value_bool !== null && r.value_bool !== undefined ? String(r.value_bool) : '') ??
        (r.value_json ? r.value_json : '');

      if (val === '' || val === null || val === undefined) return;

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
        obj.hoursByLang[lc] = (obj.hoursByLang[lc] || []).concat(arr);
      } else if (canon === 'address') {
        obj.addressByLang = obj.addressByLang || {};
        if (lc) obj.addressByLang[lc] = obj.addressByLang[lc] || String(val);
        else obj.address = obj.address || String(val);
      } else if (canon === 'website' || canon === 'phone') {
        obj[canon] = obj[canon] || String(val);
      } else if (canon === 'description') {
        if (!obj.description || (lc && lc === langCode)) obj.description = String(val);
      } else {
        obj[canon] = String(val);
      }
    });

    // 🔹 User-Fotos pro Location laden
    let userPhotosMap = {};
    try {
      if (locIds.length) {
        const url = `/api/user-photos?ids=${locIds.join(',')}`;
        if (DEBUG_LOG) {
          console.log('[w2h] fetch user-photos:', url);
        }
        const resp = await fetch(url, { cache: 'no-store' });
        const j = await resp.json();

        if (j && j.ok && j.items) {
          userPhotosMap = j.items || {};
        } else if (Array.isArray(j && j.rows)) {
          const map = {};
          for (const r of j.rows) {
            const entry = {
              public_url: r.public_url || null,
              url: r.public_url || null,
              thumb: r.thumb || r.public_url || null,
              caption: r.caption || null,
              author: r.author || null,
              source: 'user',
            };
            if (!map[r.location_id]) map[r.location_id] = [];
            map[r.location_id].push(entry);
          }
          userPhotosMap = map;
        } else {
          userPhotosMap = {};
        }
      }
    } catch (errUP) {
      console.warn('[w2h] user-photos fetch failed', errUP);
    }

    // Google + User Fotos zusammenführen, Thumb setzen
    for (const loc of locList) {
      const obj = kvByLoc.get(loc.id) || {};
      const googleArr = Array.isArray(obj.photos) ? obj.photos : [];

      const user = (userPhotosMap[loc.id] || [])
        .map((p) => ({
          public_url: p.public_url || p.url || null,
          url: p.url || p.public_url || null,
          thumb: p.thumb || p.public_url || null,
          caption: p.caption || null,
          author: p.author || null,
          source: 'user',
        }))
        .filter((u) => u.public_url || u.url || u.thumb);

      obj.photos = mergePhotos(googleArr, user);
      obj.first_photo_ref = pickFirstThumb(obj.photos);
      kvByLoc.set(loc.id, obj);
    }

    // 🔍 Debug: was liegt für die drei Spots im Speicher?
    console.log('[w2h] wind-debug 665 ', kvByLoc.get(665));
    console.log('[w2h] wind-debug 3396', kvByLoc.get(3396));
    console.log('[w2h] wind-debug 3511', kvByLoc.get(3511));

    // 🔹 Neu: Locations für Suche speichern
    locationsRef.current = locList;

    // Bisherige Marker entfernen & MarkerMap leeren
    markers.current.forEach((m) => m.setMap(null));
    markers.current = [];
    markerMapRef.current = new Map();

    // Marker erzeugen
    locList.forEach((row) => {
      const title = pickName(row, langCode);
      const svg = (row.categories && row.categories.icon_svg) || defaultMarkerSvg;

      if (DEBUG_LOG) {
        console.log('[w2h] marker debug', {
          id: row.id,
          lat: row.lat,
          lng: row.lng,
          category_id: row.category_id,
          iconSvgLength: svg ? String(svg).length : 0,
        });
      }

      const marker = new google.maps.Marker({
        position: { lat: row.lat, lng: row.lng },
        title,
        icon: getMarkerIcon(row.category_id, svg),
        map: mapObj.current,
        zIndex: 1000 + (row.category_id || 0), // Marker sicher "oben"
        clickable: true, // explizit klickbar
      });

      marker._cat = String(row.category_id);

      // 🔹 Neu: Marker in Map merken, damit Suche darauf zugreifen kann
      markerMapRef.current.set(row.id, marker);

      // ⬇️ Klick-Handler mit Fallback + Pan-Offset
      marker.addListener('click', () => {
        const meta = kvByLoc.get(row.id) || {};

        let html;
        try {
          html = buildInfoContent(row, meta, svg, langCode);
        } catch (errBI) {
          console.error('[w2h] buildInfoContent failed for location', row.id, errBI, {
            row,
            meta,
          });
          html = buildErrorInfoContent(row.id);
        }

        infoWin.current.setContent(html);
        infoWin.current.open({ map: mapObj.current, anchor: marker });

        // 🔄 Karte verschieben, damit das Infofenster nicht unter Suche/Region liegt
        if (mapObj.current && typeof mapObj.current.panBy === 'function') {
          setTimeout(() => {
            try {
              // Basiswerte: Desktop
              let offsetX = 160;  // nach links (Suchleiste ist rechts)
              let offsetY = -140; // nach unten (Overlays sind oben)

              if (typeof window !== 'undefined') {
                const w = window.innerWidth;
                const h = window.innerHeight;

                // Tablet / kleines Notebook
                if (w <= 1024) {
                  offsetX = 140;
                  offsetY = -160;
                }

                // Handy hochkant → noch stärker nach unten
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
                const photos =
                  kvNow.photos && Array.isArray(kvNow.photos) ? kvNow.photos : [];
                if (photos.length) {
                  setGallery({ title: pickName(row, langCode), photos });
                }
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
          } catch (errDom) {
            console.error('[w2h] domready handler failed for location', row.id, errDom);
          }
        });
      });

      markers.current.push(marker);
    });

    // Optional: Bounding-Box-Debug-Overlay
    if (DEBUG_BOUNDING) {
      createDebugOverlay(mapObj.current, locList);
    }

    applyLayerVisibility();
  }

  function applyLayerVisibility() {
    markers.current.forEach((m) => {
      const vis = layerState.current.get(m._cat);
      m.setVisible(vis ?? true);
    });
  }

  return (
    <div className="w2h-map-wrap">
      {/* 🌍 Regions-Overlay – Position via CSS, Breite am Handy schmäler */}
      <div
        className="w2h-region-panel"
        style={{
          zIndex: 5, // unter dem Infofenster
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
            const key = e.target.value;
            setRegionMode('manual');
            setSelectedRegion(key);
            const region = REGIONS.find((r) => r.key === key);
            if (region && mapObj.current && window.google) {
              mapObj.current.setCenter({ lat: region.centerLat, lng: region.centerLng });
              mapObj.current.setZoom(region.zoom);
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
          {REGIONS.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label[lang] || r.label.de}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setRegionMode('auto')}
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

      {/* 🔍 Suchfeld-Overlay oben rechts */}
      <div
        style={{
          position: 'absolute',
          top: 10,
          right: 20,
          zIndex: 10, // unter Infofenster
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
      </div>

      <div ref={mapRef} className="w2h-map" />

      <LayerPanel
        lang={lang}
        onInit={(initialMap) => {
          // initialMap: Map(catKey -> visible)
          layerState.current = new Map(initialMap);
          applyLayerVisibility();
        }}
        onToggle={(catKey, visible) => {
          // einzelner Layer an/aus
          layerState.current.set(catKey, visible);
          applyLayerVisibility();
        }}
        // 🔹 "Alle Kategorien" – Alle Layer an/aus
        onToggleAll={(visible) => {
          // Alle bekannten Layer-Keys auf visible setzen
          const updated = new Map();
          layerState.current.forEach((_v, key) => {
            updated.set(key, visible);
          });
          layerState.current = updated;
          applyLayerVisibility();
        }}
      />

      <Lightbox gallery={gallery} onClose={() => setGallery(null)} />
      <WindModal modal={windModal} onClose={() => setWindModal(null)} />

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
        /* Region-Panel: Desktop zentriert unter der Suche */
        .w2h-region-panel {
          position: absolute;
          top: 64px;
          left: 50%;
          transform: translateX(-50%);
          min-width: 210px;
          max-width: 320px;
        }
        /* Handy hochkant: nach rechts oben, schmäler */
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
        .gm-style .w2h-iw .iw-ic svg {
          width: 20px;
          height: 20px;
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
        }
        .gm-style .w2h-iw .iw-btn:hover {
          filter: brightness(0.95);
        }
        .gm-style .w2h-iw .iw-btn-wind {
          background: #0ea5e9;
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
      `}</style>
    </div>
  );
}
