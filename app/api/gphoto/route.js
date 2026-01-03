// app/api/gphoto/route.js
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const VERSION = "gphoto-2026-01-03-place-first-01";
const PHOTOS_ATTRIBUTE_ID = 17;
const DEFAULT_MAX_PHOTOS = 10;

function getGoogleKey() {
  return (
    process.env.GOOGLE_PLACES_SERVER_KEY ||
    process.env.GOOGLE_MAPS_SERVER_KEY ||
    process.env.GOOGLE_API_KEY ||
    ""
  );
}

function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || "";
  if (!url || !key) return null;

  return createClient(url, key, { auth: { persistSession: false } });
}

function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (Number.isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizePhotos(photosRaw, maxPhotos = DEFAULT_MAX_PHOTOS) {
  const arr = Array.isArray(photosRaw) ? photosRaw : [];
  const out = [];
  const seen = new Set();

  for (const p of arr) {
    const ref = p?.photo_reference;
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);

    out.push({
      photo_reference: ref,
      width: p?.width ?? null,
      height: p?.height ?? null,
      html_attributions: Array.isArray(p?.html_attributions)
        ? p.html_attributions
        : [],
    });

    if (out.length >= maxPhotos) break;
  }
  return out;
}

async function fetchGooglePhoto({ photo_reference, maxwidth, maxheight, key }) {
  const params = new URLSearchParams();
  if (maxwidth) params.set("maxwidth", String(maxwidth));
  if (maxheight) params.set("maxheight", String(maxheight));
  params.set("photoreference", photo_reference);
  params.set("key", key);

  const url = `https://maps.googleapis.com/maps/api/place/photo?${params.toString()}`;
  const res = await fetch(url, { redirect: "follow" });

  const contentType = res.headers.get("content-type") || "";
  const status = res.status;

  if (!res.ok) {
    let bodySnippet = "";
    try {
      bodySnippet = (await res.text()).slice(0, 500);
    } catch {}
    return { ok: false, status, contentType, url, bodySnippet };
  }

  const arrayBuffer = await res.arrayBuffer();
  return { ok: true, status, contentType, url, arrayBuffer };
}

