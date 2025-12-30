// app/api/gphoto/route.js
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * TEST: Key-Reihenfolge geändert
 * Ziel: Prüfen, ob es sofort wieder funktioniert, wenn wir den Browser-Key (NEXT_PUBLIC_...)
 * temporär bevorzugen. Wenn JA -> dein aktueller Server-Key ist falsch restricted / falsches Projekt / ohne Places Photo.
 *
 * WICHTIG: Nach dem Test wieder zurückdrehen (Server-Key-only).
 */
function pickKey() {
  return (
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || // ✅ TEMP TEST: bevorzugt
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    ''
  );
}

export async function GET(req) {
  try {
    const url = new URL(req.url);

    // akzeptiere beide Param-Namen (Client nutzt: photoreference)
    let ref =
      url.searchParams.get('photoreference') ??
      url.searchParams.get('photo_reference');

    if (!ref) {
      return NextResponse.json(
        { ok: false, error: 'Missing "photoreference".' },
        { status: 400 }
      );
    }

    // CRITICAL: URLSearchParams decodiert "+" zu " " (space) -> reparieren
    ref = String(ref).replace(/ /g, '+');

    const diag = url.searchParams.get('diag');

    const mw = Number(url.searchParams.get('maxwidth') || '0');
    const mh = Number(url.searchParams.get('maxheight') || '0');
    const sizeKey = mw > 0 ? 'maxwidth' : mh > 0 ? 'maxheight' : 'maxwidth';
    const sizeVal = mw > 0 ? String(mw) : mh > 0 ? String(mh) : '800';

    const key = pickKey();
    if (!key) {
      return NextResponse.json(
        { ok: false, error: 'Google API key missing on server.' },
        { status: 500 }
      );
    }

    const qs = new URLSearchParams();
    qs.set(sizeKey, sizeVal);

    // Places Photo API: Parameter heißt "photoreference"
    qs.set('photoreference', ref);
    qs.set('key', key);

    const gUrl = `https://maps.googleapis.com/maps/api/place/photo?${qs.toString()}`;

    // Diagnosemodus: zeigt dir, welchen Key (ENV) der Server wirklich genommen hat
    if (diag) {
      const usedEnvVar =
        (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY && 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY') ||
        (process.env.GOOGLE_MAPS_API_KEY && 'GOOGLE_MAPS_API_KEY') ||
        (process.env.GOOGLE_API_KEY && 'GOOGLE_API_KEY') ||
        (process.env.VITE_GOOGLE_MAPS_API_KEY && 'VITE_GOOGLE_MAPS_API_KEY') ||
        '(none)';

      return NextResponse.json({
        ok: true,
        received: {
          photoreference: ref,
          maxwidth: mw || null,
          maxheight: mh || null,
        },
        builtUrl: gUrl.replace(key, '***'),
        usedEnvVar,
      });
    }

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
