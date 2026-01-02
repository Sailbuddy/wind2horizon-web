// app/api/gphoto/route.js
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VERSION = 'gphoto-2026-01-02-19-45'; // <- beliebig, aber eindeutig

function pickKey() {
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_PLACES_API_KEY ||
    ''
  );
}

function maskKey(url, key) {
  return key ? url.replaceAll(key, '***') : url;
}

export async function GET(req) {
  try {
    const url = new URL(req.url);

    const ref =
      url.searchParams.get('photo_reference') ??
      url.searchParams.get('photoreference');

    if (!ref) {
      return NextResponse.json(
        { ok: false, error: 'Missing "photo_reference" (or "photoreference").', version: VERSION },
        { status: 400, headers: { 'x-w2h-gphoto-version': VERSION } }
      );
    }

    const mw = url.searchParams.get('maxwidth');
    const mh = url.searchParams.get('maxheight');

    const sizeKey = mw ? 'maxwidth' : (mh ? 'maxheight' : 'maxwidth');
    const sizeVal = mw || mh || '800';

    const key = pickKey();
    if (!key) {
      return NextResponse.json(
        { ok: false, error: 'Google API key missing on server.', version: VERSION },
        { status: 500, headers: { 'x-w2h-gphoto-version': VERSION } }
      );
    }

    const qs = new URLSearchParams();
    qs.set(sizeKey, String(sizeVal));
    qs.set('photo_reference', ref); // <- MUSS so heißen
    qs.set('key', key);

    const gUrl = `https://maps.googleapis.com/maps/api/place/photo?${qs.toString()}`;

    // Immer diag erzwingbar machen:
    const diag = url.searchParams.get('diag');
    if (diag) {
      return NextResponse.json(
        {
          ok: true,
          version: VERSION,
          received: { photo_reference: ref, maxwidth: mw || null, maxheight: mh || null },
          builtUrl: maskKey(gUrl, key),
        },
        { status: 200, headers: { 'x-w2h-gphoto-version': VERSION } }
      );
    }

    const upstream = await fetch(gUrl, { redirect: 'follow' });

    // WICHTIG: Wenn Google statt Bild HTML liefert, geben wir JSON zurück
    const ct = upstream.headers.get('content-type') || '';
    if (!upstream.ok || ct.includes('text/html') || ct.includes('application/json') || ct.includes('text/plain')) {
      const text = await upstream.text().catch(() => '');
      return NextResponse.json(
        {
          ok: false,
          version: VERSION,
          upstream: {
            status: upstream.status,
            contentType: ct || null,
            url: maskKey(gUrl, key),
            bodySnippet: text.slice(0, 500),
          },
        },
        { status: 502, headers: { 'x-w2h-gphoto-version': VERSION, 'cache-control': 'no-store' } }
      );
    }

    const cacheControl = 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800';

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        'content-type': upstream.headers.get('content-type') || 'image/jpeg',
        'cache-control': cacheControl,
        'x-w2h-gphoto-version': VERSION,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, version: VERSION, error: `Proxy error: ${err?.message || 'unknown'}` },
      { status: 500, headers: { 'x-w2h-gphoto-version': VERSION } }
    );
  }
}
