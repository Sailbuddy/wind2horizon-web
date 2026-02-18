// app/api/seewetter/refresh-all/route.js
import * as cheerio from 'cheerio';
import { list, put } from '@vercel/blob';

const URLS = {
  de: 'https://meteo.hr/prognoze_e.php?section=prognoze_specp&param=jadran&el=jadran_n',
  en: 'https://meteo.hr/prognoze_e.php?section=prognoze_specp&param=jadran&el=jadran_e',
  it: 'https://meteo.hr/prognoze_e.php?section=prognoze_specp&param=jadran&el=jadran_t',
  hr: 'https://meteo.hr/prognoze_e.php?section=prognoze_specp&param=jadran&el=jadran_h',
};

const BLOB_PREFIX = 'seewetter/';

function isVercelCron(req) {
  // Vercel Cron setzt typischerweise einen Header. Je nach Plattform-Version:
  // - x-vercel-cron: 1
  // Wir akzeptieren zusätzlich optional einen Token für manuelle Tests.
  const cronHeader = req.headers.get('x-vercel-cron');
  if (cronHeader) return true;

  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (process.env.SEEWETTER_REFRESH_TOKEN && token === process.env.SEEWETTER_REFRESH_TOKEN) return true;

  // DEV: lokal erlauben (optional)
  if (process.env.NODE_ENV !== 'production') return true;

  return false;
}

