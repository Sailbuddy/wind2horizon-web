// app/api/gphoto/route.js

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VERSION = 'gphoto-2026-01-02-21-40';

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-w2h-gphoto-version': VERSION,
      ...extraHeaders,
    },
  });
}

function pickKey() {
  return (
    process.env.GOOGLE_PLACES_SERVER_KEY ||
    process.env.GOOGLE_MAPS_SERVER_KEY ||
    null
  );
}

function toInt(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function safeReadText(res, limit = 1200) {
  try {
    const t = await res.text();
    return t.length > limit ? t.slice(0, limit) : t;
  } catch {
    return '';
  }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);

  const diag = searchParams.get('diag') === '1';

  // Accept both parameter names (legacy + your earlier naming)
  const photoReference =
    searchParams.get('photo_reference') || searchParams.get('photoReference');
  const photoName =
    searchParams.get('photo_name') || searchParams.get('photoName');

  const maxwidth = toInt(searchParams.get('maxwidth'), 600);
  const maxheightRaw = searchParams.get('maxheight');
  const maxheight = maxheightRaw ? toInt(maxheightRaw, null) : null;

  if (!photoReference && !photoName) {
    return json(
      {
        ok: false,
        version: VERSION,
        error:
          'Missing photo reference. Use ?photo_reference=... (legacy) or ?photo_name=places/.../photos/... (v1).',
      },
      400
    );
  }

  const key = pickKey();
  if (!key) {
    return json(
      {
        ok: false,
        version: VERSION,
        error:
          'Missing server-side Google API key. Set GOOGLE_PLACES_SERVER_KEY (recommended) or GOOGLE_MAPS_SERVER_KEY in Vercel env.',
      },
      500
    );
  }

  let mode = '';
  let upstreamUrl = '';

  // --- Build upstream URL ---
  if (photoName) {
    // Places API (New): GET https://places.googleapis.com/v1/{photo_name}/media?maxWidthPx=...&key=...
    // photo_name must remain a path (do NOT encode slashes)
    // Basic validation to avoid path injection.
    if (!/^places\/[^/]+\/photos\/[^/]+$/.test(photoName)) {
      return json(
        {
          ok: false,
          version: VERSION,
          error:
            'Invalid photo_name format. Expected: places/{placeId}/photos/{photoId}',
          received: { photo_name_len: String(photoName).length },
        },
        400
      );
    }

    mode = 'v1-media';
    const qs = new URLSearchParams();
    qs.set('key', key);

    // Google uses maxWidthPx / maxHeightPx
    if (maxheight) qs.set('maxHeightPx', String(maxheight));
    else qs.set('maxWidthPx', String(maxwidth));

    upstreamUrl = `https://places.googleapis.com/v1/${photoName}/media?${qs.toString()}`;
  } else {
    // Legacy: https://maps.googleapis.com/maps/api/place/photo?maxwidth=...&photo_reference=...&key=...
    mode = 'legacy-photo';

    const qs = new URLSearchParams();
    qs.set('key', key);
    qs.set('photo_reference', photoReference); // ✅ correct param name
    if (maxheight) qs.set('maxheight', String(maxheight));
    else qs.set('maxwidth', String(maxwidth));

    upstreamUrl = `https://maps.googleapis.com/maps/api/place/photo?${qs.toString()}`;
  }

  // --- Fetch upstream ---
  let upstreamRes;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      // fetch follows redirects by default in node, that's fine here
      redirect: 'follow',
      headers: {
        // keep it simple; Google doesn't require special headers
        'user-agent': 'wind2horizon-gphoto-proxy',
      },
    });
  } catch (e) {
    return json(
      {
        ok: false,
        version: VERSION,
        mode,
        error: 'Upstream fetch failed',
        details: String(e?.message || e),
      },
      502
    );
  }

  const contentType = upstreamRes.headers.get('content-type') || '';
  const status = upstreamRes.status;

  // If diag requested, return structured info instead of binary
  if (diag) {
    const text = await safeReadText(upstreamRes);
    return json(
      {
        ok: status >= 200 && status < 300,
        version: VERSION,
        mode,
        received: {
          ref_len: photoReference ? String(photoReference).length : null,
          photo_name_len: photoName ? String(photoName).length : null,
          maxwidth,
          maxheight,
        },
        upstream: {
          status,
          contentType,
          url: upstreamUrl.replace(key, '***'),
          bodySnippetHead: text,
        },
      },
      status >= 200 && status < 300 ? 200 : 502
    );
  }

  // Non-diag: must return the image if successful
  if (!upstreamRes.ok) {
    const text = await safeReadText(upstreamRes);
    return json(
      {
        ok: false,
        version: VERSION,
        mode,
        received: {
          ref_len: photoReference ? String(photoReference).length : null,
          photo_name_len: photoName ? String(photoName).length : null,
          maxwidth,
          maxheight,
        },
        upstream: {
          status,
          contentType,
          url: upstreamUrl.replace(key, '***'),
          googleMessage: text.replace(/\s+/g, ' ').slice(0, 300),
          bodySnippetHead: text,
        },
      },
      502
    );
  }

  // Stream binary through
  const headers = new Headers();
  headers.set('content-type', contentType || 'image/jpeg');
  headers.set('cache-control', 'public, max-age=3600, s-maxage=3600'); // short cache; photo_reference can expire
  headers.set('x-w2h-gphoto-version', VERSION);

  return new Response(upstreamRes.body, { status: 200, headers });
}
