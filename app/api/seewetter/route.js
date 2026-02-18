// app/api/seewetter/route.js
import { list } from '@vercel/blob';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const BLOB_PREFIX = 'seewetter/';

function normLang(raw) {
  const l = (raw || '').toLowerCase().trim();
  if (l === 'fr') return 'en';
  return ['de', 'en', 'it', 'hr'].includes(l) ? l : 'en';
}

async function getLatestBlobUrl(pathname) {
  const res = await list({ prefix: pathname, limit: 10 });
  const exact = res.blobs?.find((b) => b.pathname === pathname);
  return exact?.url || null;
}

const NO_CACHE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
  'Pragma': 'no-cache',
};

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const lang = normLang(searchParams.get('lang'));

  const pathname = `${BLOB_PREFIX}${lang}.json`;
  const url = await getLatestBlobUrl(pathname);

  if (!url) {
    return new Response(
      JSON.stringify({
        ok: false,
        lang,
        error: 'Cache leer – noch kein Seewetterbericht gespeichert.',
      }),
      { status: 503, headers: NO_CACHE_HEADERS }
    );
  }

  // Blob ist öffentlich, wir lesen per fetch
  const r = await fetch(url, {
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    },
  });

  if (!r.ok) {
    return new Response(
      JSON.stringify({
        ok: false,
        lang,
        error: `Blob read failed (${r.status})`,
      }),
      { status: 502, headers: NO_CACHE_HEADERS }
    );
  }

  const data = await r.json();

  return new Response(JSON.stringify({ ok: true, lang, ...data }), {
    status: 200,
    headers: NO_CACHE_HEADERS,
  });
}
