// lib/w2h/locationMeta.js
import { pickDefName, pickDefDescription, isPubliclyVisible } from './attributeSchema';

/**
 * Normalize Google photos input to a clean array of objects:
 * - accepts array OR JSON string
 * - filters out items without a usable photo_reference
 * - keeps legacy "photoreference" compatibility
 */
export function normalizeGooglePhotos(val) {
  try {
    let arr = null;
    if (Array.isArray(val)) arr = val;
    else if (typeof val === 'string' && val.trim().startsWith('[')) arr = JSON.parse(val);

    if (!Array.isArray(arr)) return [];

    return arr
      .map((p) => {
        const ref = p?.photo_reference || p?.photoreference || null;
        if (!ref) return null;

        return {
          photo_reference: ref,
          width: p?.width ?? null,
          height: p?.height ?? null,
          html_attributions: p?.html_attributions ?? null,
          source: 'google',
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Merge order: user photos first, then google photos.
 * (kept for compatibility with current UI expectation)
 */
export function mergePhotos(googleArr, userArr) {
  return [...(userArr || []), ...(googleArr || [])];
}

/**
 * Build a URL to your gphoto proxy.
 *
 * IMPORTANT:
 * - Use "photo_reference" (NOT "photoreference")
 * - Provide place_id to enable server-side heal
 * - Provide index so each gallery tile can request a distinct photo (prevents 10x same photo)
 *
 * Backward compatible: you can still call buildPhotoUrl(ref, 800) like before.
 */
export function buildPhotoUrl(ref, maxOrOpts = 800, maybeOpts = null) {
  // Backward compatible signature:
  //   buildPhotoUrl(ref, 800)
  // New signature:
  //   buildPhotoUrl(ref, { maxwidth: 800, placeId, index, maxheight, diag })
  // Hybrid:
  //   buildPhotoUrl(ref, 800, { placeId, index })
  let opts = {};
  if (typeof maxOrOpts === 'object' && maxOrOpts !== null) {
    opts = maxOrOpts;
  } else {
    opts = { maxwidth: maxOrOpts };
    if (maybeOpts && typeof maybeOpts === 'object') opts = { ...opts, ...maybeOpts };
  }

  const {
    placeId = '',
    index = null,
    maxwidth = 800,
    maxheight = null,
    diag = 0,
  } = opts;

  const sp = new URLSearchParams();
  sp.set('maxwidth', String(maxwidth));

  if (maxheight !== null && maxheight !== undefined && maxheight !== '') {
    sp.set('maxheight', String(maxheight));
  }

  if (ref) sp.set('photo_reference', String(ref));

  // Needed for heal + recommended for deterministic behavior
  if (placeId) sp.set('place_id', String(placeId));

  // Needed so each thumbnail can ask for its own photo
  if (index !== null && index !== undefined && index !== '') {
    sp.set('index', String(index));
  }

  if (diag) sp.set('diag', '1');

  return `/api/gphoto?${sp.toString()}`;
}

/**
 * Pick the first thumbnail URL.
 * - If there is a user photo, use it (thumb/public_url/url)
 * - Else use the first google photo, but ALWAYS pass placeId + index
 *
 * NOTE: For correct behavior, pass { placeId } from row.google_place_id.
 */
export function pickFirstThumb(photos, { placeId = '' } = {}) {
  if (!Array.isArray(photos) || !photos.length) return null;

  const user = photos.find((p) => p && (p.thumb || p.public_url || p.url));
  if (user) return user.thumb || user.public_url || user.url;

  const gIndex = photos.findIndex((p) => p && (p.photo_reference || p.photoreference));
  if (gIndex >= 0) {
    const g = photos[gIndex];
    const ref = g.photo_reference || g.photoreference;
    return buildPhotoUrl(ref, { maxwidth: 400, placeId, index: gIndex });
  }

  return null;
}

/**
 * Helper: Build an array of URLs for the gallery view.
 * - Only maps google photos (ignores user photos)
 * - Index is relative to google photos array (0..n-1)
 */
export function buildGooglePhotoUrls(photos, { placeId = '', maxwidth = 1200, maxPhotos = 10 } = {}) {
  if (!Array.isArray(photos) || !photos.length) return [];

  const googleOnly = photos
    .filter((p) => p && (p.source === 'google' || p.photo_reference || p.photoreference))
    .map((p) => ({
      ref: p.photo_reference || p.photoreference || null,
    }))
    .filter((p) => p.ref);

  return googleOnly.slice(0, maxPhotos).map((p, i) =>
    buildPhotoUrl(p.ref, { maxwidth, placeId, index: i })
  );
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

    // NOTE: pickFirstThumb needs placeId to build a healable + index-aware URL.
    // We keep backward compatibility by allowing callers to set it later.
    // If you have the placeId available in this context, pass it in when calling pickFirstThumb.
    obj.first_photo_ref = pickFirstThumb(obj.photos);

    metaByLoc.set(locId, obj);
  }
}