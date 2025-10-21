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
  const iconCache = useRef(new Map()); // category_id -> google.maps.Icon
  const [booted, setBooted] = useState(false);

  // -------------------------------------------------
  // Google Maps Loader (robust, ohne plugins.loader)
  // -------------------------------------------------
  function loadGoogleMaps(language) {
    return new Promise((resolve, reject) => {
      if (window.google?.maps) return resolve();
      const existing = document.querySelector('script[data-w2h-gmaps]');
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', (e) => reject(e), { once: true });
        return;
      }
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=marker&language=${language}`;
      s.async = true;
      s.defer = true;
      s.dataset.w2hGmaps = '1';
      s.addEventListener('load', () => resolve(), { once: true });
      s.addEventListener('error', (e) => reject(e), { once: true });
      document.head.appendChild(s);
    });
  }

  // -------------------------------------------------
  // Helpers
  // -------------------------------------------------
  function escapeHtml(str = '') {
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  // manchmal Encoding-Artefakte reparieren
  function repairMojibake(s = '') {
    return /Ã|Å|Â/.test(s) ? decodeURIComponent(escape(s)) : s;
  }

  function pickName(row, langCode) {
    const raw = (
      (langCode === 'de' && row.name_de) ||
      (langCode === 'it' && row.name_it) ||
      (langCode === 'fr' && row.name_fr) ||
      (langCode === 'hr' && row.name_hr) ||
      (langCode === 'en' && row.name_en) ||
      row.display_name ||
      row.name_de ||
      row.name_en ||
      ''
    );
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
      route:   { de: 'Route', en: 'Directions', it: 'Itinerario', hr: 'Ruta',  fr: 'Itinéraire' },
      website: { de: 'Website', en: 'Website',  it: 'Sito',       hr: 'Web',   fr: 'Site' },
      call:    { de: 'Anrufen', en: 'Call',     it: 'Chiama',     hr: 'Nazovi',fr: 'Appeler' },
      open:    { de: 'Geöffnet', en: 'Open now', it: 'Aperto',    hr: 'Otvoreno', fr: 'Ouvert' },
      closed:  { de: 'Geschlossen', en: 'Closed', it: 'Chiuso',   hr: 'Zatvoreno', fr: 'Fermé' },
    };
    return (L[key] && (L[key][langCode] || L[key].en)) || key;
  }

  // -------------------------------------------------
  // Öffnungszeiten: Internationalisierung der Wochentage
  // -------------------------------------------------
  const DAY_OUTPUT = {
    de: ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'],
    en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    it: ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'],
    fr: ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'],
    hr: ['Ponedjeljak', 'Utorak', 'Srijeda', 'Četvrtak', 'Petak', 'Subota', 'Nedjelja'],
  };
  const DAY_ALIASES = new Map([
    // EN
    ['monday',0],['mon',0],['tuesday',1],['tue',1],['tues',1],['wednesday',2],['wed',2],
    ['thursday',3],['thu',3],['thur',3],['thurs',3],['friday',4],['fri',4],['saturday',5],['sat',5],
    ['sunday',6],['sun',6],
    // DE
    ['montag',0],['mo',0],['dienstag',1],['di',1],['mittwoch',2],['mi',2],['donnerstag',3],['do',3],
    ['freitag',4],['fr',4],['samstag',5],['sa',5],['sonntag',6],['so',6],
    // IT
    ['lunedì',0],['lunedi',0],['lun',0],['martedì',1],['martedi',1],['mar',1],['mercoledì',2],
    ['mercoledi',2],['mer',2],['giovedì',3],['giovedi',3],['gio',3],['venerdì',4],['venerdi',4],['ven',4],
    ['sabato',5],['sab',5],['domenica',6],['dom',6],
    // FR
    ['lundi',0],['lun',0],['mardi',1],['mar',1],['mercredi',2],['mer',2],['jeudi',3],['jeu',3],
    ['vendredi',4],['ven',4],['samedi',5],['sam',5],['dimanche',6],['dim',6],
    // HR
    ['ponedjeljak',0],['pon',0],['utorak',1],['uto',1],['srijeda',2],['sri',2],
    ['četvrtak',3],['cetvrtak',3],['čet',3],['cet',3],['petak',4],['pet',4],
    ['subota',5],['sub',5],['nedjelja',6],['ned',6],
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

  // Mapping per attribute_id (robust gegen RLS auf attribute_definitions)
  // IDs aus deinem Export:
  // 5=formatted_address, 28=vicinity, 29=website, 25=url, 30=formatted_phone_number, 34=international_phone_number,
  // 14=opening_hours.open_now, 16=opening_hours.weekday_text, 37..43=weekday_text[0..6], 22=rating, 26=user_ratings_total,
  // 21=price_level, 33=editorial_summary.overview
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

  function getMarkerIcon(catId, svgMarkup) {
    const key = String(catId ?? 'default');
    if (iconCache.current.has(key)) return iconCache.current.get(key);
    const rawSvg = (svgMarkup && String(svgMarkup).trim().startsWith('<')) ? svgMarkup : defaultMarkerSvg;
    const icon = {
      url: svgToDataUrl(rawSvg),
      scaledSize: new google.maps.Size(30, 30),
      anchor: new google.maps.Point(15, 30)
    };
    iconCache.current.set(key, icon);
    return icon;
  }

  
  // Tabs: i18n-Labels
  const TAB_LABELS = {
    overview: { de: 'Übersicht', en: 'Overview', it: 'Panoramica', hr: 'Pregled', fr: 'Aperçu' },
    details:  { de: 'Details',   en: 'Details',   it: 'Dettagli',  hr: 'Detalji', fr: 'Détails' },
    safety:   { de: 'Sicherheit',en: 'Safety',    it: 'Sicurezza', hr: 'Sigurnost', fr: 'Sécurité' },
    contact:  { de: 'Kontakt',   en: 'Contact',   it: 'Contatti',  hr: 'Kontakt', fr: 'Contact' },
    route:    { de: 'Route',     en: 'Route',     it: 'Percorso',  hr: 'Ruta', fr: 'Itinéraire' },
    website:  { de: 'Website',   en: 'Website',   it: 'Sito web',  hr: 'Web-stranica', fr: 'Site web' },
    call:     { de: 'Anrufen',   en: 'Call',      it: 'Chiama',    hr: 'Nazovi', fr: 'Appeler' },
    open_now: { de: 'Jetzt geöffnet', en: 'Open now', it: 'Aperto ora', hr: 'Otvoreno sada', fr: 'Ouvert maintenant' },
  };

  function buildInfoContent(row, kv, iconSvgRaw, langCode) {
    const L = (TAB_LABELS.overview[langCode] ? langCode : 'de');
    const title = escapeHtml(pickName(row, L));
    const desc = escapeHtml(pickDescriptionFromRow(row, L) || kv.description || '');

    // Adresse: sprachabhängig auswählen
    const addrByLang = kv.addressByLang || {};
    const pref = [L, 'de', 'en', 'it', 'fr', 'hr'];
    let addrSel = '';
    for (const p of pref) if (addrByLang[p]) { addrSel = addrByLang[p]; break; }
    const address = escapeHtml(addrSel || kv.address || '');

    // Öffnungszeiten
    const openingNow = kv.opening_now === 'true' || kv.opening_now === true;
    const hoursArr = [];
    if (kv.opening_hours && Array.isArray(kv.opening_hours)) hoursArr.push(...kv.opening_hours);

    // Rating / Preis
    const rating = kv.rating ? parseFloat(kv.rating) : null;
    const ratingTotal = kv.rating_total ? parseInt(kv.rating_total) : null;
    const price = kv.price ? Math.max(0, Math.min(4, parseInt(kv.price))) : null;
    const euros = Number.isFinite(price) ? '€'.repeat(price) : '';

    // Kontakt
    const website = kv.website || '';
    const phone = kv.phone || '';

    // Sicherheit (optional – Panel nur sichtbar, wenn Inhalte vorhanden)
    const safetyLis = []; // TODO: populate when we add danger_wind_*

    // Sichtbarkeit der Panels
    const showOverview = true;
    const showDetails  = Boolean(address || hoursArr.length);
    const showSafety   = safetyLis.length > 0;
    const showContact  = Boolean(website || phone);

    const tabs = [
      showOverview && { key:'overview', label:TAB_LABELS.overview[L] },
      showDetails  && { key:'details',  label:TAB_LABELS.details[L]  },
      showSafety   && { key:'safety',   label:TAB_LABELS.safety[L]   },
      showContact  && { key:'contact',  label:TAB_LABELS.contact[L]  },
    ].filter(Boolean);
    const firstKey = tabs.length ? tabs[0].key : 'overview';

    // Panels content
    const overviewLis = [];
    if (openingNow) overviewLis.push(`<li class="iw-row iw-open">• ${TAB_LABELS.open_now[L]}</li>`);
    if (rating !== null) overviewLis.push(`<li class="iw-row iw-rating">• ${rating.toFixed(1)}★${ratingTotal?` (${ratingTotal})`:''}</li>`);
    if (euros) overviewLis.push(`<li class="iw-row iw-price">• ${euros}</li>`);
    if (desc) overviewLis.push(`<li class="iw-row iw-desc">${desc}</li>`);

    const detailsLis = [];
    if (address) detailsLis.push(`<li class="iw-row">• ${address}</li>`);
    if (hoursArr.length) {
      if (openingNow) detailsLis.push(`<li class="iw-row iw-open">${TAB_LABELS.open_now[L]}</li>`);
      detailsLis.push(`<li class="iw-row iw-hours">${hoursArr.map(h => escapeHtml(String(h))).join('<br/>')}</li>`);
    }

    const safetyHtml = safetyLis.length ? `<ul class="iw-list">${safetyLis.join('')}</ul>` : '';

    const contactBtns = `
      <div class="iw-actions">
        <a class="iw-btn" style="background:#2563eb" target="_blank" rel="noreferrer"
           href="https://www.google.com/maps/dir/?api=1&destination=${row.lat},${row.lng}">${TAB_LABELS.route[L]}</a>
        ${website ? `<a class="iw-btn" style="background:#0d9488" target="_blank" rel="noreferrer" href="${website}">${TAB_LABELS.website[L]}</a>` : ''}
        ${phone ? `<a class="iw-btn" style="background:#16a34a" href="tel:${phone}">${TAB_LABELS.call[L]}</a>` : ''}
      </div>`;

    const tabsHtml = tabs.map((t,i)=>`<button class="iw-tab ${i===0?'active':''}" data-w2h-tab="${t.key}">${t.label}</button>`).join('');

    const panelsHtml = `
      ${showOverview ? `<div class="iw-panel" data-w2h-panel="overview">${overviewLis.length?`<ul class="iw-list">${overviewLis.join('')}</ul>`:''}</div>`:''}
      ${showDetails  ? `<div class="iw-panel" data-w2h-panel="details" hidden>${detailsLis.length?`<ul class="iw-list">${detailsLis.join('')}</ul>`:''}</div>`:''}
      ${showSafety   ? `<div class="iw-panel" data-w2h-panel="safety" hidden>${safetyHtml}</div>`:''}
      ${showContact  ? `<div class="iw-panel" data-w2h-panel="contact" hidden">${contactBtns}</div>`:''}
    `;

    return `
      <div class="w2h-iw">
        <div class="iw-hd">
          <div class="iw-ic">${iconSvgRaw || ''}</div>
          <div class="iw-title">${title}</div>
        </div>
        <div class="iw-tabs">${tabsHtml}</div>
        <div class="iw-body">${panelsHtml}</div>
      </div>
      <script>(function(){try{
        var root = document.currentScript.previousElementSibling;
        while (root && !root.classList.contains('w2h-iw')) root = root.previousElementSibling;
        if(!root) return;
        var btns = root.querySelectorAll('.iw-tab');
        var panels = root.querySelectorAll('.iw-panel');
        function show(key){
          panels.forEach(function(p){ p.toggleAttribute('hidden', p.getAttribute('data-w2h-panel')!==key); });
          btns.forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-w2h-tab')===key); });
        }
        btns.forEach(function(b){ b.addEventListener('click', function(){ show(b.getAttribute('data-w2h-tab')); }); });
        show('${firstKey}');
      }catch(e){console.warn('tabs init failed', e)}})();</script>
    `;
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
        .gm-style .w2h-iw { max-width: 320px; font: 13px/1.35 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #1a1a1a; }
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
