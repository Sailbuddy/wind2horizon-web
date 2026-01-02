// app/api/gphoto/route.js
import { NextResponse } from 'next/server';

// Ensure this route always runs dynamically (no static caching assumptions)
export const dynamic = 'force-dynamic';
// Use Node.js runtime (safer for streaming binary)
export const runtime = 'nodejs';

// Small helper: try multiple env var names (server-side only)
function pickGoogleKey() {
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY_SERVER ||
    process.env.GMAPS_SERVER_KEY ||
    ''
  );
}

// Optional: allow only safe width/height ranges
function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(String(v || ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export async function GET(req) {
  const version = 'gphoto-2026-01-02-19-45';

  try {
    const inUrl = new URL(req.url);

    // Accept both param spellings from your client
    const ref =
      inUrl.searchParams.get('photoreference') ??
      inUrl.searchParams.get('photo_reference');

    if (!ref || !String(ref).trim()) {
      return NextResponse.json(
        { ok: false, version, error: 'Missing "photoreference" or "photo_reference".' },
        { status: 400 }
      );
    }

    // Accept maxwidth OR maxheight (Google requires one of them)
    const mw = inUrl.searchParams.get('maxwidth');
    const mh = inUrl.searchParams.get('maxheight');

    // Keep it reasonable; avoids accidental huge images/timeouts
    const maxWidth = mw ? clampInt(mw, 50, 2000, 800) : null;
    const maxHeight = !mw && mh ? clampInt(mh, 50, 2000, 800) : null;

    const key = pickGoogleKey();
    if (!key) {
      return NextResponse.json(
        { ok: false, version, error: 'Google API key missing on server (env).' },
        { status: 500 }
      );
    }

    // Build upstream URL (IMPORTANT: parameter name is "photoreference")
    const qs = new URLSearchParams();
    if (maxWidth) qs.set('maxwidth', String(maxWidth));
    else qs.set('maxheight', String(maxHeight || 800));

    // Critical: Google expects "photoreference" (Legacy endpoint)
    qs.set('photoreference', String(ref));
    qs.set('key', key);

    const upstreamUrl = `https://maps.googleapis.com/maps/api/place/photo?${qs.toString()}`;

    // Debug mode: ?diag=1 returns URL info without fetching the image
    if (inUrl.searchParams.get('diag') === '1') {
      return NextResponse.json({
        ok: true,
        version,
        received: {
          ref_len: String(ref).length,
          maxwidth: maxWidth,
          maxheight: maxHeight,
        },
        upstream: {
          url: upstreamUrl.replace(key, '***'),
        },
      });
    }

    // Fetch upstream; allow redirects (Google may redirect to image CDN)
    const upstream = await fetch(upstreamUrl, { redirect: 'follow' });

    // If upstream fails, bubble up a helpful JSON (your frontend sees 502 with details)
    if (!upstream.ok) {
      const contentType = upstream.headers.get('content-type') || '';
      const text =
        contentType.includes('text') || contentType.includes('json')
          ? await upstream.text().catch(() => '')
          : '';

      return NextResponse.json(
        {
          ok: false,
          version,
          upstream: {
            status: upstream.status,
            contentType: contentType || null,
            url: upstreamUrl.replace(key, '***'),
            bodySnippet: text ? text.slice(0, 900) : null,
          },
        },
        { status: 502 }
      );
    }

    // Stream the image bytes back
    const outType = upstream.headers.get('content-type') || 'image/jpeg';

    // Caching: good for images; Vercel edge/cache will help
    // If you want near-real-time changes, reduce s-maxage.
    const cacheControl =
      'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800';

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        'content-type': outType,
        'cache-control': cacheControl,
        'x-w2h-gphoto-version': version,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, version, error: `Proxy error: ${err?.message || 'unknown'}` },
      { status: 500 }
    );
  }
}
