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
    theadings(); // ignore – truncated accident? no, keep going logically
  }
