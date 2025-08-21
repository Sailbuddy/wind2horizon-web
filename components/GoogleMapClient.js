'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import LayerPanel from '@/components/LayerPanel';
import { defaultMarkerSvg } from '@/components/DefaultMarkerSvg';
import { svgToDataUrl } from '@/lib/utils';

export default function GoogleMapClient({ lang = 'de' }) {
  const mapRef = useRef(null);
  const mapObj = useRef(null);
  const markers = useRef([]);
  const layerState = useRef(new Map());
  const infoWin = useRef(null);
  const [ready, setReady] = useState(false);

  // ----------------------------
  // Helpers
  // ----------------------------
  function escapeHtml(str = '') {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function pickName(row, langCode) {
    return (
      (langCode === 'de' && row.name_de) ||
      (langCode === 'hr' && row.name_hr) ||
      (langCode === 'en' && row.name_en) ||
      row.display_name ||
      row.name_de ||
      row.name_en ||
      '—'
    );
  }

  function label(key, langCode) {
    const L = {
      route:   { de: 'Route', en: 'Directions', it: 'Itinerario', hr: 'Ruta', fr: 'Itinéraire' },
      website: { de: 'Website', en: 'Website',  it: 'Sito',       hr: 'Web',  fr: 'Site' },
      call:    { de: 'Anrufen', en: 'Call',     it: 'Chiama',     hr: 'Nazovi', fr: 'Appeler' },
      open:    { de: 'Geöffnet', en: 'Open now', it: 'Aperto', hr: 'Otvoreno', fr: 'Ouvert' },
      closed:  { de: 'Geschlossen', en: 'Closed', it: 'Chiuso', hr: 'Zatvoreno', fr: 'Fermé' },
      rating:  { de: 'Bewertung', en: 'Rating', it: 'Valutazione', hr: 'Ocjena', fr: 'Note' },
    };
    return (L[key] && (L[key][langCode] || L[key].en)) || key;
  }

  // Mapping attribute_definitions.key -> canonical keys
  const FIELD_MAP = {
    address: ['formatted_address', 'vicinity'],
    website: ['website', 'url'],
    phone: ['formatted_phone_number', 'international_phone_number'],
    description: ['editorial_summary.overview'],
    opening_now: ['opening_hours.open_now'],
    opening_hours: [
      'opening_hours.weekday_text',
      'opening_hours.weekday_text[0]',
      'opening_hours.weekday_text[1]',
      'opening_hours.weekday_text[2]',
      'opening_hours.weekday_text[3]',
      'opening_hours.weekday_text[4]',
      'opening_hours.weekday_text[5]',
      'opening_hours.weekday_text[6]'
    ],
    rating: ['rating'],
    rating_total: ['user_ratings_total'],
    price: ['price_level'],
  };

  function buildInfoContent(row, kv, iconSvgRaw, langCode) {
    const title = escapeHtml(pickName(row, langCode));
    const address = escapeHtml(kv.address || '');
    const website = kv.website || '';
    const phone = kv.phone || '';
    const desc = escapeHtml(kv.description || '');

    const rating = kv.rating ? parseFloat(kv.rating) : null;
    const ratingTotal = kv.rating_total ? parseInt(kv.rating_total) : null;
    const priceLevel = kv.price ? parseInt(kv.price) : null;
    const openNow = kv.opening_now === 'true' || kv.opening_now === true;
    const openingHours = kv.opening_hours ? kv.opening_hours.split('\n') : [];

    const dirHref = `https://www.google.com/maps/dir/?api=1&destination=${row.lat},${row.lng}`;
    const siteHref = website && website.startsWith('http') ? website : (website ? `https://${website}` : '');
    const telHref = phone ? `tel:${phone.replace(/\s+/g, '')}` : '';

    const svgMarkup = iconSvgRaw || defaultMarkerSvg;

    const btnRoute = `<a class="iw-btn" href="${dirHref}" target="_blank" rel="noopener">📍 ${label('route', langCode)}</a>`;
    const btnSite  = siteHref ? `<a class="iw-btn" href="${escapeHtml(siteHref)}" target="_blank" rel="noopener">🌐 ${label('website', langCode)}</a>` : '';
    const btnTel   = telHref  ? `<a class="iw-btn" href="${escapeHtml(telHref)}">📞 ${label('call', langCode)}</a>` : '';

    let ratingHtml = '';
    if (rating || rating === 0) {
      const stars = '★'.repeat(Math.round(rating || 0)) + '☆'.repeat(5 - Math.round(rating || 0));
      ratingHtml = `<div class="iw-row iw-rating">${stars} ${rating?.toFixed ? rating.toFixed(1) : '0.0'}${ratingTotal ? ` (${ratingTotal})` : ''}</div>`;
    }
    let priceHtml = '';
    if (priceLevel !== null && !isNaN(priceLevel)) {
      const p = Math.max(0, Math.min(4, priceLevel));
      priceHtml = `<div class="iw-row iw-price">${'€'.repeat(p || 0)}</div>`;
    }

    let openingHtml = '';
    if (kv.opening_now !== undefined) {
      openingHtml += `<div class="iw-row iw-open">${openNow ? '🟢 ' + label('open', langCode) : '🔴 ' + label('closed', langCode)}</div>`;
    }
    if (openingHours.length > 0) {
      openingHtml += '<ul class="iw-hours">' + openingHours.map(h => `<li>${escapeHtml(h)}</li>`).join('') + '</ul>';
    }

    return `
      <div class="w2h-iw">
        <div class="iw-hd">
          <span class="iw-ic">${svgMarkup}</span>
          <div class="iw-title">${title}</div>
        </div>
        <div class="iw-bd">
          ${address ? `<div class="iw-row iw-addr">📌 ${address}</div>` : ''}
          ${desc ? `<div class="iw-row iw-desc">${desc}</div>` : ''}
          ${ratingHtml}
          ${priceHtml}
          ${openingHtml}
        </div>
        <div class="iw-actions">
          ${btnRoute}${btnSite}${btnTel}
        </div>
      </div>
    `;
  }

  // ----------------------------
  // Google Maps Script laden
  // ----------------------------
  useEffect(() => {
    if (window.google?.maps) { setReady(true); return; }
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=marker&language=${lang}`;
    s.async = true;
    s.onload = () => setReady(true);
    document.head.appendChild(s);
  }, [lang]);

  // ----------------------------
  // Map initialisieren + Marker laden
  // ----------------------------
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    mapObj.current = new google.maps.Map(mapRef.current, { center: { lat: 45.6, lng: 13.8 }, zoom: 7 });
    infoWin.current = new google.maps.InfoWindow();
    loadMarkers(lang);
  }, [ready, lang]);

  // ----------------------------
  // Marker + Zusatzdaten laden (2-STEP-LOAD mit Debug)
  // ----------------------------
  async function loadMarkers(langCode) {
    const { data: locs, error: e1 } = await supabase
      .from('locations')
      .select('id,lat,lng,category_id,display_name,name_de,name_en,name_hr, categories:category_id ( icon_svg )');
    if (e1) { console.error(e1); return; }

    // NOTE: attribute_definitions are currently blocked by RLS (attrIdToKey size was 0)
    // Fallback: map attribute_id directly to canonical keys (from your export)
    // IDs reference: 5=formatted_address, 28=vicinity, 29=website, 25=url, 30=formatted_phone_number,
    // 34=international_phone_number, 14=open_now, 16=weekday_text, 37..43=weekday_text[0..6],
    // 22=rating, 26=user_ratings_total, 21=price_level, 33=editorial_summary.overview
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
    };
    console.log('[w2h] kvRows count =', (kvRows || []).length);

    const kvByLoc = new Map();
    (kvRows || []).forEach(r => {
      const locId = r.location_id;
      const canon = FIELD_MAP_BY_ID[r.attribute_id];
      if (!canon) return;
      const val = r.value_text ?? r.value_option ??
                  (r.value_number !== null && r.value_number !== undefined ? String(r.value_number) : '') ??
                  (r.value_bool !== null && r.value_bool !== undefined ? String(r.value_bool) : '') ??
                  (r.value_json ? JSON.stringify(r.value_json) : '');
      if (!val) return;

      if (!kvByLoc.has(locId)) kvByLoc.set(locId, {});
      const obj = kvByLoc.get(locId);

      if (canon === 'opening_hours') {
        obj.opening_hours = (obj.opening_hours || '') + (obj.opening_hours ? '
' : '') + val;
      } else if (canon === 'address') {
        // language-specific address not needed; take latest
        obj.address = obj.address || val; // keep first non-empty
      } else if (canon === 'website') {
        obj.website = obj.website || val;
      } else if (canon === 'phone') {
        obj.phone = obj.phone || val;
      } else if (canon === 'description') {
        // prefer current UI language if provided; values are not flagged per lang here, keep first
        if (!obj.description || (r.language_code && r.language_code === langCode)) obj.description = val;
      } else {
        obj[canon] = val;
      }
    });

    markers.current.forEach(m => m.setMap(null));(m => m.setMap(null));
    markers.current = [];

    (locs || []).forEach(row => {
      const title = pickName(row, langCode);
      const svg = row.categories?.icon_svg || defaultMarkerSvg;
      const marker = new google.maps.Marker({
        position: { lat: row.lat, lng: row.lng },
        title,
        icon: { url: svgToDataUrl(svg), scaledSize: new google.maps.Size(28, 28), anchor: new google.maps.Point(14, 28) },
        map: mapObj.current
      });
      marker._cat = String(row.category_id);
      marker.addListener('click', () => {
        const kv = kvByLoc.get(row.id) || {};
        console.log('[w2h] kvForLocation', row.id, kv);
        const html = buildInfoContent(row, kv, svg, langCode);
        infoWin.current.setContent(html);
        infoWin.current.open({ map: mapObj.current, anchor: marker });
      });
      markers.current.push(marker);
    });

    applyLayerVisibility();
  }

  function applyLayerVisibility() {
    markers.current.forEach(m => {
      const vis = layerState.current.get(m._cat);
      m.setVisible(vis ?? true);
    });
  }

  return (
    <div className="w2h-map-wrap">
      <div ref={mapRef} className="w2h-map" />
      <LayerPanel
        lang={lang}
        onInit={(initialMap) => { layerState.current = new Map(initialMap); applyLayerVisibility(); }}
        onToggle={(catKey, visible) => { layerState.current.set(catKey, visible); applyLayerVisibility(); }}
      />
      <style jsx>{`
        .w2h-map-wrap { position: relative; height: 100vh; width: 100%; }
        .w2h-map { height: 100%; width: 100%; }
      `}</style>
      <style jsx global>{`
        .gm-style .w2h-iw { max-width: 280px; font: 13px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #1a1a1a; }
        .gm-style .w2h-iw .iw-hd { display: grid; grid-template-columns: 22px 1fr; gap: 8px; align-items: center; margin-bottom: 6px; }
        .gm-style .w2h-iw .iw-ic svg { width: 20px; height: 20px; }
        .gm-style .w2h-iw .iw-title { font-weight: 700; font-size: 14px; }
        .gm-style .w2h-iw .iw-row { margin: 6px 0; }
        .gm-style .w2h-iw .iw-desc { color: #444; white-space: normal; }
        .gm-style .w2h-iw .iw-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
        .gm-style .w2h-iw .iw-btn { display: inline-block; padding: 6px 10px; border-radius: 8px; background: #1f6aa2; color: #fff; text-decoration: none; font-weight: 600; font-size: 12px; }
        .gm-style .w2h-iw .iw-btn:hover { filter: brightness(0.95); }
        .gm-style .w2h-iw .iw-rating { font-size: 13px; color: #f39c12; }
        .gm-style .w2h-iw .iw-price { font-size: 13px; color: #27ae60; }
        .gm-style .w2h-iw .iw-open { font-size: 13px; }
        .gm-style .w2h-iw .iw-hours { padding-left: 16px; margin: 4px 0; }
      `}</style>
    </div>
  );
}
