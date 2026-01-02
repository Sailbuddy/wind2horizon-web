// app/api/gphoto/route.js
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Priorität: echte Server-Keys zuerst. KEINE NEXT_PUBLIC Keys (nur optional für Debug).
const KEY_CANDIDATES = [
  { name: 'GOOGLE_API_KEY', value: process.env.GOOGLE_API_KEY },
  { name: 'GOOGLE_MAPS_API_KEY', value: process.env.GOOGLE_MAPS_API_KEY },
  { name: 'VITE_GOOGLE_MAPS_API_KEY', value: process.env.VITE_GOOGLE_MAPS_API_KEY },
  // Notfall-Debug (normalerweise NICHT verwenden):
  { name: 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', value: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY },
].filter((k) => k.value && String(k.value).trim());

function pickKey(preferName) {
  if (preferName) {
    const hit = KEY_CANDIDATES.find((k) => k.name === preferName);
    if (hit) return hit;
  }
  return KEY_CANDIDATES[0] || { name: '(none)', value: '' };
}

async function probeGooglePhoto({ key, sizeKey, sizeVal, ref }) {
  const qs = new URLSearchParams();
  qs.set(sizeKey, sizeVal);

  // CRITICAL: Google Places Photo endpoint expects "photoreference"
  qs.set('photoreference', ref);
  qs.set('key', key);

  const gUrl = `https://maps.googleapis.com/maps/api/place/photo?${qs.toString()}`;

  // Wir fetchen nur den Status/Headers (kein Body), um Key/Restrictions zu testen.
  const resp = await fetch(gUrl, { redirect: 'manual' });

  // Google liefert bei Erfolg meist 302 Redirect zur Bild-URL (oder 200 bei direkter Ausgabe).
  // Bei Fehler: 403/400 etc.
  return {
    status: resp.status,
    location: resp.headers.get('location') || null,
    contentType: resp.headers.get('content-type') || null,
    cacheControl: resp.headers.get('cache-control') || null,
    builtUrlMasked: gUrl.replace(key, '***'),
  };
}

export async function GET(req) {
  try {
    const url = new URL(req.url);

    // akzeptiere beide Param-Namen vom Client:
    // - photoreference (dein Client)
    // - photo_reference (falls irgendwo noch im Code)
    let ref =
      url.searchParams.get('photoreference') ??
      url.searchParams.get('photo_reference');

    if (!ref) {
      return NextResponse.json(
        { ok: false, error: 'Missing "photoreference" or "photo_reference".' },
        { status: 400 }
      );
    }

    // URLSearchParams decodiert "+" zu Space, daher reparieren:
    ref = String(ref).replace(/ /g, '+');

    const mw = Number(url.searchParams.get('maxwidth') || '0');
    const mh = Number(url.searchParams.get('maxheight') || '0');
    const sizeKey = mw > 0 ? 'maxwidth' : mh > 0 ? 'maxheight' : 'maxwidth';
    const sizeVal = mw > 0 ? String(mw) : mh > 0 ? String(mh) : '800';

    // diag modes:
    // diag=1 -> nur URL + welcher Key (ohne Google Call)
    // diag=2 -> Key-Probe: testet alle Keys und zeigt Status (welcher 302/200 liefert)
    const diag = url.searchParams.get('diag');

    const forcedKeyName = url.searchParams.get('keyname'); // optional: ?keyname=GOOGLE_API_KEY
    const picked = pickKey(forcedKeyName);

    if (!picked.value) {
      return NextResponse.json(
        { ok: false, error: 'Google API key missing on server.' },
        { status: 500 }
      );
    }

    // diag=1: nur Konstruktion anzeigen
    if (diag === '1') {
      const qs = new URLSearchParams();
      qs.set(sizeKey, sizeVal);
      qs.set('photoreference', ref);
      qs.set('key', picked.value);
      const gUrl = `https://maps.googleapis.com/maps/api/place/photo?${qs.toString()}`;

      return NextResponse.json({
        ok: true,
        received: { photoreference: ref, maxwidth: mw || null, maxheight: mh || null },
        pickedKey: picked.name,
        builtUrl: gUrl.replace(picked.value, '***'),
        availableKeys: KEY_CANDIDATES.map((k) => k.name),
      });
    }

    // diag=2: alle Keys testen (Status/Redirect prüfen)
    if (diag === '2') {
      const results = [];
      for (const k of KEY_CANDIDATES) {
        try {
          const r = await probeGooglePhoto({
            key: k.value,
            sizeKey,
            sizeVal,
            ref,
          });
          results.push({ key: k.name, ...r });
        } catch (e) {
          results.push({ key: k.name, error: String(e?.message || e) });
        }
      }

      return NextResponse.json({
        ok: true,
        received: { photoreference: ref, maxwidth: mw || null, maxheight: mh || null },
        results,
        hint:
          'Success typically = status 302 (redirect) or 200. 403 = key restriction/billing/API not enabled for that key.',
      });
    }

    // Normaler Betrieb: Bild streamen
    const qs = new URLSearchParams();
    qs.set(sizeKey, sizeVal);
    qs.set('photoreference', ref);
    qs.set('key', picked.value);

    const gUrl = `https://maps.googleapis.com/maps/api/place/photo?${qs.toString()}`;

    const upstream = await fetch(gUrl, {
      redirect: 'follow',
      headers: {
        accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      },
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      return new NextResponse(
        text || `Upstream error ${upstream.status}`,
        {
          status: upstream.status,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        }
      );
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
