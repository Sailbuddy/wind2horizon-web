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
  const cronHeader = req.headers.get('x-vercel-cron');
  if (cronHeader) return true;

  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (process.env.SEEWETTER_REFRESH_TOKEN && token === process.env.SEEWETTER_REFRESH_TOKEN) return true;

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

function extractIssuedAtFromBodyText(fullText) {
  // Robuster Fallback, falls title/h1 nicht den "vom ... um ..." enthält
  // Greift z.B. "vom 18.02.2026 um 06" oder "18.02.2026 ... at 06" usw.
  try {
    const m =
      fullText.match(/vom\s+(\d{2})\.(\d{2})\.(\d{4}).{0,40}?\bum\s+(\d{1,2})/i) ||
      fullText.match(/(\d{2})\.(\d{2})\.(\d{4}).{0,40}?\bat\s+(\d{1,2})/i) ||
      fullText.match(/(\d{2})\.(\d{2})\.(\d{4}).{0,40}?\balle\s+(\d{1,2})/i) ||
      fullText.match(/(\d{2})\.(\d{2})\.(\d{4}).{0,40}?\bu\s+(\d{1,2})/i);

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

// ----------
// Text-basierte Block-Extraktion (Fallback, wenn h2/h3 nicht vorhanden)
// ----------
function normalizeForFind(s) {
  return cleanText(s).replace(/\s+/g, ' ').trim();
}

function extractBlockByMarkers(fullText, startMarkers, nextMarkers) {
  const text = fullText;

  // finde den frühesten Startmarker, der vorkommt
  let startIndex = -1;
  let startLen = 0;
  let usedStart = '';

  for (const sm of startMarkers) {
    const idx = text.toLowerCase().indexOf(sm.toLowerCase());
    if (idx !== -1 && (startIndex === -1 || idx < startIndex)) {
      startIndex = idx;
      startLen = sm.length;
      usedStart = sm;
    }
  }

  if (startIndex === -1) return { usedStart: '', text: '' };

  // finde nächstes Marker-Ende
  let endIndex = text.length;
  for (const nm of nextMarkers) {
    const idx = text.toLowerCase().indexOf(nm.toLowerCase(), startIndex + startLen);
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
    forecast_12h: [
    'Weather forecast for the Adriatic for the first 12 hours',
    'Weather forecast for the first 12 hours',
  ],
    outlook_12h: [
    'Weather forecast for the next 12 hours',
    'Weather forecast for the next 12 hours',
  ],
  },
  it: {
    warning: ["L'avvertimento", 'L’avvertimento'],
    synopsis: ['La situazione meteorologica'],
    forecast_12h: ["La previsione del tempo per l'Adriatico per le prime 12 ore", 'per le prime 12 ore'],
    outlook_12h: ["La previsione del tempo per le prossime 12 ore", 'per le prossime 12 ore'],
  },
  hr: {
    warning: ['Upozorenje', 'Upozorenja'],
    synopsis: ['Stanje'],
    forecast_12h: ['Vremenska prognoza za Jadran za prvih 12 sati', 'za prvih 12 sati'],
    outlook_12h: ['Vremenska prognoza za daljnjih 12 sati', 'za daljnjih 12 sati'],
  },
};

// Headings+Text bis zum nächsten Heading (Primary) + Text-Fallback (Secondary)
function extractSectionsFromHtml(html, lang) {
  const $ = cheerio.load(html);

  // 1) Title: h1/title + Fallback aus Body-Text
  const bodyText = normalizeForFind($('body').text() || '');
    const titleFromH1 = cleanText($('h1').first().text());
  const titleFromTitle = cleanText($('title').text());
  const title =
    titleFromH4 ||
    titleFromH1 ||
    titleFromTitle ||
    (bodyText.includes('Seewetterbericht') ? bodyText.slice(0, 140) : 'Seewetterbericht Split');

  // 2) issuedAt: aus title, sonst aus bodyText
  const issuedAt = extractIssuedAtFromTitle(title) || extractIssuedAtFromBodyText(bodyText);

    // 3) Root: Bericht-Container (sehr spezifisch)
    const root =
    $('#primary .glavni__content').first().length ? $('#primary .glavni__content').first()
    : $('#main-content #primary').first().length ? $('#main-content #primary').first()
    : $('#main-content').first().length ? $('#main-content').first()
    : $('body');
 
   const headings = root.find('h5'); // ✅ die Abschnitte sind h5
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


  // 4) Secondary: Text-Fallback, wenn Headings nix liefern
  // Heuristik: wenn <2 Sections, dann ist das h2/h3 Modell vermutlich leer/ungeeignet
  if (rawSections.length < 2) {
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

    // Wenn sogar das leer ist, geben wir zumindest rawSections leer zurück – mapToBlocks fällt dann auf leer
    return { title, issuedAt, rawSections: fallbackSections };
  }

  return { title, issuedAt, rawSections };
}

// Keyword-Mapping -> feste Blocks (bleibt wie gehabt)
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

    if (!blocks.warning && (h.includes('warn') || h.includes('warning') || h.includes('avverten') || h.includes('upozor'))) {
      blocks.warning = { label: sec.label, text: sec.text };
      continue;
    }

    if (!blocks.synopsis && (
      h.includes('wetterlage') ||
      h.includes('synopsis') ||
      h.includes('situaz') ||
      h.includes('sinops') ||
      h.includes('sinop') ||
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
      (h.includes('sljede') && h.includes('12'))
    )) {
      blocks.forecast_12h = { label: sec.label, text: sec.text };
      continue;
    }

    if (!blocks.outlook_12h && (
      (h.includes('aussicht') && h.includes('12')) ||
      (h.includes('outlook') && h.includes('12')) ||
      (h.includes('tenden') && h.includes('12')) ||
      (h.includes('izgled') && h.includes('12')) ||
      (h.includes('success') && h.includes('12'))
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

  // ✅ HIER: lang in extractor geben
  const { title, issuedAt, rawSections } = extractSectionsFromHtml(html, lang);
  const blocks = mapToBlocks(rawSections);

  const existingIssuedAt = await getExistingIssuedAt(lang);

  // Wenn issuedAt fehlt, behandeln wir als update, damit wir wenigstens Inhalt haben
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
      allowOverwrite: true,
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
