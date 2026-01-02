import { NextResponse } from 'next/server';

export const runtime = 'nodejs'; // wichtig für fetch/streaming stabil auf Vercel
export const dynamic = 'force-dynamic';

function getServerKey() {
  return (
    process.env.GOOGLE_PLACES_SERVER_KEY ||
    process.env.GOOGLE_MAPS_SERVER_KEY ||
    process.env.GOOGLE_API_KEY ||
    null
  );
}

function pickRef(url) {
  return (
    url.searchParams.get('photo_reference') ||
    url.searchParams.get('photoreference') ||
    url.searchParams.get('ref') ||
    ''
  );
}

function pickSize(url) {
  const mw = url.searchParams.get('maxwidth');
  const mh = url.searchParams.get('maxheight');
  const maxwidth = mw ? Math.max(1, Math.min(2000, parseInt(mw, 10) || 0)) : 800;
  const maxheight = mh ? Math.max(1, Math.min(2000, parseInt(mh, 10) || 0)) : null;
  return { maxwidth, maxheight };
}

async function safeText(res) {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

// folgt Redirects bis zum finalen Bild (max 5 hops)
async function fetchWithRedirects(url, opts, maxHops = 5) {
  let current = url;
  for (let i = 0; i < maxHops; i++) {
    const res = await fetch(current, { ...opts, redirect: 'manual' });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return res;
      current = loc.startsWith('http') ? loc : new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  return fetch(current, { ...opts, redirect: 'follow' });
}

export async function GET(req) {
  const key = getServerKey();
  const url = new URL(req.url);

  const diag = url.searchParams.get('diag') === '1';
  const ref = pickRef(url);
  const { maxwidth, maxheight } = pickSize(url);

  if (!key) {
    return NextResponse.json(
      {
        ok: false,
        version: 'gphoto-2026-01-02-19-45',
        error: 'Missing server-side Google API key. Set GOOGLE_PLACES_SERVER_KEY (recommended) or GOOGLE_MAPS_SERVER_KEY in Vercel env.',
      },
      { status: 500 }
    );
  }

  if (!ref || ref.length < 20) {
    return NextResponse.json(
      {
        ok: false,
        version: 'gphoto-2026-01-02-19-45',
        error: 'Missing/invalid photo reference.',
        received: { ref_len: ref ? ref.length : 0, maxwidth, maxheight },
      },
      { status: 400 }
    );
  }

  const upstream = new URL('https://maps.googleapis.com/maps/api/place/photo');
  if (maxheight) upstream.searchParams.set('maxheight', String(maxheight));
  else upstream.searchParams.set('maxwidth', String(maxwidth));

  // WICHTIG: Google erwartet "photoreference"
  upstream.searchParams.set('photoreference', ref);
  upstream.searchParams.set('key', key);

  if (diag) {
    return NextResponse.json(
      {
        ok: true,
        version: 'gphoto-2026-01-02-19-45',
        received: { ref_len: ref.length, maxwidth, maxheight },
        upstream: { url: upstream.toString().replace(key, '***') },
      },
      { status: 200 }
    );
  }

  try {
    const res = await fetchWithRedirects(upstream.toString(), { method: 'GET' });

    // Google liefert bei Erfolg oft 302 -> final image CDN
    const ct = res.headers.get('content-type') || '';

    // Wenn es ein Bild ist, direkt durchreichen
    if (res.ok && ct.startsWith('image/')) {
      const buf = Buffer.from(await res.arrayBuffer());
      return new NextResponse(buf, {
        status: 200,
        headers: {
          'content-type': ct,
          // optionales Caching (du kannst das später hochdrehen)
          'cache-control': 'public, max-age=86400, s-maxage=86400',
          'x-w2h-gphoto-version': 'gphoto-2026-01-02-19-45',
        },
      });
    }

    // Fehler / kein Bild: Textsnippet zurückgeben, damit du REQUEST_DENIED etc. siehst
    const body = await safeText(res);
    const snippet = body ? body.slice(0, 600) : '';

    return NextResponse.json(
      {
        ok: false,
        version: 'gphoto-2026-01-02-19-45',
        upstream: {
          status: res.status,
          contentType: ct || null,
          url: upstream.toString().replace(key, '***'),
          bodySnippet: snippet,
        },
      },
      { status: 502 }
    );
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        version: 'gphoto-2026-01-02-19-45',
        error: e?.message || 'Proxy failed',
      },
      { status: 502 }
    );
  }
}
