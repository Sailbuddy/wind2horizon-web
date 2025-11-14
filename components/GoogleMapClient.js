'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import LayerPanel from '@/components/LayerPanel';
import { defaultMarkerSvg } from '@/components/DefaultMarkerSvg';
import { svgToDataUrl } from '@/lib/utils';

// --- Doppel-Wind-/Schwell-Rose (read-only Variante) -----------------
const DIRS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
const ANGLE = { N: 0, NO: 45, O: 90, SO: 135, S: 180, SW: 225, W: 270, NW: 315 };

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

export default function GoogleMapClient({ lang = 'de' }) {
  const mapRef = useRef(null);
  const mapObj = useRef(null);
  const markers = useRef([]);
  const layerState = useRef(new Map());
  const infoWin = useRef(null);
  const iconCache = useRef(new Map()); // category_id -> google.maps.Icon
  const [booted, setBooted] = useState(false);

  // Galerie-Lightbox
  const [gallery, setGallery] = useState(null);

  // Winddaten-Modal (mit Daten)
  // modal: { id, title, windProfile, windHint }
  const [windModal, setWindModal] = useState(null);

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
    } catch {
      items = [];
    }

    if (items[0]?.public_url || items[0]?.url) {
      console.log('[w2h] user photo[0]', items[0].public_url || items[0].url);
    }
    if (items[0]?.photo_reference || items[0]?.photoreference) {
      const ref = items[0].photo_reference || items[0].photoreference;
      console.log('[w2h] google photo[0]', photoUrl(ref, 320));
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
          onClick={(e) => e.stopPropagation()}
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
          onClick={(e) => e.stopPropagation()}
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
                <p style={{ margin: 0, fontSize: 14, color: '#6b7280' }}>
                  Hier binden wir im nächsten Schritt das LiveWind-Widget ein (z. B. Station in der
                  Nähe dieses Spots).
                </p>
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
          (e) => reject(e),
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
        (e) => reject(e),
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
    105: 'wind_hint',    // mehrsprachiger Hinweistext
  };

  // Mapping per Attribut-Key (für neue Wind-Felder etc.)
  const FIELD_MAP_BY_KEY = {
    wind_profile: 'wind_profile',
    wind_swell_profile: 'wind_profile',     // falls du so genannt hast
    wind_profile_info: 'wind_hint',         // Freitext-Hinweis (Attribut-Key 105)
    wind_hint: 'wind_hint',
    wind_note: 'wind_hint',
  };

  function getMarkerIcon(catId, svgMarkup) {
    const key = String(catId ?? 'default');
    if (iconCache.current.has(key)) return iconCache.current.get(key);
    const rawSvg =
      svgMarkup && String(svgMarkup).trim().startsWith('<') ? svgMarkup : defaultMarkerSvg;
    const icon = {
      url: svgToDataUrl(rawSvg),
      scaledSize: new google.maps.Size(30, 30),
      anchor: new google.maps.Point(15, 30),
    };
    iconCache.current.set(key, icon);
    return icon;
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
    } catch {
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

  function buildInfoContent(row, kv, iconSvgRaw, langCode) {
    const title = escapeHtml(pickName(row, langCode));
    const desc = escapeHtml(pickDescriptionFromRow(row, langCode) || kv.description || '');

    const addrByLang = kv.addressByLang || {};
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

    const rating = kv.rating ? parseFloat(kv.rating) : null;
    const ratingTotal = kv.rating_total ? parseInt(kv.rating_total, 10) : null;
    const priceLevel = kv.price ? parseInt(kv.price, 10) : null;
    const openNow = kv.opening_now === 'true' || kv.opening_now === true;

    const hoursByLang = kv.hoursByLang || {};
    let hoursArr = null;
    for (const L of pref) {
      if (hoursByLang[L] && hoursByLang[L].length) {
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

    let ratingHtml = '';
    if (rating || rating === 0) {
      const r = Math.max(0, Math.min(5, Math.round(rating || 0)));
      const stars = '★'.repeat(r) + '☆'.repeat(5 - r);
      ratingHtml = `<div class="iw-row iw-rating">${stars} ${
        rating && rating.toFixed ? rating.toFixed(1) : '0.0'
      }${ratingTotal ? ` (${ratingTotal})` : ''}</div>`;
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

    const btnWind = `<button id="windbtn-${row.id}" class="iw-btn iw-btn-wind">💨 ${label(
      'wind',
      langCode,
    )}</button>`;

    return `
      <div class="w2h-iw">
        <div class="iw-hd">
          <span class="iw-ic">${svgMarkup}</span>
          <div class="iw-title">${title}</div>
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

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        await loadGoogleMaps(lang);
        if (cancelled || !mapRef.current) return;

        mapObj.current = new google.maps.Map(mapRef.current, {
          center: { lat: 45.6, lng: 13.8 },
          zoom: 7,
        });
        infoWin.current = new google.maps.InfoWindow();
        setBooted(true);
      } catch (e) {
        console.error('[w2h] Google Maps load failed:', e);
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
  }, [booted, lang]);

  async function loadMarkers(langCode) {
    const { data: locs, error: e1 } = await supabase
      .from('locations')
      .select(`
        id,lat,lng,category_id,display_name,
        name_de,name_en,name_hr,name_it,name_fr,
        description_de,description_en,description_hr,description_it,description_fr,
        categories:category_id ( icon_svg )
      `);
    if (e1) {
      console.error(e1);
      return;
    }

    const { data: kvRows, error: e2 } = await supabase
      .from('location_values')
      .select(
        'location_id, attribute_id, value_text, value_number, value_option, value_bool, value_json, language_code, attribute_definitions:attribute_id ( key )',
      );
    if (e2) {
      console.warn('location_values load:', e2.message);
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

      // ------------------------------------------------------------
      // Schutz: doppelte nicht-multilinguale Attribute ignorieren
      // ------------------------------------------------------------
      if (
        obj[canon] && // bereits vorhanden
        canon !== 'opening_hours' &&
        canon !== 'address' &&
        canon !== 'photos' &&
        canon !== 'wind_profile' &&
        canon !== 'wind_hint'
      ) {
        console.warn(
          `[w2h] WARNUNG: doppeltes Attribut "${canon}" bei location_id=${locId}.`,
          'Der zusätzliche Eintrag wird ignoriert.',
          r,
        );
        return; // verhindert, dass der zweite Wert überschreibt oder Fehler verursacht
      }

      if (canon === 'photos') {
        const google = normalizeGooglePhotos(
          r.value_json !== null && r.value_json !== undefined ? r.value_json : r.value_text || null,
        );
        if (google.length) {
          obj.photos = (obj.photos || []).concat(google);
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
        } catch (err) {
          console.warn('[w2h] wind_profile JSON parse failed', err);
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
          } catch (err) {
            console.warn('[w2h] wind_hint JSON parse failed', err, r);
          }
        }
        if (lc && text) {
          obj.wind_hint[lc] = text;
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

    const ids = (locs || []).map((l) => l.id);
    let userPhotosMap = {};
    try {
      if (ids.length) {
        const url = `/api/user-photos?ids=${ids.join(',')}`;
        console.log('[w2h] fetch user-photos:', url);
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
    } catch (e) {
      console.warn('[w2h] user-photos fetch failed', e);
    }

    for (const loc of locs || []) {
      const obj = kvByLoc.get(loc.id) || {};
      const google = Array.isArray(obj.photos) ? obj.photos : [];

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

      obj.photos = mergePhotos(google, user);
      obj.first_photo_ref = pickFirstThumb(obj.photos);
      kvByLoc.set(loc.id, obj);
    }

    markers.current.forEach((m) => m.setMap(null));
    markers.current = [];

    (locs || []).forEach((row) => {
      const title = pickName(row, langCode);
      const svg = (row.categories && row.categories.icon_svg) || defaultMarkerSvg;

      const marker = new google.maps.Marker({
        position: { lat: row.lat, lng: row.lng },
        title,
        icon: getMarkerIcon(row.category_id, svg),
        map: mapObj.current,
      });

      marker._cat = String(row.category_id);
      marker.addListener('click', () => {
        const kv = kvByLoc.get(row.id) || {};
        const html = buildInfoContent(row, kv, svg, langCode);
        infoWin.current.setContent(html);
        infoWin.current.open({ map: mapObj.current, anchor: marker });

        google.maps.event.addListenerOnce(infoWin.current, 'domready', () => {
          const btn = document.getElementById(`phbtn-${row.id}`);
          if (btn) {
            btn.addEventListener('click', () => {
              const photos = kv.photos && Array.isArray(kv.photos) ? kv.photos : [];
              if (photos.length) setGallery({ title: pickName(row, langCode), photos });
            });
          }

          const wbtn = document.getElementById(`windbtn-${row.id}`);
          if (wbtn) {
            wbtn.addEventListener('click', () => {
              setWindModal({
                id: row.id,
                title: pickName(row, langCode),
                windProfile: kv.wind_profile || null,
                windHint: kv.wind_hint || {},
              });
            });
          }
        });
      });

      markers.current.push(marker);
    });

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
      <div ref={mapRef} className="w2h-map" />

      <LayerPanel
        lang={lang}
        onInit={(initialMap) => {
          layerState.current = new Map(initialMap);
          applyLayerVisibility();
        }}
        onToggle={(catKey, visible) => {
          layerState.current.set(catKey, visible);
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