async function fetchPlacePhotosSnapshot({ placeId, key, maxPhotos }) {
  const params = new URLSearchParams();
  params.set("place_id", placeId);
  params.set("fields", "photos");
  params.set("key", key);

  const url = `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== "OK") {
    return {
      ok: false,
      status: data.status,
      error_message: data.error_message || null,
      url,
    };
  }

  const photos = normalizePhotos(data.result?.photos, maxPhotos);
  return { ok: true, photos, url };
}

async function loadPhotosFromSupabase({ placeId }) {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Missing Supabase env" };

  const { data: loc, error: locErr } = await supabase
    .from("locations")
    .select("id")
    .eq("google_place_id", placeId)
    .maybeSingle();

  if (locErr || !loc?.id) {
    return { ok: false, error: `Location not found for placeId=${placeId}` };
  }

  const { data: lv, error: lvErr } = await supabase
    .from("location_values")
    .select("value_json, updated_at")
    .eq("location_id", loc.id)
    .eq("attribute_id", PHOTOS_ATTRIBUTE_ID)
    .eq("language_code", "und")
    .maybeSingle();

  if (lvErr) return { ok: false, error: lvErr.message };

  const photos = Array.isArray(lv?.value_json) ? lv.value_json : null;
  return { ok: true, location_id: loc.id, photos, updated_at: lv?.updated_at || null };
}

async function upsertPhotosToSupabase({ locationId, photos }) {
  const supabase = getSupabaseClient();
  if (!supabase) return { ok: false, error: "Missing Supabase env" };

  const payload = {
    location_id: locationId,
    attribute_id: PHOTOS_ATTRIBUTE_ID,
    language_code: "und",
    updated_at: new Date().toISOString(),
    value_json: photos,
    source_tag: "google",
  };

  const { error } = await supabase
    .from("location_values")
    .upsert(payload, { onConflict: "location_id,attribute_id,language_code" });

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function GET(request) {
  const url = new URL(request.url);
  const sp = url.searchParams;

  const diag = sp.get("diag") === "1";
  const key = getGoogleKey();

  const place_id = sp.get("place_id") || "";
  const index = clampInt(sp.get("index"), 0, 49, 0);
  const maxwidth = sp.get("maxwidth") ? clampInt(sp.get("maxwidth"), 1, 4000, 600) : 600;
  const maxheight = sp.get("maxheight") ? clampInt(sp.get("maxheight"), 1, 4000, null) : null;
  const maxPhotos = sp.get("maxPhotos") ? clampInt(sp.get("maxPhotos"), 1, 50, DEFAULT_MAX_PHOTOS) : DEFAULT_MAX_PHOTOS;

  if (!place_id) {
    return NextResponse.json(
      {
        ok: false,
        version: VERSION,
        error: "Missing place_id. Use ?place_id=ChIJ...&index=0&maxwidth=600",
      },
      { status: 400, headers: { "x-w2h-gphoto-version": VERSION } }
    );
  }

  if (!key) {
    return NextResponse.json(
      {
        ok: false,
        version: VERSION,
        error:
          "Missing server-side Google API key. Set GOOGLE_PLACES_SERVER_KEY (recommended) or GOOGLE_MAPS_SERVER_KEY / GOOGLE_API_KEY.",
      },
      { status: 500, headers: { "x-w2h-gphoto-version": VERSION } }
    );
  }

  // --- 1) DB-first: vorhandenen Photos-Snapshot nutzen ---
  const db = await loadPhotosFromSupabase({ placeId: place_id });

  let photos = db.ok ? db.photos : null;
  let locationId = db.ok ? db.location_id : null;

  // Helper: gewählt anhand index
  const chooseRef = (arr) => {
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const p = arr[Math.min(index, arr.length - 1)];
    return p?.photo_reference || null;
  };

  // 1a) Wenn DB Photos hat -> direkt versuchen
  const dbRef = chooseRef(photos);
  if (dbRef) {
    const res = await fetchGooglePhoto({ photo_reference: dbRef, maxwidth, maxheight, key });

    if (res.ok) {
      if (diag) {
        return NextResponse.json(
          {
            ok: true,
            version: VERSION,
            mode: "db-first",
            place_id,
            used_reference: dbRef,
            photos_count: photos.length,
            db_updated_at: db.updated_at,
            upstream: { status: res.status, contentType: res.contentType, url: res.url },
          },
          { status: 200, headers: { "x-w2h-gphoto-version": VERSION } }
        );
      }

      return new NextResponse(res.arrayBuffer, {
        status: 200,
        headers: {
          "Content-Type": res.contentType || "image/jpeg",
          "Cache-Control": "public, max-age=86400",
          "x-w2h-gphoto-version": VERSION,
        },
      });
    }

    // Nur bei 400 heilen (wie vereinbart)
    if (res.status !== 400) {
      return NextResponse.json(
        {
          ok: false,
          version: VERSION,
          mode: "db-first",
          place_id,
          used_reference: dbRef,
          upstream: {
            status: res.status,
            contentType: res.contentType,
            url: res.url,
            bodySnippetHead: res.bodySnippet?.slice(0, 250) || "",
          },
          hint: "Upstream error is not 400. No heal performed.",
        },
        { status: 502, headers: { "x-w2h-gphoto-version": VERSION } }
      );
    }
    // -> fällt durch in Heal
  }

  // --- 2) Heal: Google photos neu holen -> DB upserten -> retry ---
  const snap = await fetchPlacePhotosSnapshot({ placeId: place_id, key, maxPhotos });

  if (!snap.ok) {
    return NextResponse.json(
      {
        ok: false,
        version: VERSION,
        mode: "heal",
        place_id,
        reason: "Could not fetch photos via Places Details.",
        details: snap,
      },
      { status: 502, headers: { "x-w2h-gphoto-version": VERSION } }
    );
  }

  if (!snap.photos || snap.photos.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        version: VERSION,
        mode: "heal",
        place_id,
        reason: "No photos returned by Places Details.",
        details_url: snap.url,
      },
      { status: 404, headers: { "x-w2h-gphoto-version": VERSION } }
    );
  }

  // Wenn locationId noch nicht da (weil DB load failed), versuchen wir es jetzt zu holen
  if (!locationId) {
    const db2 = await loadPhotosFromSupabase({ placeId: place_id });
    locationId = db2.ok ? db2.location_id : null;
  }

  if (!locationId) {
    return NextResponse.json(
      {
        ok: false,
        version: VERSION,
        mode: "heal",
        place_id,
        reason: "Location not found in Supabase (cannot store refreshed snapshot).",
      },
      { status: 404, headers: { "x-w2h-gphoto-version": VERSION } }
    );
  }

  const store = await upsertPhotosToSupabase({ locationId, photos: snap.photos });

  const chosenRef = chooseRef(snap.photos);
  const retry = await fetchGooglePhoto({
    photo_reference: chosenRef,
    maxwidth,
    maxheight,
    key,
  });

  if (!retry.ok) {
    return NextResponse.json(
      {
        ok: false,
        version: VERSION,
        mode: "heal",
        place_id,
        stored: store,
        refreshed_count: snap.photos.length,
        chosen_index: index,
        chosen_reference: chosenRef,
        retry_upstream: {
          status: retry.status,
          contentType: retry.contentType,
          url: retry.url,
          bodySnippetHead: retry.bodySnippet?.slice(0, 250) || "",
        },
      },
      { status: 502, headers: { "x-w2h-gphoto-version": VERSION } }
    );
  }

  if (diag) {
    return NextResponse.json(
      {
        ok: true,
        version: VERSION,
        mode: "heal",
        place_id,
        stored: store,
        refreshed_count: snap.photos.length,
        chosen_reference: chosenRef,
        upstream: {
          status: retry.status,
          contentType: retry.contentType,
          url: retry.url,
        },
      },
      { status: 200, headers: { "x-w2h-gphoto-version": VERSION } }
    );
  }

  return new NextResponse(retry.arrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": retry.contentType || "image/jpeg",
      "Cache-Control": "public, max-age=86400",
      "x-w2h-gphoto-version": VERSION,
      "x-w2h-gphoto-healed": "1",
    },
  });
}
