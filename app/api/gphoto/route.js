// app/api/gphoto/route.js
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Test: Key-Reihenfolge EXPLIZIT machen.
 * Wichtig: NEXT_PUBLIC_* bewusst NICHT verwenden (Browser-Keys sind oft Referrer-restricted
 * und funktionieren serverseitig im Proxy dann NICHT -> 403).
 */
function pickKeyDetailed() {
  const candidates = [
    ['GOOGLE_PLACES_SERVER_KEY', process.env.GOOGLE_PLACES_SERVER_KEY],
    ['GOOGLE_API_KEY', process.env.GOOGLE_API_KEY],
    ['GOOGLE_MAPS_SERVER_KEY', process.env.GOOGLE_MAPS_SERVER_KEY],
    ['GOOGLE_MAPS_API_KEY', process.env.GOOGLE_MAPS_API_KEY],
    ['VITE_GOOGLE_MAPS_API_KEY', process.env.VITE_GOOGLE_MAPS_API_KEY], // eher unwahrscheinlich, aber falls gesetzt
    // NOTE: NEXT_PUBLIC bewusst ausgeschlossen
  ];

  for (const [name, val] of candidates) {
    if (val && String(val).trim()) return { name, key: String(val).trim() };
  }
  return { name: '(none)', key: '' };
}

export async function GET(req) {
  try {
    const url = new URL(req.url);

    // akzeptiere beide Param-Namen
    let ref =
      url.searchParams.get('photoreference') ??
      url.searchParams.get('photo_reference');

    if (!ref) {
      return NextResponse.json(
        { ok: false, error: 'Missing "photoreference" (or "photo_reference").' },
        { status: 400 }
      );
    }

    // URLSearchParams decodiert "+" zu " " -> zurück reparieren
    ref = String(ref).replace(/ /g, '+');

    const diag = url.searchParams.get('diag'); // "1" oder "2"

    const mw = Number(url.searchParams.get('maxwidth') || '0');
    const mh = Number(url.searchParams.get('maxheight') || '0');
    const sizeKey = mw > 0 ? 'maxwidth' : mh > 0 ? 'maxheight' : 'maxwidth';
    const sizeVal = mw > 0 ? String(mw) : mh > 0 ? String(mh) : '800';

    const picked = pickKeyDetailed();
    if (!picked.key) {
      return NextResponse.json(
        {
          ok: false,
          error: 'No server Google API key found. Set GOOGLE_API_KEY (or *_SERVER_KEY).',
          tried: [
            'GOOGLE_PLACES_SERVER_KEY',
            'GOOGLE_API_KEY',
            'GOOGLE_MAPS_SERVER_KEY',
            'GOOGLE_MAPS_API_KEY',
            'VITE_GOOGLE_MAPS_API_KEY',
          ],
        },
        { status: 500 }
      );
    }

    const qs = new URLSearchParams();
    qs.set(sizeKey, sizeVal);
    qs.set('photoreference', ref);
    qs.set('key', picked.key);

    const gUrl = `https://maps.googleapis.com/maps/api/place/photo?${qs.toString()}`;

    // diag=1: nur Aufbau prüfen
    if (diag === '1') {
      return NextResponse.json({
        ok: true,
        received: {
          photoreference: ref,
          maxwidth: mw || null,
          maxheight: mh || null,
        },
        usedEnvVar: picked.name,
        builtUrl: gUrl.replace(picked.key, '***'),
      });
    }

    // diag=2: ECHTER Upstream-Test, Fehlertext sichtbar machen
    if (diag === '2') {
      const upstream = await fetch(gUrl, {
        redirect: 'manual', // wichtig: nicht automatisch folgen, damit wir die erste Antwort sehen
        headers: {
          accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
      });

      const ct = upstream.headers.get('content-type') || '';
      const loc = upstream.headers.get('location') || '';
      let bodyText = '';

      // Oft kommt bei 403 ein Text/JSON Body. Wenn es ein Bild ist, lesen wir nichts.
      if (!ct.startsWith('image/')) {
        bodyText = await upstream.text().catch(() => '');
      }

      return NextResponse.json({
        ok: upstream.ok,
        status: upstream.status,
        statusText: upstream.statusText || null,
        contentType: ct || null,
        location: loc || null,
        usedEnvVar: picked.name,
        builtUrl: gUrl.replace(picked.key, '***'),
        upstreamBodyPreview: bodyText ? bodyText.slice(0, 2000) : null,
        hint:
          'If status=403, check Google Cloud API key restrictions (Application restrictions / API restrictions) and billing.',
      });
    }

    // Normalbetrieb: Bild durchreichen
    const upstream = await fetch(gUrl, {
      redirect: 'follow',
      headers: {
        accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return new NextResponse(text || `Upstream error ${upstream.status}`, {
        status: upstream.status,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
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
