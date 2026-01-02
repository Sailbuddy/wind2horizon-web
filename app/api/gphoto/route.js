// app/api/gphoto/route.js
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function pickKey() {
  // Server-only Keys first (keine NEXT_PUBLIC Keys bevorzugen)
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY || // nur falls du es wirklich serverseitig setzt
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || // letzter Notnagel, nicht empfohlen
    ''
  );
}

function usedEnvVar() {
  return (
    (process.env.GOOGLE_MAPS_API_KEY && 'GOOGLE_MAPS_API_KEY') ||
    (process.env.GOOGLE_API_KEY && 'GOOGLE_API_KEY') ||
    (process.env.GOOGLE_PLACES_API_KEY && 'GOOGLE_PLACES_API_KEY') ||
    (process.env.VITE_GOOGLE_MAPS_API_KEY && 'VITE_GOOGLE_MAPS_API_KEY') ||
    (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY && 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY') ||
    '(none)'
  );
}

export async function GET(req) {
  try {
    const url = new URL(req.url);

    // akzeptiere beide Param-Namen eingehend
    const ref =
      url.searchParams.get('photo_reference') ??
      url.searchParams.get('photoreference');

    if (!ref) {
      return NextResponse.json(
        { ok: false, error: 'Missing "photo_reference" (or "photoreference").' },
        { status: 400 }
      );
    }

    const diag = url.searchParams.get('diag');

    const mw = url.searchParams.get('maxwidth');
    const mh = url.searchParams.get('maxheight');

    // Google verlangt entweder maxwidth oder maxheight.
    // Default, falls nichts gegeben:
    const sizeKey = mw ? 'maxwidth' : (mh ? 'maxheight' : 'maxwidth');
    const sizeVal = mw || mh || '800';

    const key = pickKey();
    if (!key) {
      return NextResponse.json(
        { ok: false, error: 'Google API key missing on server.' },
        { status: 500 }
      );
    }

    const qs = new URLSearchParams();
    qs.set(sizeKey, String(sizeVal));

    // WICHTIG: Google Places Photo API expects "photo_reference"
    qs.set('photo_reference', ref);
    qs.set('key', key);

    const gUrl = `https://maps.googleapis.com/maps/api/place/photo?${qs.toString()}`;

    if (diag) {
      return NextResponse.json({
        ok: true,
        received: {
          photo_reference: ref,
          maxwidth: mw || null,
          maxheight: mh || null,
        },
        builtUrl: gUrl.replace(key, '***'),
        usedEnvVar: usedEnvVar(),
      });
    }

    const upstream = await fetch(gUrl, { redirect: 'follow' });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return new NextResponse(text || `Upstream error ${upstream.status}`, {
        status: upstream.status,
        headers: {
          'content-type': upstream.headers.get('content-type') || 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const cacheControl =
      'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800';

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
