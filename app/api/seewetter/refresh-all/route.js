// app/api/seewetter/refresh-all/route.js
import * as cheerio from 'cheerio';
import { put } from '@vercel/blob';

const URLS = {
  de: 'https://meteo.hr/prognoze_e.php?section=prognoze_specp&param=jadran&el=jadran_n',
  en: 'https://meteo.hr/prognoze_e.php?section=prognoze_specp&param=jadran&el=jadran_e',
  it: 'https://meteo.hr/prognoze_e.php?section=prognoze_specp&param=jadran&el=jadran_t',
  hr: 'https://meteo.hr/prognoze_e.php?section=prognoze_specp&param=jadran&el=jadran_h',
};

const BLOB_PREFIX = 'seewetter/';
const DEBUG = false;

function isVercelCron(req) {
  // 1) offizieller Header (wenn vorhanden)
  const cronHeader = req.headers.get('x-vercel-cron');
  if (cronHeader) return true;

  // 2) Vercel Cron UA (ist bei dir sichtbar)
  const ua = (req.headers.get('user-agent') || '').toLowerCase();
  if (ua.includes('vercel-cron')) return true;

  // 3) Token für manuelle Trigger
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (process.env.SEEWETTER_REFRESH_TOKEN && token === process.env.SEEWETTER_REFRESH_TOKEN) return true;

  // 4) Lokal/Preview erlauben
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
  try {
    const m = (title || '').match(/vom\s+(\d{2})\.(\d{2})\.(\d{4})\s+um\s+(\d{1,2})/i);
    if (!m) return null;
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    const hh = Number(m[4]);
    return new Date(yyyy, mm - 1, dd, hh, 0, 0).toISOString();
  } catch {
    return null;
  }
}

