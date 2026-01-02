// app/api/gphoto/route.js
// wind2horizon – Google Places Photo Proxy (server-side)
// Version: gphoto-2026-01-02-19-45 (bump when editing)

import { NextResponse } from 'next/server';

export const runtime = 'nodejs'; // important: fetch + streaming is more reliable on node runtime
export const dynamic = 'force-dynamic'; // avoid caching issues

const VERSION = 'gphoto-2026-01-02-19-45';

// ---- helpers --------------------------------------------------------

function json(resBody, status = 200, extraHeaders = {}) {
  return new NextResponse(JSON.stringify(resBody, null, 2), {
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
  // preferred naming (explicitly server-only)
  const k1 = process.env.GOOGLE_PLACES_SERVER_KEY;
  // fallback (if you used that earlier)
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
  const s = String(html || '');

  // 1) Try <p>…</p> blocks (Google error pages often use them)
  const pMatches = [...s.matchAll(/<p[^>]*>(.*?)<\/p>/gis)].map((m) => m[1]).map(stripHtml).filter(Boolean);
  const importantFromP = pMatches.find((x) =>
    /photo|reference|key|invalid|denied|billing|malformed|illegal|request|permission|authorized|referer|referrer|restriction/i.test(
      x
    )
  );
  if (importantFromP) return importantFromP;

  // 2) Fallback: scan full plain text for typical phrases
  const plain = stripHtml(s);

  const patterns = [
    /your client has issued a malformed or illegal request\./i,
    /the provided api key is invalid\./i,
    /this api project is not authorized to use this api/i,
    /api keys with referer restrictions cannot be used with this api/i,
    /billing has not been enabled on your account/i,
    /the provided photo reference is invalid/i,
    /not authorized/i,
    /permission denied/i,
    /access denied/i,
  ];

  for (const re of patterns) {
    const m = plain.match(re);
    if (m) return m[0];
  }

  // 3) Last resort: return a compact excerpt
  return plain.slice(0, 260);
}

function pickRefFromSearchParams(sp) {
  // accept multiple aliases (we normalize them)
  const a =
    sp.get('photo_reference') ||
    sp.get('photoreference') ||
    sp.get('photoReference') ||
    sp.get('photoRef') ||
    sp.get('ref') ||
    '';
  return String(a || '').trim();
}

// ---- handler --------------------------------------------------------

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const sp = url.searchParams;

    const ref = pickRefFromSearchParams(sp);
    const maxwidth = clampInt(sp.get('maxwidth'), 800, 1, 2000);
    const maxheightRaw = sp.get('maxheight');
    const maxheight = maxheightRaw !== null && maxheightRaw !== undefined && String(maxheightRaw).trim() !== '' ? clampInt(maxheightRaw, 800, 1, 2000) : null;

    // lightweight health response (optional)
    if (sp.get('ping') === '1') {
      return json({
        ok: true,
        version: VERSION,
        ping: true,
        env: {
          hasPlacesKey: !!(process.env.GOOGLE_PLACES_SERVER_KEY && String(process.env.GOOGLE_PLACES_SERVER_KEY).trim()),
          hasMapsKey: !!(process.env.GOOGLE_MAPS_SERVER_KEY && String(process.env.GOOGLE_MAPS_SERVER_KEY).trim()),
        },
      });
    }

    if (!ref) {
      return json(
        {
          ok: false,
          version: VERSION,
          error: 'Missing photo_reference. Use ?photo_reference=... (aliases: photoreference, ref).',
          received: {
            ref_len: 0,
            maxwidth,
            maxheight,
          },
        },
        400
      );
    }

    // Return a quick debug of what we received (helps diagnose)
    // NOTE: We still proceed to fetch; this is only in JSON responses.
    const serverKey = pickServerKey();
    if (!serverKey) {
      return json(
        {
          ok: false,
          version: VERSION,
          error: 'Missing server-side Google API key. Set GOOGLE_PLACES_SERVER_KEY (recommended) or GOOGLE_MAPS_SERVER_KEY in Vercel env.',
        },
        500
      );
    }

    // IMPORTANT: Google Places Photo expects "photoreference" (no underscore).
    // We accept "photo_reference" from the client for convenience and map it correctly.
    const upstream = new URL('https://maps.googleapis.com/maps/api/place/photo');
    upstream.searchParams.set('maxwidth', String(maxwidth));
    if (maxheight !== null) upstream.searchParams.set('maxheight', String(maxheight));
    upstream.searchParams.set('photoreference', ref);
    upstream.searchParams.set('key', serverKey);

    // Fetch image (Google often returns a 302 to the final image URL).
    // We follow redirects.
    const resp = await fetch(upstream.toString(), {
      method: 'GET',
      redirect: 'follow',
      headers: {
        // Some edge stacks behave better with an explicit UA
        'user-agent': 'wind2horizon-gphoto-proxy/1.0',
        accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
      // IMPORTANT: avoid caching at fetch-level too
      cache: 'no-store',
    });

    const contentType = resp.headers.get('content-type') || '';

    // Success: return image as-is
    if (resp.ok && contentType.startsWith('image/')) {
      const arr = await resp.arrayBuffer();
      return new NextResponse(arr, {
        status: 200,
        headers: {
          'content-type': contentType,
          'cache-control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800',
          'x-w2h-gphoto-version': VERSION,
        },
      });
    }

    // Error: try to read text/html or any body
    const body = await resp.text().catch(() => '');
    const headSnippet = body ? body.slice(0, 4000) : '';
    const tailSnippet = body ? body.slice(Math.max(0, body.length - 4000)) : '';
    const googleMessage = extractGoogleError(body);

    // Provide upstream url but hide key
    const upstreamSafe = upstream.toString().replace(/key=[^&]+/i, 'key=***');

    // Map upstream error to a better status for the browser
    // - 4xx from upstream => 502 for image fetch (client sees it as broken image)
    // - but JSON callers can still see details.
    const statusForClient = 502;

    return json(
      {
        ok: false,
        version: VERSION,
        received: {
          ref_len: ref.length,
          maxwidth,
          maxheight,
        },
        upstream: {
          status: resp.status,
          contentType,
          url: upstreamSafe,
          googleMessage: googleMessage || null,
          bodySnippetHead: headSnippet,
          bodySnippetTail: tailSnippet,
        },
      },
      statusForClient
    );
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
