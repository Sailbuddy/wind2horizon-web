// app/api/gphoto/route.js
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function pickKey() {
  // Server-only zuerst. KEIN NEXT_PUBLIC Fallback im Proxy.
  return (
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    ''
  );
}

export async function GET(req) {
  try {
    const url = new URL(req.url);

    // akzeptiere beide Varianten
    const ref =
      url.searchParams.get('photoreference') ||
      url.searchParams.get('photo_reference') ||
      '';

    if (!ref) {
      return NextResponse.json(
        { ok: false, error: 'Missing "photoreference" (or "photo_reference").' },
        { status: 400 }
      );
    }

    const mw = url.searchParams.get('maxwidth');
    const mh = url.searchParams.get('maxheight');
    const diag = url.searchParams.get('diag');

    // Google requires either maxwidth or maxheight
    const sizeKey = mw ? 'maxwidth' : 'maxheight';
    const sizeVal = mw || mh || '800';

    const key = pickKey();
    if (!key) {
      return NextResponse.json(
        { ok: false, error: 'Google API key missing on server (expected GOOGLE_PLACES_API_KEY).' },
        { status: 500 }
      );
    }

    const qs = new URLSearchParams();
    qs.set(sizeKey, String(sizeVal));

    // Places Photo (Legacy Web Service) uses photo_reference
    qs.set('photo_reference', ref);
    qs.set('key', key);

    const gUrl = `https://maps.googleapis.com/maps/api/place/photo?${qs.toString()}`;

    if (diag) {
      // optional: upstream status check (HEAD/GET). GET ist ok, folgt Redirect.
      const test = await fetch(gUrl, { redirect: 'follow' }).catch(() => null);
      const status = test ? test.status : null;
      const ct = test ? (test.headers.get('content-type') || null) : null;

      return NextResponse.json({
        ok: true,
        received: {
          photoreference: ref,
          maxwidth: mw ? Number(mw) : null,
          maxheight: mh ? Number(mh) : null,
        },
        pickedKey:
          (process.env.GOOGLE_PLACES_API_KEY && 'GOOGLE_PLACES_API_KEY') ||
          (process.env.GOOGLE_API_KEY && 'GOOGLE_API_KEY') ||
          (process.env.GOOGLE_MAPS_API_KEY && 'GOOGLE_MAPS_API_KEY') ||
          '(none)',
        builtUrl: gUrl.replace(key, '***'),
        upstreamProbe: { status, contentType: ct },
        hint:
          'If upstream status is 403/400 HTML: check API restrictions (no HTTP referrer), enabled Places API, billing.',
      });
    }

    const upstream = await fetch(gUrl, { redirect: 'follow' });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return new NextResponse(text || `Upstream error ${upstream.status}`, {
        status: upstream.status,
        headers: { 'content-type': upstream.headers.get('content-type') || 'text/plain; charset=utf-8' },
      });
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const cacheControl = 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800';

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        'content-type': contentType,
        'cache-control': cacheControl,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Proxy error: ${err?.message || 'unknown'}` },
      { status: 500 }
    );
  }
}
