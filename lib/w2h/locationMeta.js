// lib/w2h/locationMeta.js
import { pickDefName, pickDefDescription, isPubliclyVisible } from './attributeSchema';

export function normalizeGooglePhotos(val) {
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

export function mergePhotos(googleArr, userArr) {
  return [...(userArr || []), ...(googleArr || [])];
}

export function buildPhotoUrl(ref, max = 800) {
  return `/api/gphoto?photoreference=${encodeURIComponent(ref)}&maxwidth=${max}`;
}

export function pickFirstThumb(photos) {
  if (!Array.isArray(photos) || !photos.length) return null;
  const user = photos.find((p) => p.thumb || p.public_url || p.url);
  if (user) return user.thumb || user.public_url || user.url;
  const g = photos.find((p) => p.photo_reference || p.photoreference);
  if (g) return buildPhotoUrl(g.photo_reference || g.photoreference, 400);
  return null;
}

// Diese beiden Maps behalten wir als „kompatiblen Bridge-Layer“, damit heute nichts bricht.
export const FIELD_MAP_BY_ID = {
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

export const FIELD_MAP_BY_KEY = {
  wind_profile: 'wind_profile',
  wind_swell_profile: 'wind_profile',
  wind_profile_info: 'wind_hint',
  wind_hint: 'wind_hint',
  wind_note: 'wind_hint',
  livewind_station: 'livewind_station',
};

function asStringValue(r) {
  const val =
    r.value_text ??
    r.value_option ??
    (r.value_number !== null && r.value_number !== undefined ? String(r.value_number) : null) ??
    (r.value_bool !== null && r.value_bool !== undefined ? String(r.value_bool) : null) ??
    (r.value_json !== null && r.value_json !== undefined ? r.value_json : null);

  if (val === null || val === undefined) return null;
  if (typeof val === 'string' && val.trim() === '') return null;
  return val;
}

export function buildMetaByLoc({
  kvRows = [],
  schemaById,
  schemaByKey,
  langCode = 'de',
  maxVisibilityLevel = 0, // public default
}) {
  const kvByLoc = new Map();

  for (const r of kvRows || []) {
    const locId = r.location_id;
    if (!locId) continue;

    const def =
      (schemaById && schemaById.get(Number(r.attribute_id))) ||
      (schemaByKey && r.attribute_definitions?.key && schemaByKey.get(r.attribute_definitions.key)) ||
      null;

    const keyFromJoin = r.attribute_definitions?.key || def?.key || null;
    const canon = FIELD_MAP_BY_ID[r.attribute_id] || (keyFromJoin && FIELD_MAP_BY_KEY[keyFromJoin]) || null;

    if (!kvByLoc.has(locId)) {
      kvByLoc.set(locId, { dynamic: [] });
    }
    const obj = kvByLoc.get(locId);

    const lc = String(r.language_code || '').toLowerCase();
    const rawVal = asStringValue(r);
    if (rawVal === null) continue;

    // 1) Canonical Felder (bestehende UI)
    if (canon === 'photos') {
      const googleArr = normalizeGooglePhotos(
        r.value_json !== null && r.value_json !== undefined ? r.value_json : r.value_text || null,
      );
      if (googleArr.length) obj.photos = (obj.photos || []).concat(googleArr);
      continue;
    }

    if (canon === 'wind_profile') {
      try {
        const j =
          r.value_json && typeof r.value_json === 'object'
            ? r.value_json
            : JSON.parse(r.value_json || '{}');
        obj.wind_profile = j || null;
      } catch {
        obj.wind_profile = null;
      }
      continue;
    }

    if (canon === 'wind_hint') {
      obj.wind_hint = obj.wind_hint || {};
      let text = '';
      if (r.value_text && String(r.value_text).trim()) {
        text = String(r.value_text);
      } else if (r.value_json) {
        try {
          const j = typeof r.value_json === 'object' ? r.value_json : JSON.parse(r.value_json);
          if (typeof j === 'string') text = j;
          else if (Array.isArray(j) && j.length) text = String(j[0]);
          else if (j && typeof j === 'object' && j.text) text = String(j.text);
        } catch {
          // ignore
        }
      }
      if (lc && text) obj.wind_hint[lc] = text;
      continue;
    }

    if (canon === 'livewind_station') {
      let stationId = '';
      if (r.value_text && String(r.value_text).trim()) stationId = String(r.value_text).trim();
      else if (r.value_json) {
        try {
          const j = typeof r.value_json === 'object' ? r.value_json : JSON.parse(r.value_json);
          if (typeof j === 'string' || typeof j === 'number') stationId = String(j).trim();
        } catch {
          // ignore
        }
      }
      const stationName = r.name && String(r.name).trim() ? String(r.name).trim() : null;
      if (stationId) {
        obj.livewind_station = stationId;
        if (stationName) obj.livewind_station_name = stationName;
      }
      continue;
    }

    if (canon === 'opening_hours') {
      obj.hoursByLang = obj.hoursByLang || {};
      let arr = null;

      if (Array.isArray(rawVal)) arr = rawVal;
      else if (typeof rawVal === 'string' && rawVal.trim().startsWith('[')) {
        try {
          arr = JSON.parse(rawVal);
        } catch {
          arr = [String(rawVal)];
        }
      }
      if (!arr) arr = String(rawVal).split('\n');
      obj.hoursByLang[lc] = (obj.hoursByLang[lc] || []).concat(arr);
      continue;
    }

    if (canon === 'address') {
      obj.addressByLang = obj.addressByLang || {};
      if (lc) obj.addressByLang[lc] = obj.addressByLang[lc] || String(rawVal);
      else obj.address = obj.address || String(rawVal);
      continue;
    }

    if (canon === 'website' || canon === 'phone') {
      obj[canon] = obj[canon] || String(rawVal);
      continue;
    }

    if (canon === 'description') {
      if (!obj.description || (lc && lc === langCode)) obj.description = String(rawVal);
      continue;
    }

    if (canon) {
      // rating, price, opening_now, etc.
      if (obj[canon] === undefined || obj[canon] === null || obj[canon] === '') {
        obj[canon] = String(rawVal);
      }
      continue;
    }

    // 2) Dynamische Attribute fürs Infofenster (Schema-gesteuert)
    if (!def) continue;
    if (!def.show_in_infowindow) continue;
    if (!isPubliclyVisible(def, maxVisibilityLevel)) continue;

    // Multilingual: wir zeigen bevorzugt aktuelle Sprache, aber speichern alles
    const item = {
      attribute_id: Number(def.attribute_id),
      key: def.key,
      label: pickDefName(def, langCode),
      help: pickDefDescription(def, langCode),
      group: def.infowindow_group || 'misc',
      order: def.infowindow_order ?? def.sort_order ?? 999,
      format: def.display_format || def.input_type || 'text',
      language_code: lc || null,
      value: rawVal,
      value_json: r.value_json ?? null,
    };

    obj.dynamic.push(item);
  }

  // Sortierung je Location (stabil)
  for (const [, meta] of kvByLoc) {
    if (Array.isArray(meta.dynamic)) {
      meta.dynamic.sort((a, b) => {
        const ao = Number(a.order ?? 999);
        const bo = Number(b.order ?? 999);
        if (ao !== bo) return ao - bo;
        return String(a.label || '').localeCompare(String(b.label || ''));
      });
    }
  }

  return kvByLoc;
}

export function mergeUserPhotosIntoMeta({ metaByLoc, userPhotosMap }) {
  if (!metaByLoc) return;

  for (const [locId, obj] of metaByLoc.entries()) {
    const googleArr = Array.isArray(obj.photos) ? obj.photos : [];

    const user = (userPhotosMap?.[locId] || [])
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
    metaByLoc.set(locId, obj);
  }
}
