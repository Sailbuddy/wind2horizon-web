// app/api/gphoto/route.js
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function pickKey() {
  // Server-only bevorzugen, KEINE NEXT_PUBLIC hier
  if (process.env.GOOGLE_PLACES_API_KEY) return { key: process.env.GOOGLE_PLACES_API_KEY, from: 'GOOGLE_PLACES_API_KEY' };
  if (process.env.GOOGLE_MAPS_API_KEY) return { key: process.env.GOOGLE_MAPS_API_KEY, from: 'GOOGLE_MAPS_API_KEY' };
  if (process.env.GOOGLE_API_KEY) return { key: process.env.GOOGLE_API_KEY, from: 'GOOGLE_API_KEY' };
  return { key: '', from: '(none)' };
}

export async function GET(req) {
  try {
    const url = new URL(req.url);

    // akzeptiere beide Namen
    const ref =
      url.searchParams.get('photoreference') ||
      url.searchParams.get('photo_reference') ||
      '';

    if (!ref) {
      return NextResponse.json({ ok: false, error: 'Missing "photoreference" (or "photo_reference").' }, { status: 400 });
    }

    const diag = url.searchParams.get('diag');

    const mw = url.searchParams.get('maxwidth');
    const mh = url.searchParams.get('maxheight');

    // Google Places Photo API (legacy) braucht entweder maxwidth oder maxheight
    let sizeKey = 'maxwidth';
    let sizeVal = mw || '800';
    if (!mw && mh) {
      sizeKey = 'maxheight';
      sizeVal = mh;
    }

    const { key, from } = pickKey();
    if (!key) {
      return NextResponse.json({ ok: false, error: 'Google API key missing on server.' }, { status: 500 });
    }

    const qs = new URLSearchParams();
    qs.set(sizeKey, sizeVal);

    // WICHTIG: legacy endpoint erwartet "photoreference"
    qs.set('photoreference', ref);
    qs.set('key', key);

    const gUrl = `https://maps.googleapis.com/maps/api/place/photo?${qs.toString()}`;

    if (diag) {
      return NextResponse.json({
        ok: true,
        received: {
          photoreference: ref,
          maxwidth: mw || null,
          maxheight: mh || null,
        },
        builtUrl: gUrl.replace(key, '***'),
        pickedKey: from,
      });
    }

    const upstream = await fetch(gUrl, { redirect: 'follow' });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return new NextResponse(text || `Upstream error ${upstream.status}`, {
        status: upstream.status,
        headers: { 'content-type': upstream.headers.get('content-type') || 'text/plain' },
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