function extractIssuedAtFromBodyText(fullText) {
  try {
    const t = fullText || '';
    const m =
      t.match(/vom\s+(\d{2})\.(\d{2})\.(\d{4}).{0,60}?\bum\s+(\d{1,2})/i) ||
      t.match(/(\d{2})\.(\d{2})\.(\d{4}).{0,60}?\bat\s+(\d{1,2})/i) ||
      t.match(/(\d{2})\.(\d{2})\.(\d{4}).{0,60}?\balle\s+(\d{1,2})/i) ||
      t.match(/(\d{2})\.(\d{2})\.(\d{4}).{0,60}?\bu\s+(\d{1,2})/i);

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

function normalizeForFind(s) {
  return cleanText(s).replace(/\s+/g, ' ').trim();
}

function extractBlockByMarkers(fullText, startMarkers, nextMarkers) {
  const text = fullText || '';

  let startIndex = -1;
  let startLen = 0;
  let usedStart = '';

  for (const sm of startMarkers || []) {
    const idx = text.toLowerCase().indexOf(String(sm).toLowerCase());
    if (idx !== -1 && (startIndex === -1 || idx < startIndex)) {
      startIndex = idx;
      startLen = String(sm).length;
      usedStart = sm;
    }
  }

  if (startIndex === -1) return { usedStart: '', text: '' };

  let endIndex = text.length;
  for (const nm of nextMarkers || []) {
    const idx = text.toLowerCase().indexOf(String(nm).toLowerCase(), startIndex + startLen);
    if (idx !== -1 && idx < endIndex) endIndex = idx;
  }

  const body = text.slice(startIndex + startLen, endIndex);
  return { usedStart, text: cleanText(body) };
}

const MARKERS = {
  de: {
    warning: ['Warnung'],
    synopsis: ['Die Wetterlage', 'Wetterlage'],
    forecast_12h: ['Wettervorhersage für die Adria für die nächsten 12 Stunden', 'Wettervorhersage'],
    outlook_12h: ['Wetteraussicht für die Adria für die weiteren 12 Stunden', 'Wetteraussicht'],
  },
  en: {
    warning: ['Warning'],
    synopsis: ['Synopsis'],
    forecast_12h: ['Weather forecast for the Adriatic for the first 12 hours', 'Weather forecast for the first 12 hours'],
    outlook_12h: ['Weather forecast for the next 12 hours', 'Outlook for the next 12 hours', 'Weather outlook for the next 12 hours'],
  },
  it: {
    warning: ["L'avvertimento", 'L’avvertimento', 'Avvertimento'],
    synopsis: ['La situazione meteorologica'],
    forecast_12h: ["La previsione del tempo per l'Adriatico per le prime 12 ore", 'per le prime 12 ore', 'Previsione per le prime 12 ore'],
    outlook_12h: ["La previsione del tempo per le prossime 12 ore", 'per le prossime 12 ore', 'Tendenza per le prossime 12 ore'],
  },
  hr: {
    warning: ['Upozorenje', 'Upozorenja'],
    synopsis: ['Stanje', 'Sinopsis'],
    forecast_12h: ['Vremenska prognoza za Jadran za prvih 12 sati', 'za prvih 12 sati'],
    outlook_12h: ['Vremenska prognoza za daljnjih 12 sati', 'za daljnjih 12 sati'],
  },
};

function extractSectionsFromHtml(html, lang) {
  const $ = cheerio.load(html);

  const root =
    $('#primary .glavni__content').first().length ? $('#primary .glavni__content').first()
    : $('#primary').first().length ? $('#primary').first()
    : $('#main-content').first().length ? $('#main-content').first()
    : $('body');

  const bodyText = normalizeForFind($('body').text() || '');

  if (DEBUG) {
    const rootTest = $('#primary .glavni__content').first();
    console.log('[seewetter] rootTest length:', rootTest.length);
    console.log('[seewetter] rootTest h4:', cleanText(rootTest.find('h4').first().text()));
    console.log('[seewetter] rootTest first h5:', cleanText(rootTest.find('h5').first().text()));
  }

  const h4WithDate = root.find('h4').toArray().map((el) => $(el)).find(($el) => {
    const t = cleanText($el.text());
    return /\b\d{2}\.\d{2}\.\d{4}\b/.test(t);
  });

  const titleFromH4 = cleanText(h4WithDate ? h4WithDate.text() : root.find('h4').first().text());
  const titleFromH1 = cleanText(root.find('h1').first().text());
  const titleFromTitle = cleanText($('title').text());

  const title =
    titleFromH4 ||
    titleFromH1 ||
    titleFromTitle ||
    (bodyText.toLowerCase().includes('seewetterbericht') ? bodyText.slice(0, 140) : 'Sea Weather Split');

  const issuedAt = extractIssuedAtFromTitle(title) || extractIssuedAtFromBodyText(bodyText);

  const headings = root.find('h5');
  const rawSections = [];

  headings.each((i, el) => {
    const label = cleanText($(el).text());
    if (!label) return;

    let n = $(el).next();
    const parts = [];

    while (n && n.length) {
      const tag = (n[0]?.tagName || '').toLowerCase();
      if (tag === 'h5') break;

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

  const portalLabelHit = rawSections.some(s =>
    /warning systems|remote sensing|air quality|hydrological/i.test(String(s.label || ''))
  );
  const portalTitleHit =
    /croatian meteorological/i.test(title) && !/\b\d{2}\.\d{2}\.\d{4}\b/.test(title);

  const looksLikePortal = portalLabelHit || portalTitleHit;

  if (rawSections.length < 2 || looksLikePortal) {
    const m = MARKERS[lang] || MARKERS.de;

    const w = extractBlockByMarkers(bodyText, m.warning, [...m.synopsis, ...m.forecast_12h, ...m.outlook_12h]);
    const s = extractBlockByMarkers(bodyText, m.synopsis, [...m.forecast_12h, ...m.outlook_12h]);
    const f = extractBlockByMarkers(bodyText, m.forecast_12h, [...m.outlook_12h]);
    const o = extractBlockByMarkers(bodyText, m.outlook_12h, []);

    const fallbackSections = [];
    if (w.text) fallbackSections.push({ label: w.usedStart || 'Warning', text: w.text });
    if (s.text) fallbackSections.push({ label: s.usedStart || 'Synopsis', text: s.text });
    if (f.text) fallbackSections.push({ label: f.usedStart || 'Forecast', text: f.text });
    if (o.text) fallbackSections.push({ label: o.usedStart || 'Outlook', text: o.text });

    return { title, issuedAt, rawSections: fallbackSections };
  }

  return { title, issuedAt, rawSections };
}

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

    if (!blocks.warning && (h.includes('warn') || h.includes('warning') || h.includes('avvert') || h.includes('upozor'))) {
      blocks.warning = { label: sec.label, text: sec.text };
      continue;
    }

    if (!blocks.synopsis && (
      h.includes('wetterlage') ||
      h.includes('synopsis') ||
      h.includes('situaz') ||
      h.includes('sinops') ||
      h.includes('sinop') ||
      h.includes('stanje') ||
      h.includes('vremensk')
    )) {
      blocks.synopsis = { label: sec.label, text: sec.text };
      continue;
    }

    if (!blocks.forecast_12h && (
      (h.includes('vorhersage') && h.includes('12')) ||
      (h.includes('forecast') && h.includes('12')) ||
      (h.includes('previs') && h.includes('12')) ||
      (h.includes('progno') && h.includes('12')) ||
      (h.includes('prvih') && h.includes('12')) ||
      (h.includes('first') && h.includes('12'))
    )) {
      blocks.forecast_12h = { label: sec.label, text: sec.text };
      continue;
    }

    if (!blocks.outlook_12h && (
      (h.includes('aussicht') && h.includes('12')) ||
      (h.includes('outlook') && h.includes('12')) ||
      (h.includes('tenden') && h.includes('12')) ||
      (h.includes('prossime') && h.includes('12')) ||
      (h.includes('daljnjih') && h.includes('12')) ||
      (h.includes('next') && h.includes('12'))
    )) {
      blocks.outlook_12h = { label: sec.label, text: sec.text };
      continue;
    }
  }

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

  for (const k of Object.keys(blocks)) {
    if (!blocks[k]) blocks[k] = { label: '', text: '' };
  }

  return blocks;
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
  const { title, issuedAt, rawSections } = extractSectionsFromHtml(html, lang);
  const blocks = mapToBlocks(rawSections);

  const payload = {
    sourceUrl,
    title,
    issuedAt: issuedAt || null,
    fetchedAt: new Date().toISOString(),
    blocks,
  };

  const pathname = `${BLOB_PREFIX}${lang}.json`;
  await put(pathname, JSON.stringify(payload, null, 2), {
    access: 'public',
    contentType: 'application/json; charset=utf-8',
    allowOverwrite: true,
  });

  return {
    lang,
    ok: true,
    updated: true,          // <- ab jetzt immer true
    issuedAt: payload.issuedAt,
    title,
  };
}

export async function GET(req) {
 if (!isVercelCron(req)) {
  return new Response(JSON.stringify({
    ok: false,
    error: 'unauthorized',
    build: {
      commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      env: process.env.VERCEL_ENV || process.env.NODE_ENV || null,
    }
  }), {
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
