// app/api/seewetter/route.js
import { list } from '@vercel/blob';

const BLOB_PREFIX = 'seewetter/';

function normLang(raw) {
  const l = (raw || '').toLowerCase().trim();
  if (l === 'fr') return 'en';
  return ['de', 'en', 'it', 'hr'].includes(l) ? l : 'en';
}

async function getLatestBlobUrl(pathname) {
  // list liefert die neuesten zuerst (typisch). Wir nehmen das erste Matching.
  const res = await list({ prefix: pathname, limit: 10 });
  const exact = res.blobs?.find(b => b.pathname === pathname);
  return exact?.url || null;
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const lang = normLang(searchParams.get('lang'));

  const pathname = `${BLOB_PREFIX}${lang}.json`;
  const url = await getLatestBlobUrl(pathname);

  if (!url) {
    return new Response(JSON.stringify({
      ok: false,
      lang,
      error: 'Cache leer – noch kein Seewetterbericht gespeichert.',
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  // Blob ist öffentlich, wir lesen per fetch
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) {
    return new Response(JSON.stringify({
      ok: false,
      lang,
      error: `Blob read failed (${r.status})`,
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  const data = await r.json();

  return new Response(JSON.stringify({ ok: true, lang, ...data }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Browser darf kurz cachen (der echte Refresh kommt über Cron)
      'Cache-Control': 'public, max-age=60',
    },
  });
}
