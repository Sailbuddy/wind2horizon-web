// app/api/gphoto/route.js
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function pickKey() {
  return (
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    ''
  );
}

export async function GET(req) {
  try {
    const url = new URL(req.url);

    // akzeptiere beide – intern aber IMMER photo_reference verwenden
    const ref =
      url.searchParams.get('photo_reference') ??
      url.searchParams.get('photoreference');

    if (!ref) {
      return NextResponse.json(
        { ok: false, error: 'Missing photo_reference' },
        { status: 400 }
      );
    }

    const mw = Number(url.searchParams.get('maxwidth') || '800');
    const sizeVal = String(mw > 0 ? mw : 800);

    const key = pickKey();
    if (!key) {
      return NextResponse.json(
        { ok: false, error: 'Google API key missing on server' },
        { status: 500 }
      );
    }

    const qs = new URLSearchParams();
    qs.set('maxwidth', sizeVal);

    // ✅ DAS ist entscheidend
    qs.set('photo_reference', ref);
    qs.set('key', key);

    const gUrl = `https://maps.googleapis.com/maps/api/place/photo?${qs.toString()}`;

    // Diagnosemodus
    if (url.searchParams.get('diag')) {
      return NextResponse.json({
        ok: true,
        builtUrl: gUrl.replace(key, '***'),
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
        'cache-control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Proxy error' },
      { status: 500 }
    );
  }
}
