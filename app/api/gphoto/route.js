// app/api/gphoto/route.js
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Nur Domains zulassen, die du kontrollierst (verhindert Missbrauch)
const ALLOWED_ORIGINS = new Set([
  'https://map.wind2horizon.com',
  'https://wind2horizon.com',
  'https://www.wind2horizon.com',
  'http://localhost:3000',
]);

function pickKey() {
  // Server-only Keys bevorzugen
  return (
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    ''
  );
}

function pickSafeOrigin(req) {
  // Origin bevorzugen, sonst Referer -> Origin extrahieren
  const origin = req.headers.get('origin');
  if (origin && ALLOWED_ORIGINS.has(origin)) return origin;

  const referer = req.headers.get('referer');
  if (referer) {
    try {
      const o = new URL(referer).origin;
      if (ALLOWED_ORIGINS.has(o)) return o;
    } catch (_) {}
  }

  // Fallback auf deine Map-Domain
  return 'https://map.wind2horizon.com';
}

export async function GET(req) {
  try {
    const url = new URL(req.url);

    // akzeptiere beide Parameternamen
    const ref =
      url.searchParams.get('photoreference') ??
      url.searchParams.get('photo_reference') ??
      url.searchParams.get('photoreference'.toUpperCase());

    if (!ref) {
      return NextResponse.json({ ok: false, error: 'Missing "photoreference".' }, { status: 400 });
    }

    const diag = url.searchParams.get('diag');

    const mw = Number(url.searchParams.get('maxwidth') || '0');
    const mh = Number(url.searchParams.get('maxheight') || '0');
    const sizeKey = mw > 0 ? 'maxwidth' : mh > 0 ? 'maxheight' : 'maxwidth';
    const sizeVal = mw > 0 ? String(mw) : mh > 0 ? String(mh) : '800';

    const key = pickKey();
    if (!key) {
      return NextResponse.json({ ok: false, error: 'Google API key missing on server.' }, { status: 500 });
    }

    const qs = new URLSearchParams();
    qs.set(sizeKey, sizeVal);
    qs.set('photo_reference', ref); // Google erwartet photo_reference
    qs.set('key', key);

    const gUrl = `https://maps.googleapis.com/maps/api/place/photo?${qs.toString()}`;

    // WICHTIG: Referrer/Origin mitgeben (falls Key darauf eingeschränkt ist)
    const safeOrigin = pickSafeOrigin(req);

    if (diag) {
      return NextResponse.json({
        ok: true,
        received: {
          photoreference: ref,
          maxwidth: mw || null,
          maxheight: mh || null,
        },
        safeOrigin,
        builtUrl: gUrl.replace(key, '***'),
        usedEnvVar:
          (process.env.GOOGLE_API_KEY && 'GOOGLE_API_KEY') ||
          (process.env.GOOGLE_MAPS_API_KEY && 'GOOGLE_MAPS_API_KEY') ||
          (process.env.VITE_GOOGLE_MAPS_API_KEY && 'VITE_GOOGLE_MAPS_API_KEY') ||
          '(none)',
      });
    }

    const upstream = await fetch(gUrl, {
      redirect: 'follow',
      headers: {
        // Google Key-Restriktionen (HTTP referrer) können dadurch erfüllt werden
        referer: safeOrigin + '/',
        origin: safeOrigin,
        accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      // Fehler als text/plain zurück – damit du es in DevTools direkt siehst
      return new NextResponse(text || `Upstream error ${upstream.status}`, {
        status: upstream.status,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
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
    return NextResponse.json({ ok: false, error: `Proxy error: ${err?.message || 'unknown'}` }, { status: 500 });
  }
}
