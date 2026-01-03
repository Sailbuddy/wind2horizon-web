// lib/w2h/infoWindowRenderer.js
import { buildPhotoUrl, pickFirstThumb } from './locationMeta';

export function escapeHtml(str = '') {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildErrorInfoContent(rowId) {
  return `
    <div class="w2h-iw">
      <div class="iw-bd">
        <strong>Fehler beim Anzeigen dieses Spots (#${rowId}).</strong><br/>
        Die Daten sind vorhanden, aber das Infofenster konnte nicht gerendert werden.
      </div>
    </div>
  `;
}

export function pickName(row, langCode) {
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

export function pickDescriptionFromRow(row, langCode) {
  return (
    (langCode === 'de' && row.description_de) ||
    (langCode === 'it' && row.description_it) ||
    (langCode === 'fr' && row.description_fr) ||
    (langCode === 'hr' && row.description_hr) ||
    (langCode === 'en' && row.description_en) ||
    ''
  );
}

function repairMojibake(s = '') {
  // gleiche Logik wie bei dir
  return /Ã|Å|Â/.test(s) ? decodeURIComponent(escape(s)) : s;
}

export function label(key, langCode) {
  const L = {
    route: { de: 'Route', en: 'Directions', it: 'Itinerario', hr: 'Ruta', fr: 'Itinéraire' },
    website: { de: 'Website', en: 'Website', it: 'Sito', hr: 'Web', fr: 'Site' },
    call: { de: 'Anrufen', en: 'Call', it: 'Chiama', hr: 'Nazovi', fr: 'Appeler' },
    open: { de: 'Geöffnet', en: 'Open now', it: 'Aperto', hr: 'Otvoreno', fr: 'Ouvert' },
    closed: { de: 'Geschlossen', en: 'Closed', it: 'Chiuso', hr: 'Zatvoreno', fr: 'Fermé' },
    photos: { de: 'Fotos', en: 'Photos', it: 'Foto', hr: 'Fotografije', fr: 'Photos' },
    wind: { de: 'Winddaten', en: 'Wind data', it: 'Dati vento', hr: 'Podaci o vjetru', fr: 'Données vent' },
    more: { de: 'Weitere Infos', en: 'More info', it: 'Altre info', hr: 'Više info', fr: 'Plus d’infos' },

    // ✅ NEW: User photos loader labels
    userPhotos: { de: 'User-Fotos', en: 'User photos', it: 'Foto utenti', hr: 'Korisničke fotke', fr: 'Photos utilisateurs' },
    load: { de: 'Laden', en: 'Load', it: 'Carica', hr: 'Učitaj', fr: 'Charger' },
    loading: { de: 'Lade…', en: 'Loading…', it: 'Caricamento…', hr: 'Učitavam…', fr: 'Chargement…' },
    noUserPhotos: { de: 'Keine User-Fotos vorhanden.', en: 'No user photos.', it: 'Nessuna foto utente.', hr: 'Nema korisničkih fotki.', fr: 'Aucune photo utilisateur.' },
  };
  return (L[key] && (L[key][langCode] || L[key].en)) || key;
}

// Öffnungszeiten: du kannst deine bestehende Localize-Logik später ebenfalls auslagern.
// Hier minimal: wir rendern, was du uns gibst.
export function buildInfoContent({ row, metaRaw, iconSvgRaw, langCode, defaultMarkerSvg, localizeHoursList }) {
  // Sonderfall Debug 527 behalten
  if (row && row.id === 527) {
    const safeKv = metaRaw && typeof metaRaw === 'object' ? metaRaw : {};
    const title = escapeHtml(pickName(row, langCode));
    const desc = escapeHtml(pickDescriptionFromRow(row, langCode) || safeKv.description || '');

    return `
      <div class="w2h-iw">
        <div class="iw-hd">
          <div class="iw-title">${title} <span class="iw-id">#${row.id}</span> (DEBUG 527)</div>
        </div>
        <div class="iw-bd">
          ${desc ? `<div class="iw-row iw-desc">${desc}</div>` : '<div class="iw-row iw-desc">Kein Beschreibungstext.</div>'}
        </div>
      </div>
    `;
  }

  const kv = metaRaw && typeof metaRaw === 'object' ? metaRaw : {};
  const title = escapeHtml(pickName(row, langCode));
  const desc = escapeHtml(pickDescriptionFromRow(row, langCode) || kv.description || '');

  const pref = [langCode, 'de', 'en', 'it', 'fr', 'hr'];

  const addrByLang = kv.addressByLang && typeof kv.addressByLang === 'object' ? kv.addressByLang : {};
  let addrSel = '';
  for (const L of pref) {
    if (addrByLang[L]) { addrSel = addrByLang[L]; break; }
  }
  const address = escapeHtml(addrSel || kv.address || '');

  const website = kv.website || '';
  const phone = kv.phone || '';

  const rating = kv.rating !== undefined && kv.rating !== null && kv.rating !== '' ? Number(kv.rating) : null;
  const ratingTotal = kv.rating_total ? parseInt(kv.rating_total, 10) : null;
  const priceLevel = kv.price ? parseInt(kv.price, 10) : null;
  const openNow = kv.opening_now === 'true' || kv.opening_now === true;

  const hoursByLang = kv.hoursByLang && typeof kv.hoursByLang === 'object' ? kv.hoursByLang : {};
  let hoursArr = null;
  for (const L of pref) {
    if (Array.isArray(hoursByLang[L]) && hoursByLang[L].length) { hoursArr = hoursByLang[L]; break; }
  }
  const hoursLocalized = hoursArr && typeof localizeHoursList === 'function'
    ? localizeHoursList(hoursArr, langCode)
    : hoursArr;

  const photos = Array.isArray(kv.photos) ? kv.photos : [];
  const firstThumb = pickFirstThumb(photos);

  const dirHref = `https://www.google.com/maps/dir/?api=1&destination=${row.lat},${row.lng}`;
  const siteHref = website && website.startsWith('http') ? website : website ? `https://${website}` : '';
  const telHref = phone ? `tel:${String(phone).replace(/\s+/g, '')}` : '';

  const svgMarkup = iconSvgRaw || defaultMarkerSvg;

  const btnRoute = `<a class="iw-btn" href="${dirHref}" target="_blank" rel="noopener">📍 ${label('route', langCode)}</a>`;
  const btnSite = siteHref ? `<a class="iw-btn" href="${escapeHtml(siteHref)}" target="_blank" rel="noopener">🌐 ${label('website', langCode)}</a>` : '';
  const btnTel  = telHref  ? `<a class="iw-btn" href="${escapeHtml(telHref)}">📞 ${label('call', langCode)}</a>` : '';

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

  const thumbHtml = firstThumb
    ? `<img src="${firstThumb}" alt="" loading="lazy" style="width:100%;border-radius:10px;margin:6px 0 10px 0;" />`
    : '';

  const btnPhotos = photos.length
    ? `<button id="phbtn-${row.id}" class="iw-btn" style="background:#6b7280;">🖼️ ${label('photos', langCode)} (${photos.length})</button>`
    : '';

  const hasWindProfile = !!kv.wind_profile;
  const hasWindStation = !!kv.livewind_station;
  const hasWindHint = kv.wind_hint && typeof kv.wind_hint === 'object' && Object.keys(kv.wind_hint).length > 0;
  const btnWind = (hasWindProfile || hasWindStation || hasWindHint)
    ? `<button id="windbtn-${row.id}" class="iw-btn iw-btn-wind">💨 ${label('wind', langCode)}</button>`
    : '';

  // ✅ NEW: User photos placeholder (loaded client-side after InfoWindow opens)
  const userPhotosWrapId = `userphotos-${row.id}`;
  const userPhotosBtnId = `userphotosbtn-${row.id}`;
  const userPhotosHtml = `
    <div class="iw-userphotos" style="margin-top:10px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <div style="font-weight:600;">🖼️ ${label('userPhotos', langCode)}</div>
        <button id="${userPhotosBtnId}" class="iw-btn" style="background:#6b7280;">
          ${label('load', langCode)}
        </button>
      </div>

      <div id="${userPhotosWrapId}"
           data-location-id="${row.id}"
           data-lang="${langCode}"
           style="margin-top:8px;display:grid;gap:8px;">
        <!-- wird nachgeladen -->
      </div>
    </div>
  `;

  // Dynamische Sektion (Schema-gesteuert)
  const dynamic = Array.isArray(kv.dynamic) ? kv.dynamic : [];
  const dynHtml = dynamic.length
    ? `
      <div class="iw-dyn">
        <div class="iw-dyn-title">${label('more', langCode)}</div>
        ${dynamic.map((it) => {
          const val =
            typeof it.value === 'object'
              ? escapeHtml(JSON.stringify(it.value))
              : escapeHtml(String(it.value));
          const help = it.help ? ` title="${escapeHtml(it.help)}"` : '';
          return `
            <div class="iw-row iw-kv">
              <span class="iw-kv-k"${help}>${escapeHtml(it.label || it.key)}</span>
              <span class="iw-kv-v">${val}</span>
            </div>
          `;
        }).join('')}
      </div>
    `
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
        ${userPhotosHtml}
        ${address ? `<div class="iw-row iw-addr">📌 ${address}</div>` : ''}
        ${desc ? `<div class="iw-row iw-desc">${desc}</div>` : ''}
        ${ratingHtml}
        ${priceHtml}
        ${openingHtml}
        ${dynHtml}
      </div>

      <div class="iw-actions">
        ${btnWind}${btnRoute}${btnSite}${btnTel}${btnPhotos}
      </div>
    </div>
  `;
}
