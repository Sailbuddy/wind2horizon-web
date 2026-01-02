// app/api/gphoto/route.js
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VERSION = 'gphoto-2026-01-02-21-40';

function json(body, status = 200, extraHeaders = {}) {
  return new NextResponse(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-w2h-gphoto-version': VERSION,
      ...extraHeaders,
    },
  });
}

function pickServerKey() {
  const k1 = process.env.GOOGLE_PLACES_SERVER_KEY;
  const k2 = process.env.GOOGLE_MAPS_SERVER_KEY;
  return (k1 && String(k1).trim()) || (k2 && String(k2).trim()) || '';
}

function clampInt(v, def, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function stripHtml(html = '') {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractGoogleError(html = '') {
  const plain = stripHtml(html);
  // keep it short but useful
  return plain.slice(0, 260);
}

function pickRef(sp) {
  return (
    sp.get('photo_reference') ||
    sp.get('photoreference') ||
    sp.get('photoReference') ||
    sp.get('photo_name') ||      // allow v1 style param name too
    sp.get('name') ||
    sp.get('ref') ||
    ''
  ).trim();
}

function isPlacesV1PhotoName(ref) {
  // v1 photos look like: places/XXXX/photos/YYYY
  return /^places\/[^/]+\/photos\/[^/]+$/i.test(ref);
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const sp = url.searchParams;

    const ref = pickRef(sp);
    const maxwidth = clampInt(sp.get('maxwidth'), 800, 1, 2000);
    const maxheightRaw = sp.get('maxheight');
    const maxheight =
      maxheightRaw !== null && String(maxheightRaw).trim() !== ''
        ? clampInt(maxheightRaw, 800, 1, 2000)
        : null;

    const diag = sp.get('diag') === '1';

    const serverKey = pickServerKey();
    if (!serverKey) {
      return json(
        {
          ok: false,
          version: VERSION,
          error:
            'Missing server-side Google API key. Set GOOGLE_PLACES_SERVER_KEY (recommended) or GOOGLE_MAPS_SERVER_KEY.',
        },
        500
      );
    }

    if (!ref) {
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

    // Decide endpoint
    let upstreamUrl;
    let mode;

    if (isPlacesV1PhotoName(ref)) {
      // New Places API v1 media endpoint
      mode = 'places-v1';
      const u = new URL(`https://places.googleapis.com/v1/${ref}/media`);
      // v1 uses maxWidthPx / maxHeightPx
      if (maxwidth) u.searchParams.set('maxWidthPx', String(maxwidth));
      if (maxheight !== null) u.searchParams.set('maxHeightPx', String(maxheight));
      u.searchParams.set('key', serverKey);
      upstreamUrl = u.toString();
    } else {
      // Legacy Place Photo endpoint
      mode = 'legacy-photo';
      const u = new URL('https://maps.googleapis.com/maps/api/place/photo');
      u.searchParams.set('maxwidth', String(maxwidth));
      if (maxheight !== null) u.searchParams.set('maxheight', String(maxheight));
      u.searchParams.set('photoreference', ref);
      u.searchParams.set('key', serverKey);
      upstreamUrl = u.toString();
    }

    const resp = await fetch(upstreamUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent': 'wind2horizon-gphoto-proxy/1.0',
        accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      cache: 'no-store',
    });

    const contentType = resp.headers.get('content-type') || '';

    // Success -> stream image
    if (resp.ok && contentType.startsWith('image/')) {
      const arr = await resp.arrayBuffer();
      return new NextResponse(arr, {
        status: 200,
        headers: {
          'content-type': contentType,
          'cache-control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800',
          'x-w2h-gphoto-version': VERSION,
          'x-w2h-gphoto-mode': mode,
        },
      });
    }

    // Error -> JSON diagnostics (always), but keep concise unless diag=1
    const bodyText = await resp.text().catch(() => '');
    const upstreamSafe = upstreamUrl.replace(/key=[^&]+/i, 'key=***');
    const googleMessage = extractGoogleError(bodyText);

    const payload = {
      ok: false,
      version: VERSION,
      mode,
      received: { ref_len: ref.length, maxwidth, maxheight },
      upstream: {
        status: resp.status,
        contentType,
        url: upstreamSafe,
        googleMessage,
      },
    };

    if (diag) {
      payload.upstream.bodySnippetHead = bodyText.slice(0, 2500);
    }

    // 502 signals "upstream failed" (fits proxy semantics)
    return json(payload, 502);
  } catch (err) {
    return json(
      {
        ok: false,
        version: VERSION,
        error: err?.message || String(err),
      },
      500
    );
  }
}
