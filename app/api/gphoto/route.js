// app/api/gphoto/route.js
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VERSION = 'gphoto-2026-01-02-19-45';

// WICHTIG:
// - Nutze serverseitig KEINEN NEXT_PUBLIC Key.
// - Auf Vercel als Secret setzen, z.B. GOOGLE_PLACES_SERVER_KEY oder GOOGLE_MAPS_SERVER_KEY.
function getServerKey() {
  return (
    process.env.GOOGLE_PLACES_SERVER_KEY ||
    process.env.GOOGLE_MAPS_SERVER_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.SUPABASE_GOOGLE_KEY || // falls du sowas hast
    null
  );
}

// Extrahiert aus Googles HTML eine kompakte Fehlermeldung
function extractGoogleHtmlMessage(html = '') {
  const s = String(html || '');

  // title
  const t = s.match(/<title>(.*?)<\/title>/i)?.[1]?.trim() || '';

  // häufig steht die Aussage in einem <p>...</p> weiter unten
  const ps = [];
  const pRe = /<p>(.*?)<\/p>/gi;
  let m;
  while ((m = pRe.exec(s)) !== null) {
    const txt = m[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (txt) ps.push(txt);
    if (ps.length >= 3) break;
  }

  // manchmal findet man "REQUEST_DENIED" o.ä. im HTML
  const hints = [];
  ['REQUEST_DENIED', 'INVALID_REQUEST', 'OVER_QUERY_LIMIT', 'key', 'API', 'not authorized', 'billing'].forEach((k) => {
    if (s.toLowerCase().includes(k.toLowerCase())) hints.push(k);
  });

  const msgParts = [];
  if (t) msgParts.push(t);
  if (ps.length) msgParts.push(...ps);
  if (hints.length) msgParts.push(`Hints: ${[...new Set(hints)].join(', ')}`);

  return msgParts.join(' | ').trim();
}

async function fetchGooglePhoto({ key, ref, maxwidth, maxheight, paramName }) {
  const u = new URL('https://maps.googleapis.com/maps/api/place/photo');
  if (maxwidth) u.searchParams.set('maxwidth', String(maxwidth));
  if (maxheight) u.searchParams.set('maxheight', String(maxheight));
  u.searchParams.set(paramName, String(ref));
  u.searchParams.set('key', key);

  // redirect: 'manual' ist hier entscheidend, weil Google häufig 302 zum Bild liefert.
  const res = await fetch(u.toString(), {
    method: 'GET',
    redirect: 'manual',
    // keine speziellen headers nötig
  });

  return { res, url: u.toString(), paramName };
}

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);

    const ref =
      searchParams.get('photo_reference') ||
      searchParams.get('photoreference') ||
      searchParams.get('photoRef') ||
      searchParams.get('ref');

    const maxwidth = Number(searchParams.get('maxwidth') || 600);
    const maxheightRaw = searchParams.get('maxheight');
    const maxheight = maxheightRaw ? Number(maxheightRaw) : null;

    const diag = searchParams.get('diag') === '1';

    if (!ref || String(ref).trim().length < 10) {
      return NextResponse.json(
        { ok: false, version: VERSION, error: 'Missing or invalid photo reference', received: { ref: ref || null } },
        { status: 400 }
      );
    }

    const key = getServerKey();
    if (!key) {
      return NextResponse.json(
        {
          ok: false,
          version: VERSION,
          error:
            'Missing server-side Google API key. Set GOOGLE_PLACES_SERVER_KEY (recommended) or GOOGLE_MAPS_SERVER_KEY in Vercel env.',
        },
        { status: 500 }
      );
    }

    // 1) First try with "photoreference" (historisch oft so genutzt)
    let attempt = await fetchGooglePhoto({ key, ref, maxwidth, maxheight, paramName: 'photoreference' });

    // 2) If upstream 4xx, retry with "photo_reference" (andere Doku/Stacks)
    if (attempt.res.status >= 400 && attempt.res.status < 500) {
      const retry = await fetchGooglePhoto({ key, ref, maxwidth, maxheight, paramName: 'photo_reference' });
      // wenn Retry besser ist, nimm Retry, sonst lass ersten Versuch
      if (retry.res.status < attempt.res.status) attempt = retry;
      else if (retry.res.status >= 200 && retry.res.status < 400) attempt = retry;
    }

    const { res, url, paramName } = attempt;

    // Diagnose-Mode: nur zeigen, was wir gebaut haben
    if (diag) {
      return NextResponse.json(
        {
          ok: true,
          version: VERSION,
          received: { ref_len: String(ref).length, maxwidth, maxheight },
          upstream: { url, triedParam: paramName, status: res.status, contentType: res.headers.get('content-type') || null },
        },
        { status: 200 }
      );
    }

    // Erfolgsfall: Google liefert oft Redirect auf das Bild
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) {
        // selten: redirect ohne Location
        const body = await res.text().catch(() => '');
        return NextResponse.json(
          {
            ok: false,
            version: VERSION,
            error: 'Upstream redirect without Location header',
            upstream: { status: res.status, url, triedParam: paramName, contentType: res.headers.get('content-type') || null },
            bodySnippet: String(body).slice(0, 2000),
          },
          { status: 502 }
        );
      }

      // Browser lädt Bild direkt von Google (ohne Key), wir verraten keinen Key.
      return NextResponse.redirect(loc, { status: 302 });
    }

    // Wenn Google direkt ein Bild liefert (200 image/*), einfach durchreichen
    const ct = res.headers.get('content-type') || '';
    if (res.ok && ct.startsWith('image/')) {
      const buf = await res.arrayBuffer();
      return new NextResponse(buf, {
        status: 200,
        headers: {
          'Content-Type': ct,
          'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        },
      });
    }

    // Fehlerfall: HTML lesen (größerer Ausschnitt), Message extrahieren
    const bodyText = await res.text().catch(() => '');
    const bodyHead = String(bodyText).slice(0, 20000); // mehr Kontext
    const msg = extractGoogleHtmlMessage(bodyHead);

    return NextResponse.json(
      {
        ok: false,
        version: VERSION,
        error: 'Google Place Photo upstream failed',
        upstream: {
          status: res.status,
          contentType: ct || null,
          triedParam: paramName,
          url: url.replace(/key=([^&]+)/, 'key=***'),
          message: msg || null,
          bodySnippet: bodyHead.slice(0, 4000),
        },
      },
      { status: 502 }
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, version: VERSION, error: e?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}
