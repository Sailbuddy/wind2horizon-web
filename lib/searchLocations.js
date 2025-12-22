import { supabase } from '@/lib/supabaseClient';

function cleanStr(s) {
  const t = String(s ?? '').trim();
  return t.length ? t : null;
}

function numOrNull(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Ruft RPC search_locations auf.
 * payload keys müssen zu deiner SQL-Function passen.
 */
export async function searchLocationsRPC({
  q,
  categoryIds,
  lat,
  lng,
  radiusKm,
  minRating,
  limit = 50,
  offset = 0,
}) {
  const payload = {
    q: cleanStr(q),
    category_ids: Array.isArray(categoryIds) && categoryIds.length ? categoryIds : null,
    lat: numOrNull(lat),
    lng: numOrNull(lng),
    radius_km: numOrNull(radiusKm),
    min_rating: numOrNull(minRating),
    limit: numOrNull(limit) ?? 50,
    offset: numOrNull(offset) ?? 0,
  };

  const { data, error } = await supabase.rpc('search_locations', { p: payload });
  if (error) throw error;
  return data || [];
}
