'use client';

import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import LayerPanel from '@/components/LayerPanel';
import { defaultMarkerSvg } from '@/components/DefaultMarkerSvg';
import { svgToDataUrl } from '@/lib/utils';

export default function GoogleMapClient({ lang = 'de' }) {
  const mapRef = useRef(null);
  const mapObj = useRef(null);
  const markers = useRef([]);              // google.maps.Marker[]
  const layerState = useRef(new Map());    // Map<string, boolean>
  const infoWin = useRef(null);            // Singleton InfoWindow
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

  function pickDescription(kv = {}, langCode) {
    const keys = {
      de: 'description_de',
      en: 'description_en',
      hr: 'description_hr',
      fr: 'description_fr',
      it: 'description_it',
    };
    const key = keys[langCode] || 'description_en';
    return kv[key] || kv.description || '';
  }

  function buildInfoContent(row, kv, iconSvgRaw, langCode) {
    const title = escapeHtml(pickName(row, langCode));
    const address = escapeHtml(kv[`address_${langCode}`] || kv.address || kv.addr || '');
    const website = kv.website || kv.url || kv.link || kv.homepage || kv.site || kv.google_website || '';
    const phone = kv.phone || kv.tel || '';
    const desc = escapeHtml(pickDescription(kv, langCode));

    // Handliche Links
    const dirHref = `https://www.google.com/maps/dir/?api=1&destination=${row.lat},${row.lng}`;
    const siteHref = website && website.startsWith('http') ? website : (website ? `https://${website}` : '');
    const telHref = phone ? `tel:${phone.replace(/\s+/g, '')}` : '';

    // Icon (SVG Rohmarkup; wenn leer → Default)
    const svgMarkup = iconSvgRaw || defaultMarkerSvg;

    // Buttons (nur rendern, wenn Daten vorhanden)
    const btnRoute = `<a class="iw-btn" href="${dirHref}" target="_blank" rel="noopener">📍 ${label('route', langCode)}</a>`;
    const btnSite  = siteHref ? `<a class="iw-btn" href="${escapeHtml(siteHref)}" target="_blank" rel="noopener">🌐 ${label('website', langCode)}</a>` : '';
    const btnTel   = telHref  ? `<a class="iw-btn" href="${escapeHtml(telHref)}">📞 ${label('call', langCode)}</a>` : '';

    // HTML-Card
    return `
      <div class="w2h-iw">
        <div class="iw-hd">
          <span class="iw-ic">${svgMarkup}</span>
          <div class="iw-title">${title}</div>
        </div>
        <div class="iw-bd">
          ${address ? `<div class="iw-row iw-addr">📌 ${address}</div>` : ''}
          ${desc ? `<div class="iw-row iw-desc">${desc}</div>` : ''}
        </div>
        <div class="iw-actions">
          ${btnRoute}${btnSite}${btnTel}
        </div>
      </div>
    `;
  }

  function label(key, langCode) {
    const L = {
      route:   { de: 'Route', en: 'Directions', it: 'Itinerario', hr: 'Ruta', fr: 'Itinéraire' },
      website: { de: 'Website', en: 'Website',  it: 'Sito',       hr: 'Web',  fr: 'Site' },
      call:    { de: 'Anrufen', en: 'Call',     it: 'Chiama',     hr: 'Nazovi', fr: 'Appeler' },
    };
    return (L[key] && (L[key][langCode] || L[key].en)) || key;
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

    mapObj.current = new google.maps.Map(mapRef.current, {
      center: { lat: 45.6, lng: 13.8 },
      zoom: 7,
    });

    // InfoWindow Singleton
    infoWin.current = new google.maps.InfoWindow();

    loadMarkers(lang);
  }, [ready, lang]);

  // ----------------------------
  // Marker + Zusatzdaten laden
  // ----------------------------
  async function loadMarkers(langCode) {
    // 1) Locations + Kategorie-Icon
    const { data: locs, error: e1 } = await supabase
      .from('locations')
      .select(`
        id,lat,lng,category_id,display_name,name_de,name_en,name_hr,
        categories:category_id ( icon_svg )
      `);

    if (e1) { console.error(e1); return; }

    // 2) Key-Value Zusatzinfos (optional) – neue Schema-Variante
    // location_values hat KEIN (key,value), sondern attribute_id + language_code + value_*
    // -> wir joinen attribute_definitions, um den Key-Namen zu bekommen
    const { data: kvRows, error: e2 } = await supabase
      .from('location_values')
      .select(`
        location_id,
        attribute_id,
        value_text,
        value_number,
        value_option,
        language_code,
        attribute:attribute_id ( key, data_type )
      `);

    if (e2) { console.warn('location_values optional:', e2.message); }

    // Map: location_id -> { key: value, ... }
    const kvByLoc = new Map();
    (kvRows || []).forEach(r => {
      const locId = r.location_id;
      const keyName = r.attribute?.key; // z. B. 'address', 'website', 'phone', 'description'
      if (!keyName) return;

      // Wert zusammenbauen (bevorzugt Text)
      const val =
        (r.value_text ?? null) ??
        (r.value_option ?? null) ??
        (r.value_number !== null && r.value_number !== undefined ? String(r.value_number) : '');
      if (!val) return;

      if (!kvByLoc.has(locId)) kvByLoc.set(locId, {});
      const obj = kvByLoc.get(locId);

      // Sprach-spezifische Keys ablegen (description/address)
      const lc = (r.language_code || '').toLowerCase();
      if ((keyName === 'description' || keyName === 'address') && lc) {
        obj[`${keyName}_${lc}`] = val; // z. B. description_de, address_en
        // zusätzlich eine Default-Adresse setzen, falls noch nicht vorhanden
        if (keyName === 'address' && !obj.address) obj.address = val;
        return;
      }

      // Generische Keys ablegen
      obj[keyName] = val; // z. B. website, phone, google_map_url, price_level, rating
    });

    // alte Marker entfernen
    markers.current.forEach(m => m.setMap(null));
    markers.current = [];

    (locs || []).forEach(row => {
      const title = pickName(row, langCode);
      const svg = row.categories?.icon_svg || defaultMarkerSvg;

      const marker = new google.maps.Marker({
        position: { lat: row.lat, lng: row.lng },
        title,
        icon: {
          url: svgToDataUrl(svg),
          scaledSize: new google.maps.Size(28, 28),
          anchor: new google.maps.Point(14, 28)
        },
        map: mapObj.current
      });

      marker._cat = String(row.category_id);

      marker.addListener('click', () => {
        const kv = kvByLoc.get(row.id) || {};
        const html = buildInfoContent(row, kv, svg, langCode);
        infoWin.current.setContent(html);
        infoWin.current.open({ map: mapObj.current, anchor: marker });
      });

      markers.current.push(marker);
    });

    applyLayerVisibility();
  }

  // ----------------------------
  // Layer anwenden
  // ----------------------------
  function applyLayerVisibility() {
    markers.current.forEach(m => {
      const vis = layerState.current.get(m._cat);
      m.setVisible(vis ?? true);
    });
  }

  // ----------------------------
  // Render
  // ----------------------------
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

      <style jsx>{`
        .w2h-map-wrap { position: relative; height: 100vh; width: 100%; }
        .w2h-map { height: 100%; width: 100%; }
      `}</style>

      {/* InfoWindow Styles global */}
      <style jsx global>{`
        .gm-style .w2h-iw {
          max-width: 280px;
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
          width: 20px; height: 20px;
        }
        .gm-style .w2h-iw .iw-title {
          font-weight: 700;
          font-size: 14px;
        }
        .gm-style .w2h-iw .iw-row {
          margin: 6px 0;
        }
        .gm-style .w2h-iw .iw-addr {
          white-space: normal;
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
        }
        .gm-style .w2h-iw .iw-btn:hover {
          filter: brightness(0.95);
        }
      `}</style>
    </div>
  );
}
