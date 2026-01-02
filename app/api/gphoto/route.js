// app/api/gphoto/route.js
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * WICHTIG:
 * - Proxy muss SERVER-Key verwenden (ohne NEXT_PUBLIC Restriktionen).
 * - Für Google Places Photo API muss der Parameter "photo_reference" heißen.
 */

function pickKey({ allowPublic = false } = {}) {
  // Server-only Keys first
  const serverKey =
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_PLACES_API_KEY ||
    '';

  if (serverKey) return { key: serverKey, picked: serverKey === process.env.GOOGLE_MAPS_API_KEY ? 'GOOGLE_MAPS_API_KEY' :
                                  serverKey === process.env.GOOGLE_API_KEY ? 'GOOGLE_API_KEY' :
                                  serverKey === process.env.GOOGLE_PLACES_API_KEY ? 'GOOGLE_PLACES_API_KEY' : 'SERVER_KEY' };

  // OPTIONAL: nur für Diagnose zulassen, nicht für Normalbetrieb
  if (allowPublic && process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) {
    return { key: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, picked: 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY' };
  }

  return { key: '', picked: '(none)' };
}

export async function GET(req) {
  try {
    const url = new URL(req.url);

    // Eingabe: wir akzeptieren beides
    let ref =
      url.searchParams.get('photoreference') ??
      url.searchParams.get('photo_reference') ??
      url.searchParams.get('photo_reference'.toUpperCase()) ??
      url.searchParams.get('photo_reference'.toLowerCase()) ??
      url.searchParams.get('photo_reference');

    // (Optional) legacy alias
    if (!ref) ref = url.searchParams.get('photo_reference');

    if (!ref) {
      return NextResponse.json({ ok: false, error: 'Missing "photoreference" (or "photo_reference").' }, { status: 400 });
    }

    // Safety: manche Systeme wandeln "+" in " " um – das killt lange Tokens gelegentlich.
    // encodeURIComponent sollte es verhindern, aber wir härten zusätzlich.
    ref = String(ref).replace(/ /g, '+').trim();

    const mw = url.searchParams.get('maxwidth');
    const mh = url.searchParams.get('maxheight');

    // Google erwartet maxwidth ODER maxheight
    const sizeKey = mw ? 'maxwidth' : 'maxheight';
    const sizeValRaw = mw || mh || '800';
    const sizeVal = String(Math.max(1, parseInt(sizeValRaw, 10) || 800));

    // diag:
    //  - diag=1: zeigt nur den effektiv verwendeten Key
    //  - diag=2: testet zusätzlich einen öffentlichen Key (falls vorhanden), ohne ihn im Betrieb zu nutzen
    const diag = url.searchParams.get('diag');
    const allowPublic = diag === '2';

    const { key, picked } = pickKey({ allowPublic });

    const availableKeys = [
      process.env.GOOGLE_MAPS_API_KEY ? 'GOOGLE_MAPS_API_KEY' : null,
      process.env.GOOGLE_API_KEY ? 'GOOGLE_API_KEY' : null,
      process.env.GOOGLE_PLACES_API_KEY ? 'GOOGLE_PLACES_API_KEY' : null,
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ? 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY' : null,
    ].filter(Boolean);

    if (!key) {
      return NextResponse.json(
        { ok: false, error: 'Google API key missing on server.', availableKeys },
        { status: 500 }
      );
    }

    const qs = new URLSearchParams();
    qs.set(sizeKey, sizeVal);

    // KRITISCH: muss "photo_reference" heißen
    qs.set('photo_reference', ref);
    qs.set('key', key);

    const gUrl = `https://maps.googleapis.com/maps/api/place/photo?${qs.toString()}`;

    if (diag) {
      return NextResponse.json({
        ok: true,
        received: {
          photoreference: ref,
          maxwidth: mw ? Number(mw) : null,
          maxheight: mh ? Number(mh) : null,
        },
        pickedKey: picked,
        builtUrl: gUrl.replace(key, '***'),
        availableKeys,
        hint: 'Success is typically a 302 redirect or a 200 image. 400=bad request, 403=restrictions/billing/api not enabled.',
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