function cleanText(s) {
  return (s || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractIssuedAtFromTitle(title) {
  // Beispiel: "... vom 18.02.2026 um 06"
  try {
    const m = title.match(/vom\s+(\d{2})\.(\d{2})\.(\d{4})\s+um\s+(\d{1,2})/i);
    if (!m) return null;
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    const hh = Number(m[4]);
    return new Date(Date.UTC(yyyy, mm - 1, dd, hh, 0, 0)).toISOString();
  } catch {
    return null;
  }
}

// Headings+Text bis zum nächsten Heading
function extractSectionsFromHtml(html) {
  const $ = cheerio.load(html);

  const title =
    cleanText($('h1').first().text()) ||
    cleanText($('title').text()) ||
    'Seewetterbericht Split';

  const issuedAt = extractIssuedAtFromTitle(title);

  const root =
    $('#content').first().length ? $('#content').first()
    : $('main').first().length ? $('main').first()
    : $('body');

  const headings = root.find('h2, h3');

  const rawSections = [];
  headings.each((i, el) => {
    const label = cleanText($(el).text());
    if (!label) return;

    let n = $(el).next();
    const parts = [];

    while (n && n.length) {
      const tag = (n[0]?.tagName || '').toLowerCase();
      if (tag === 'h2' || tag === 'h3') break;

      // Text sammeln
      if (tag === 'p' || tag === 'div' || tag === 'span') {
        const t = cleanText(n.text());
        if (t) parts.push(t);
      } else if (tag === 'ul' || tag === 'ol') {
        const items = n.find('li').toArray().map(li => cleanText($(li).text())).filter(Boolean);
        if (items.length) parts.push(items.map(x => `- ${x}`).join('\n'));
      }

      n = n.next();
    }

    const text = cleanText(parts.join('\n\n'));
    if (text) rawSections.push({ label, text });
  });

  return { title, issuedAt, rawSections };
}

// Keyword-Mapping -> feste Blocks
function mapToBlocks(rawSections) {
  const blocks = {
    warning: null,
    synopsis: null,
    forecast_12h: null,
    outlook_12h: null,
  };

  const norm = (s) => (s || '').toLowerCase();

  for (const sec of rawSections) {
    const h = norm(sec.label);

    // 1) Warnung
    if (!blocks.warning && (h.includes('warn') || h.includes('warning') || h.includes('avverten') || h.includes('upozor'))) {
      blocks.warning = { label: sec.label, text: sec.text };
      continue;
    }

    // 2) Wetterlage / Synopsis
    if (!blocks.synopsis && (
      h.includes('wetterlage') ||
      h.includes('synopsis') ||
      h.includes('situaz') ||     // it: situazione
      h.includes('sinops')        // hr/it variants
    )) {
      blocks.synopsis = { label: sec.label, text: sec.text };
      continue;
    }

    // 3) Vorhersage nächste 12h
    if (!blocks.forecast_12h && (
      (h.includes('vorhersage') && h.includes('12')) ||
      (h.includes('forecast') && h.includes('12')) ||
      (h.includes('previs') && h.includes('12')) ||   // it: previsione
      (h.includes('progno') && h.includes('12'))      // hr: prognoza
    )) {
      blocks.forecast_12h = { label: sec.label, text: sec.text };
      continue;
    }

    // 4) Aussicht weitere 12h
    if (!blocks.outlook_12h && (
      (h.includes('aussicht') && h.includes('12')) ||
      (h.includes('outlook') && h.includes('12')) ||
      (h.includes('tenden') && h.includes('12')) ||   // mögliche Varianten
      (h.includes('izgled') && h.includes('12'))      // hr: izgled (falls)
    )) {
      blocks.outlook_12h = { label: sec.label, text: sec.text };
      continue;
    }
  }

  // Fallback: wenn Mapping nicht 100% greift, nimm die ersten vier in Reihenfolge
  const nonNullCount = Object.values(blocks).filter(Boolean).length;
  if (nonNullCount < 2 && rawSections.length >= 2) {
    const pick = (i, key) => {
      if (!blocks[key] && rawSections[i]) blocks[key] = { label: rawSections[i].label, text: rawSections[i].text };
    };
    pick(0, 'warning');
    pick(1, 'synopsis');
    pick(2, 'forecast_12h');
    pick(3, 'outlook_12h');
  }

  // Immer Objekte liefern (auch wenn leer), damit Client stabil bleibt
  for (const k of Object.keys(blocks)) {
    if (!blocks[k]) blocks[k] = { label: '', text: '' };
  }

  return blocks;
}

async function getExistingIssuedAt(lang) {
  const pathname = `${BLOB_PREFIX}${lang}.json`;
  const res = await list({ prefix: pathname, limit: 10 });
  const exact = res.blobs?.find(b => b.pathname === pathname);
  if (!exact?.url) return null;

  const r = await fetch(exact.url, { cache: 'no-store' });
  if (!r.ok) return null;
  const j = await r.json();
  return j?.issuedAt || null;
}

async function refreshOneLang(lang) {
  const sourceUrl = URLS[lang];

  const res = await fetch(sourceUrl, {
    headers: {
      'User-Agent': 'wind2horizon/1.0 (+https://wind2horizon.com)',
      'Accept': 'text/html,application/xhtml+xml',
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    return { lang, ok: false, sourceUrl, error: `upstream ${res.status}` };
  }

  const html = await res.text();
  const { title, issuedAt, rawSections } = extractSectionsFromHtml(html);
  const blocks = mapToBlocks(rawSections);

  const existingIssuedAt = await getExistingIssuedAt(lang);

  // Wenn issuedAt fehlt (ungewöhnlich), behandeln wir als "update", damit wir wenigstens Inhalt haben
  const isNew = !existingIssuedAt || !issuedAt || issuedAt !== existingIssuedAt;

  const payload = {
    sourceUrl,
    title,
    issuedAt: issuedAt || null,
    fetchedAt: new Date().toISOString(),
    blocks,
  };

  if (isNew) {
    const pathname = `${BLOB_PREFIX}${lang}.json`;
    await put(pathname, JSON.stringify(payload, null, 2), {
      access: 'public',
      contentType: 'application/json; charset=utf-8',
      // addRandomSuffix: false // (je nach SDK-Version optional; pathname reicht als Identifier)
    });
  }

  return { lang, ok: true, updated: isNew, issuedAt: payload.issuedAt, existingIssuedAt };
}

export async function GET(req) {
  if (!isVercelCron(req)) {
    return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  const langs = ['de', 'en', 'it', 'hr'];

  const results = [];
  for (const lang of langs) {
    try {
      results.push(await refreshOneLang(lang));
    } catch (e) {
      results.push({ lang, ok: false, error: e?.message || 'unknown error' });
    }
  }

  const anyOk = results.some(r => r.ok);
  return new Response(JSON.stringify({
    ok: anyOk,
    refreshedAt: new Date().toISOString(),
    results,
  }, null, 2), {
    status: anyOk ? 200 : 500,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
