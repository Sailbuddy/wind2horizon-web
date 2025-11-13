'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import LayerPanel from '@/components/LayerPanel';
import { defaultMarkerSvg } from '@/components/DefaultMarkerSvg';
import { svgToDataUrl } from '@/lib/utils';

// --------------------------------------------------------------
// Doppel-Wind-/Schwell-Rose (read-only)
// --------------------------------------------------------------
const DIRS = ['N','NO','O','SO','S','SW','W','NW'];
const ANGLE = { N:0, NO:45, O:90, SO:135, S:180, SW:225, W:270, NW:315 };

function WindSwellRose({ size = 260, wind = {}, swell = {} }) {
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.40;
  const innerR = size * 0.24;
  const arrowL = size * 0.085;
  const arrowW = size * 0.06;

  const normBool = (m) => {
    const out = {};
    DIRS.forEach(d => { out[d] = !!m?.[d]; });
    return out;
  };

  const w = normBool(wind);
  const s = normBool(swell);

  const arrow = (deg, r) => {
    const rad = (deg - 90) * Math.PI / 180;
    const tipX = cx + Math.cos(rad) * (r - arrowL);
    const tipY = cy + Math.sin(rad) * (r - arrowL);
    const baseX = cx + Math.cos(rad) * r;
    const baseY = cy + Math.sin(rad) * r;
    const nx = Math.cos(rad + Math.PI / 2) * (arrowW / 2);
    const ny = Math.sin(rad + Math.PI / 2) * (arrowW / 2);
    return `${tipX},${tipY} ${baseX - nx},${baseY - ny} ${baseX + nx},${baseY + ny}`;
  };

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img">
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
        const rad = (ANGLE[d] - 90) * Math.PI / 180;
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

// --------------------------------------------------------------
// Lightbox + WindModal
// --------------------------------------------------------------

function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
export default function GoogleMapClient({ lang = 'de' }) {
  const mapRef = useRef(null);
  const mapObj = useRef(null);
  const markers = useRef([]);
  const layerState = useRef(new Map());
  const infoWin = useRef(null);
  const iconCache = useRef(new Map());

  const [booted, setBooted] = useState(false);
  const [gallery, setGallery] = useState(null);
  const [windModal, setWindModal] = useState(null);

  const photoUrl = (ref, max = 800) =>
    `/api/gphoto?photoreference=${encodeURIComponent(ref)}&maxwidth=${max}`;

  // ---------------------------------------------------------
  // Google Maps Loader
  // ---------------------------------------------------------
  function loadGoogleMaps(language) {
    return new Promise((resolve, reject) => {
      if (window.google?.maps) return resolve();
      const existing = document.querySelector('script[data-w2h-gmaps]');
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', reject, { once: true });
        return;
      }
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=marker&language=${language}`;
      s.async = true;
      s.defer = true;
      s.dataset.w2hGmaps = '1';
      s.addEventListener('load', resolve, { once: true });
      s.addEventListener('error', reject, { once: true });
      document.head.appendChild(s);
    });
  }

  // ---------------------------------------------------------
  // Kleine Hilfen
  // ---------------------------------------------------------
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

  // ---------------------------------------------------------
  // IDs -> Feldnamen Mapping
  // ---------------------------------------------------------
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
  };

  // Neue Attribute nach Key
  const FIELD_MAP_BY_KEY = {
    wind_profile: 'wind_profile',
    wind_swell_profile: 'wind_profile',
    wind_hint: 'wind_hint',
    wind_note: 'wind_hint',
  };

  // ---------------------------------------------------------
  // Marker Icon Cache
  // ---------------------------------------------------------
  function getMarkerIcon(catId, svgMarkup) {
    const key = String(catId ?? 'default');
    if (iconCache.current.has(key)) return iconCache.current.get(key);

    const rawSvg =
      svgMarkup && String(svgMarkup).trim().startsWith('<')
        ? svgMarkup
        : defaultMarkerSvg;

    const icon = {
      url: svgToDataUrl(rawSvg),
      scaledSize: new google.maps.Size(30, 30),
      anchor: new google.maps.Point(15, 30),
    };

    iconCache.current.set(key, icon);
    return icon;
  }

  // ---------------------------------------------------------
  // Photos (Google & User)
  // ---------------------------------------------------------
  function normalizeGooglePhotos(val) {
    try {
      let arr = null;
      if (Array.isArray(val)) arr = val;
      else if (typeof val === 'string' && val.trim().startsWith('['))
        arr = JSON.parse(val);

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

    // 1 – User-Foto bevorzugen
    const user = photos.find((p) => p.thumb || p.public_url || p.url);
    if (user) return user.thumb || user.public_url || user.url;

    // 2 – Google
    const g = photos.find((p) => p.photo_reference || p.photoreference);
    if (g) return photoUrl(g.photo_reference || g.photoreference, 400);

    return null;
  }

  // ---------------------------------------------------------
  // Haupt-Loader für Marker + Attribute
  // ---------------------------------------------------------
  async function loadMarkers(langCode) {
    // ---- Locations --------------------------------------------------
    const { data: locs, error: e1 } = await supabase
      .from('locations')
      .select(`
        id, lat, lng, category_id, display_name,
        name_de, name_en, name_hr, name_it, name_fr,
        description_de, description_en, description_hr, description_it, description_fr,
        categories:category_id ( icon_svg )
      `);

    if (e1) {
      console.error('[w2h] locations:', e1);
      return;
    }

    // ---- Attribute (location_values) -------------------------------
    const { data: kvRows, error: e2 } = await supabase
      .from('location_values')
      .select(`
        location_id,
        attribute_id,
        value_text,
        value_number,
        value_option,
        value_bool,
        value_json,
        language_code,
        attribute_definitions:attribute_id ( key )
      `);

    if (e2) console.warn('[w2h] location_values:', e2);

    const kvByLoc = new Map();

    (kvRows || []).forEach((r) => {
      const locId = r.location_id;

      const key = r.attribute_definitions?.key || null;
      const canon =
        FIELD_MAP_BY_ID[r.attribute_id] ||
        (key && FIELD_MAP_BY_KEY[key]);

      if (!canon) return;

      if (!kvByLoc.has(locId)) kvByLoc.set(locId, {});
      const obj = kvByLoc.get(locId);

      const lc = (r.language_code || '').toLowerCase();

      // --------------------------------------------------------------
      // DUPLIKATSCHUTZ Nicht-Multilingual
      // --------------------------------------------------------------
      if (
        obj[canon] &&
        canon !== 'opening_hours' &&
        canon !== 'address' &&
        canon !== 'photos' &&
        canon !== 'wind_profile' &&
        canon !== 'wind_hint'
      ) {
        console.warn(
          `[w2h] WARNUNG: doppeltes Attribut "${canon}" bei location_id=${locId}. Eintritt ignoriert.`
        );
        return;
      }

      // --------------------------------------------------------------
      // FOTO-Handling
      // --------------------------------------------------------------
      if (canon === 'photos') {
        const google = normalizeGooglePhotos(
          r.value_json ?? r.value_text ?? null
        );
        if (google.length) {
          obj.photos = (obj.photos || []).concat(google);
        }
        return;
      }

      // --------------------------------------------------------------
      // WIND-PROFILE
      // --------------------------------------------------------------
      if (canon === 'wind_profile') {
        try {
          obj.wind_profile =
            typeof r.value_json === 'object'
              ? r.value_json
              : JSON.parse(r.value_json || '{}');
        } catch {
          obj.wind_profile = null;
        }
        return;
      }

      // --------------------------------------------------------------
      // WIND-HINT (multilingual)
      // --------------------------------------------------------------
      if (canon === 'wind_hint') {
        obj.wind_hint = obj.wind_hint || {};
        if (lc) obj.wind_hint[lc] = r.value_text || '';
        return;
      }

      // --------------------------------------------------------------
      // Generische Werte
      // --------------------------------------------------------------
      const val =
        r.value_text ??
        r.value_option ??
        (r.value_number !== null && r.value_number !== undefined
          ? String(r.value_number)
          : '') ??
        (r.value_bool !== null && r.value_bool !== undefined
          ? String(r.value_bool)
          : '') ??
        (r.value_json ? r.value_json : '');

      if (!val) return;

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
        if (lc)
          obj.addressByLang[lc] =
            obj.addressByLang[lc] || String(val);
        else obj.address = obj.address || String(val);
      } else if (canon === 'website' || canon === 'phone') {
        obj[canon] = obj[canon] || String(val);
      } else if (canon === 'description') {
        if (!obj.description || (lc && lc === langCode))
          obj.description = String(val);
      } else {
        obj[canon] = String(val);
      }
    });

    // --------------------------------------------------------------
    // User Photos per API
    // --------------------------------------------------------------
    const ids = (locs || []).map((l) => l.id);
    let userPhotosMap = {};

    try {
      if (ids.length) {
        const resp = await fetch(
          `/api/user-photos?ids=${ids.join(',')}`,
          { cache: 'no-store' }
        );
        const j = await resp.json();

        if (j?.ok && j.items) {
          userPhotosMap = j.items || {};
        } else if (Array.isArray(j?.rows)) {
          const map = {};
          j.rows.forEach((r) => {
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
          });
          userPhotosMap = map;
        }
      }
    } catch (e) {
      console.warn('[w2h] user-photos failed', e);
    }

    // --------------------------------------------------------------
    // Google + User Photos mergen
    // --------------------------------------------------------------
    (locs || []).forEach((loc) => {
      const obj = kvByLoc.get(loc.id) || {};
      const google = Array.isArray(obj.photos) ? obj.photos : [];
      const user = (userPhotosMap[loc.id] || []).map((p) => ({
        public_url: p.public_url || p.url || null,
        url: p.url || p.public_url || null,
        thumb: p.thumb || p.public_url || null,
        caption: p.caption || null,
        author: p.author || null,
        source: 'user',
      }));

      obj.photos = mergePhotos(google, user);
      obj.first_photo_ref = pickFirstThumb(obj.photos);
      kvByLoc.set(loc.id, obj);
    });

    // --------------------------------------------------------------
    // Alte Marker entfernen
    // --------------------------------------------------------------
    markers.current.forEach((m) => m.setMap(null));
    markers.current = [];

    // --------------------------------------------------------------
    // Neue Marker setzen
    // --------------------------------------------------------------
    (locs || []).forEach((row) => {
      const title = pickName(row, langCode);
      const svg = row.categories?.icon_svg || defaultMarkerSvg;

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
        infoWin.current.open({
          map: mapObj.current,
          anchor: marker,
        });

        google.maps.event.addListenerOnce(
          infoWin.current,
          'domready',
          () => {
            // Photos Button
            const btn = document.getElementById(
              `phbtn-${row.id}`
            );
            if (btn) {
              btn.addEventListener('click', () => {
                const photos =
                  kv.photos && Array.isArray(kv.photos)
                    ? kv.photos
                    : [];
                if (photos.length)
                  setGallery({
                    title: pickName(row, langCode),
                    photos,
                  });
              });
            }

            // Wind-Button
            const wbtn = document.getElementById(
              `windbtn-${row.id}`
            );
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
          }
        );
      });

      markers.current.push(marker);
    });

    applyLayerVisibility();
  }

  // ---------------------------------------------------------
  // Layer Filter
  // ---------------------------------------------------------
  function applyLayerVisibility() {
    markers.current.forEach((m) => {
      const vis = layerState.current.get(m._cat);
      m.setVisible(vis ?? true);
    });
  }
  // ---------------------------------------------------------
  // InfoWindow Inhalt erzeugen
  // ---------------------------------------------------------
  function buildInfoContent(row, kv, iconSvgRaw, langCode) {
    const title = escapeHtml(pickName(row, langCode));
    const desc = escapeHtml(
      pickDescriptionFromRow(row, langCode) || kv.description || ''
    );

    // Adresse
    const addrByLang = kv.addressByLang || {};
    const pref = [langCode, 'de', 'en', 'it', 'fr', 'hr'];
    let addrSel = '';
    for (const L of pref) if (addrByLang[L]) { addrSel = addrByLang[L]; break; }
    const address = escapeHtml(addrSel || kv.address || '');

    const website = kv.website || '';
    const phone = kv.phone || '';

    const rating = kv.rating ? parseFloat(kv.rating) : null;
    const ratingTotal = kv.rating_total ? parseInt(kv.rating_total) : null;
    const priceLevel = kv.price ? parseInt(kv.price) : null;
    const openNow = kv.opening_now === 'true' || kv.opening_now === true;

    const hoursByLang = kv.hoursByLang || {};
    let hoursArr = null;
    for (const L of pref)
      if (hoursByLang[L]?.length) {
        hoursArr = hoursByLang[L];
        break;
      }

    const hoursLocalized =
      hoursArr ? localizeHoursList(hoursArr, langCode) : null;

    const photos = Array.isArray(kv.photos) ? kv.photos : [];
    const firstThumb = pickFirstThumb(photos);

    const dirHref = `https://www.google.com/maps/dir/?api=1&destination=${row.lat},${row.lng}`;
    const siteHref =
      website && website.startsWith('http')
        ? website
        : website
        ? `https://${website}`
        : '';
    const telHref = phone ? `tel:${String(phone).replace(/\s+/g, '')}` : '';

    const svgMarkup = iconSvgRaw || defaultMarkerSvg;

    const btnRoute = `<a class="iw-btn" href="${dirHref}" target="_blank" rel="noopener">📍 ${label('route', langCode)}</a>`;
    const btnSite = siteHref
      ? `<a class="iw-btn" href="${escapeHtml(siteHref)}" target="_blank" rel="noopener">🌐 ${label('website', langCode)}</a>`
      : '';
    const btnTel = telHref
      ? `<a class="iw-btn" href="${escapeHtml(telHref)}">📞 ${label('call', langCode)}</a>`
      : '';

    let ratingHtml = '';
    if (rating || rating === 0) {
      const r = Math.max(0, Math.min(5, Math.round(rating || 0)));
      const stars = '★'.repeat(r) + '☆'.repeat(5 - r);
      ratingHtml = `<div class="iw-row iw-rating">${stars} ${
        rating?.toFixed ? rating.toFixed(1) : '0.0'
      }${ratingTotal ? ` (${ratingTotal})` : ''}</div>`;
    }

    let priceHtml = '';
    if (priceLevel !== null && !isNaN(priceLevel)) {
      const p = Math.max(0, Math.min(4, priceLevel));
      priceHtml = `<div class="iw-row iw-price">${'€'.repeat(p)}</div>`;
    }

    let openingHtml = '';
    if (kv.opening_now !== undefined) {
      openingHtml += `<div class="iw-row iw-open">${
        openNow ? '🟢 ' + label('open', langCode) : '🔴 ' + label('closed', langCode)
      }</div>`;
    }
    if (hoursLocalized && hoursLocalized.length) {
      openingHtml +=
        '<ul class="iw-hours">' +
        hoursLocalized
          .map((h) => `<li>${escapeHtml(String(h))}</li>`)
          .join('') +
        '</ul>';
    }

    const thumbHtml = firstThumb
      ? `<img src="${firstThumb}" alt="" loading="lazy"
          style="width:100%;border-radius:10px;margin:6px 0 10px 0;" />`
      : '';

    const btnPhotos = photos.length
      ? `<button id="phbtn-${row.id}" class="iw-btn" style="background:#6b7280;">🖼️ ${label(
          'photos',
          langCode
        )} (${photos.length})</button>`
      : '';

    const btnWind = `<button id="windbtn-${row.id}" class="iw-btn iw-btn-wind">💨 ${label(
      'wind',
      langCode
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

  // ---------------------------------------------------------
  // MAP LIFECYCLE
  // ---------------------------------------------------------
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
        console.error('[w2h] Google Maps failed:', e);
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

  // ---------------------------------------------------------
  // RETURN BLOCK (JSX)
  // ---------------------------------------------------------
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

      {/* Map Container Styles */}
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

      {/* InfoWindow Styles */}
      <style jsx global>{`
        .gm-style .w2h-iw {
          max-width: 340px;
          font: 13px/1.35 system-ui, sans-serif;
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
