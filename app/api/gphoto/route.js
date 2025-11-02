// app/api/gphoto/route.js
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';     // kein Static Rendering
export const runtime = 'nodejs';            // Node-Runtime (nicht Edge)

function pickKey() {
  return (
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    ''
  );
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const ref =
      url.searchParams.get('photoreference') ??
      url.searchParams.get('photo_reference');

    if (!ref) {
      return NextResponse.json(
        { ok: false, error: 'Missing "photoreference".' },
        { status: 400 }
      );
    }

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
    qs.set('photo_reference', ref);
    qs.set('key', key);

    const gUrl = `https://maps.googleapis.com/maps/api/place/photo?` + qs.toString();

    if (diag) {
      return NextResponse.json({
        ok: true,
        received: { photoreference: ref, maxwidth: mw || null, maxheight: mh || null },
        builtUrl: gUrl.replace(key, '***'),
        usedEnvVar:
          (process.env.VITE_GOOGLE_MAPS_API_KEY && 'VITE_GOOGLE_MAPS_API_KEY') ||
          (process.env.GOOGLE_MAPS_API_KEY && 'GOOGLE_MAPS_API_KEY') ||
          (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY && 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY') ||
          '(none)',
      });
    }

    const upstream = await fetch(gUrl, { redirect: 'follow' });
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return new NextResponse(text || `Upstream error ${upstream.status}`, {
        status: upstream.status,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        'content-type': contentType,
        'cache-control': 'public, max-age=86400, immutable',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Proxy error: ${err?.message || 'unknown'}` },
      { status: 500 }
    );
  }
}
