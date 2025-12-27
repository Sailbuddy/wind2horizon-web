// app/api/ki-report/refresh/route.js
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ----------------------------
// Supabase (Service Role) client
// ----------------------------
function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // server-only
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY (server env)');
  return createClient(url, key, { auth: { persistSession: false } });
}

// ----------------------------
// Helpers
// ----------------------------
function jsonNoStore(payload, init = {}) {
  const res = NextResponse.json(payload, init);
  res.headers.set('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.headers.set('pragma', 'no-cache');
  return res;
}

function safeStr(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function pickLang(lang) {
  const l = safeStr(lang).toLowerCase();
  const allowed = new Set(['de', 'en', 'it', 'fr', 'hr']);
  return allowed.has(l) ? l : 'de';
}

function asBool(v) {
  if (typeof v === 'boolean') return v;
  const s = safeStr(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'y';
}

function parseHours(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function isFresh(updatedAt, ttlHours) {
  if (!updatedAt) return false;
  const t = new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return false;
  const ageMs = Date.now() - t;
  return ageMs >= 0 && ageMs <= ttlHours * 3600 * 1000;
}

function redactKey(k) {
  if (!k) return '';
  if (k.length <= 8) return '***';
  return `${k.slice(0, 3)}…${k.slice(-3)}`;
}

// ----------------------------
// Load data for a location report
// (dein bestehendes loadLocationBundle unverändert übernehmen)
// ----------------------------
async function loadLocationBundle(supabase, locationId, lang) {
  const { data: loc, error: locErr } = await supabase
    .from('locations')
    .select(
      `
      id,
      lat, lng,
      category_id,
      active,
      display_name,
      google_place_id,
      plus_code,
      address,
      phone,
      website,
      rating,
      price_level,
      name_de, name_en, name_it, name_fr, name_hr,
      description_de, description_en, description_it, description_fr, description_hr,
      categories:categories (
        id,
        google_cat_id,
        name_de, name_en, name_it, name_fr, name_hr
      )
    `
    )
    .eq('id', locationId)
    .maybeSingle();

  if (locErr) throw new Error(`Supabase locations error: ${locErr.message}`);
  if (!loc) return { found: false };

  const { data: vals, error: valsErr } = await supabase
    .from('location_values')
    .select(
      `
      location_id,
      attribute_id,
      language_code,
      value_text,
      value_number,
      value_option,
      value_bool,
      value_json,
      name,
      attribute_definitions:attribute_definitions (
        attribute_id,
        key,
        input_type,
        options,
        multilingual,
        name_de, name_en, name_it, name_fr, name_hr,
        sort_order,
        show_in_infowindow,
        infowindow_group,
        infowindow_order,
        display_format
      )
    `
    )
    .eq('location_id', locationId)
    .in('language_code', [lang, 'und'])
    .order('attribute_id', { ascending: true });

  if (valsErr) throw new Error(`Supabase location_values error: ${valsErr.message}`);

  const labelFor = (ad) => {
    if (!ad) return '';
    return (
      (lang === 'de' && ad.name_de) ||
      (lang === 'en' && ad.name_en) ||
      (lang === 'it' && ad.name_it) ||
      (lang === 'fr' && ad.name_fr) ||
      (lang === 'hr' && ad.name_hr) ||
      ad.name_de ||
      ad.name_en ||
      ad.key ||
      ''
    );
  };

  const byAttr = new Map();
  for (const row of vals || []) {
    const k = String(row.attribute_id ?? '');
    if (!k) continue;
    const existing = byAttr.get(k);
    if (!existing) byAttr.set(k, row);
    else if (existing.language_code === 'und' && row.language_code === lang) byAttr.set(k, row);
  }

  const attributes = Array.from(byAttr.values()).map((row) => {
    const ad = row.attribute_definitions || null;

    let value = null;
    if (row.value_json !== null && row.value_json !== undefined) value = row.value_json;
    else if (row.value_text !== null && row.value_text !== undefined) value = row.value_text;
    else if (row.value_number !== null && row.value_number !== undefined) value = row.value_number;
    else if (row.value_option !== null && row.value_option !== undefined) value = row.value_option;
    else if (row.value_bool !== null && row.value_bool !== undefined) value = row.value_bool;

    return {
      attribute_id: row.attribute_id,
      key: ad?.key || null,
      label: labelFor(ad),
      language_code: row.language_code,
      input_type: ad?.input_type || null,
      display_format: ad?.display_format || null,
      show_in_infowindow: !!ad?.show_in_infowindow,
      infowindow_group: ad?.infowindow_group || null,
      infowindow_order: ad?.infowindow_order ?? null,
      value,
    };
  });

  const locName =
    safeStr(loc.display_name) ||
    (lang === 'de' && safeStr(loc.name_de)) ||
    (lang === 'en' && safeStr(loc.name_en)) ||
    (lang === 'it' && safeStr(loc.name_it)) ||
    (lang === 'fr' && safeStr(loc.name_fr)) ||
    (lang === 'hr' && safeStr(loc.name_hr)) ||
    safeStr(loc.name_de) ||
    safeStr(loc.name_en) ||
    `Location #${loc.id}`;

  const locDesc =
    (lang === 'de' && safeStr(loc.description_de)) ||
    (lang === 'en' && safeStr(loc.description_en)) ||
    (lang === 'it' && safeStr(loc.description_it)) ||
    (lang === 'fr' && safeStr(loc.description_fr)) ||
    (lang === 'hr' && safeStr(loc.description_hr)) ||
    safeStr(loc.description_de) ||
    safeStr(loc.description_en) ||
    '';

  const cat = loc.categories || null;
  const catName =
    cat &&
    ((
      (lang === 'de' && safeStr(cat.name_de)) ||
      (lang === 'en' && safeStr(cat.name_en)) ||
      (lang === 'it' && safeStr(cat.name_it)) ||
      (lang === 'fr' && safeStr(cat.name_fr)) ||
      (lang === 'hr' && safeStr(cat.name_hr)) ||
      safeStr(cat.name_de) ||
      safeStr(cat.name_en)
    ) || '');

  return {
    found: true,
    location: {
      id: loc.id,
      name: locName,
      description: locDesc,
      lat: Number.isFinite(Number(loc.lat)) ? Number(loc.lat) : null,
      lng: Number.isFinite(Number(loc.lng)) ? Number(loc.lng) : null,
      active: !!loc.active,
      category_id: loc.category_id ?? null,
      category_name: catName || null,
      google_place_id: safeStr(loc.google_place_id) || null,
      plus_code: safeStr(loc.plus_code) || null,
      address: safeStr(loc.address) || null,
      phone: safeStr(loc.phone) || null,
      website: safeStr(loc.website) || null,
      rating: Number.isFinite(Number(loc.rating)) ? Number(loc.rating) : null,
      price_level: loc.price_level ?? null,
    },
    attributes,
  };
}

// ----------------------------
// OpenAI call
// ----------------------------
async function generateReportWithOpenAI({ apiKey, model, lang, bundle }) {
  const endpoint = 'https://api.openai.com/v1/chat/completions';

  const system = `
You are a maritime & travel assistant for Wind2Horizon.
Return ONLY valid JSON (no markdown, no commentary).
Language must be: ${lang}.
`.trim();

  const user = `
Create a concise "KI-Report" for a map location.

Return JSON with this schema:
{
  "lang": "<${lang}>",
  "location_id": <number>,
  "title": "<string>",
  "summary": "<string: 2-5 sentences>",
  "highlights": ["<bullet>", "... up to 6"],
  "practical_info": {
    "address": "<string|null>",
    "phone": "<string|null>",
    "website": "<string|null>",
    "rating": <number|null>,
    "price_level": <number|null>
  },
  "attributes": [
    { "label": "<string>", "value": <string|number|boolean|object|null> }
  ],
  "safety_notes": ["<bullet>", "... up to 5"],
  "updated_at": "<ISO timestamp>"
}

Rules:
- Use provided location data; do NOT invent unknown details.
- If something is missing, set it to null or omit bullet items.
- For "attributes": include ONLY attributes where value is not null/empty; keep it short (max 15).
- "safety_notes": only if relevant; otherwise empty array.

Input data:
${JSON.stringify(bundle, null, 2)}
`.trim();

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 45_000);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${text.slice(0, 2000)}`);

    const json = JSON.parse(text);
    const content = json?.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenAI returned no message content');

    const report = JSON.parse(content);
    if (!report || typeof report !== 'object') throw new Error('Report is not an object');
    return report;
  } finally {
    clearTimeout(t);
  }
}

// ----------------------------
// Handlers
// ----------------------------
export async function GET(req) {
  const url = new URL(req.url);
  const diag = url.searchParams.get('diag') === '1';

  return jsonNoStore({
    ok: true,
    endpoint: 'ki-report/refresh',
    method: 'GET',
    env: diag
      ? {
          NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY: redactKey(process.env.SUPABASE_SERVICE_ROLE_KEY),
          OPENAI_API_KEY: redactKey(process.env.OPENAI_API_KEY),
          OPENAI_MODEL: process.env.OPENAI_MODEL || null,
          KI_REPORT_TTL_HOURS: process.env.KI_REPORT_TTL_HOURS || null,
        }
      : undefined,
  });
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const location_id = Number(body.location_id);
    const lang = pickLang(body.lang || 'de');

    const force = asBool(body.force); // UI kann force=true schicken
    const ttlHours = parseHours(process.env.KI_REPORT_TTL_HOURS, 168);

    if (!location_id || Number.isNaN(location_id)) {
      return jsonNoStore({ ok: false, error: 'location_id missing/invalid' }, { status: 400 });
    }

    const supabase = getServiceSupabase();

    // 0) existing?
    const { data: existing, error: exErr } = await supabase
      .from('ai_reports')
      .select('id, location_id, lang, report_json, updated_at, created_at, source_tag')
      .eq('location_id', location_id)
      .eq('lang', lang)
      .maybeSingle();

    if (exErr) {
      return jsonNoStore({ ok: false, error: `Supabase ai_reports error: ${exErr.message}` }, { status: 500 });
    }

    const fresh = existing && isFresh(existing.updated_at, ttlHours);

    // Cache-hit => WICHTIG: report zurückgeben
    if (existing && fresh && !force) {
      return jsonNoStore({
        ok: true,
        used_openai: false,
        cache_hit: true,
        ttl_hours: ttlHours,
        location_id,
        lang,
        report: existing.report_json,
        report_meta: {
          id: existing.id,
          updated_at: existing.updated_at,
          created_at: existing.created_at,
          source_tag: existing.source_tag || null,
        },
      });
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return jsonNoStore({ ok: false, error: 'Missing OPENAI_API_KEY (server env)' }, { status: 500 });
    }

    // 1) Load bundle
    const bundle = await loadLocationBundle(supabase, location_id, lang);
    if (!bundle.found) {
      return jsonNoStore({ ok: false, error: `Location ${location_id} not found`, location_id, lang }, { status: 404 });
    }

    // 2) Generate
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const report_json = await generateReportWithOpenAI({
      apiKey: openaiKey,
      model,
      lang,
      bundle: { lang, location: bundle.location, attributes: bundle.attributes },
    });

    report_json.lang = lang;
    report_json.location_id = location_id;
    report_json.updated_at = new Date().toISOString();

    // 3) Upsert
    const { data: row, error } = await supabase
      .from('ai_reports')
      .upsert(
        { location_id, lang, report_json, source_tag: 'openai' },
        { onConflict: 'location_id,lang' }
      )
      .select('id, location_id, lang, updated_at, created_at, source_tag')
      .single();

    if (error) return jsonNoStore({ ok: false, error: error.message }, { status: 500 });

    // WICHTIG: report zurückgeben, damit UI sofort aktualisieren kann
    return jsonNoStore({
      ok: true,
      used_openai: true,
      cache_hit: false,
      forced: force,
      ttl_hours: ttlHours,
      location_id,
      lang,
      report: report_json,
      report_meta: {
        id: row.id,
        updated_at: row.updated_at,
        created_at: row.created_at,
        source_tag: row.source_tag || 'openai',
      },
      preview: {
        title: report_json?.title || null,
        summary: report_json?.summary ? String(report_json.summary).slice(0, 220) : null,
      },
    });
  } catch (err) {
    return jsonNoStore({ ok: false, error: err?.message || 'unknown error' }, { status: 500 });
  }
}
