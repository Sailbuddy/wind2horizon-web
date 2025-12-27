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
function safeStr(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function pickLang(lang) {
  const l = safeStr(lang).toLowerCase();
  const allowed = new Set(['de', 'en', 'it', 'fr', 'hr']);
  return allowed.has(l) ? l : 'de';
}

function asNumberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function redactKey(k) {
  if (!k) return '';
  if (k.length <= 8) return '***';
  return `${k.slice(0, 3)}…${k.slice(-3)}`;
}

// ----------------------------
// Load data for a location report
// ----------------------------
async function loadLocationBundle(supabase, locationId, lang) {
  // 1) Location + Category name (best-effort)
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

  // 2) Attribute values for requested language (plus optional 'und' fallback)
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

  // Normalize attribute label
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

  // Prefer exact language over 'und' if both exist
  const byAttr = new Map();
  for (const row of vals || []) {
    const k = String(row.attribute_id ?? '');
    if (!k) continue;

    const existing = byAttr.get(k);
    if (!existing) {
      byAttr.set(k, row);
      continue;
    }

    // If existing is 'und' and current matches desired lang -> replace
    if (existing.language_code === 'und' && row.language_code === lang) {
      byAttr.set(k, row);
    }
  }

  const attributes = Array.from(byAttr.values()).map((row) => {
    const ad = row.attribute_definitions || null;

    // Choose a single "value" representation (structured > specific > fallback)
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

  // Resolve human-facing location name/description
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
      lat: asNumberOrNull(loc.lat),
      lng: asNumberOrNull(loc.lng),
      active: !!loc.active,
      category_id: loc.category_id ?? null,
      category_name: catName || null,
      google_place_id: safeStr(loc.google_place_id) || null,
      plus_code: safeStr(loc.plus_code) || null,
      address: safeStr(loc.address) || null,
      phone: safeStr(loc.phone) || null,
      website: safeStr(loc.website) || null,
      rating: asNumberOrNull(loc.rating),
      price_level: loc.price_level ?? null,
    },
    attributes,
  };
}

// ----------------------------
// OpenAI call (no SDK dependency)
// ----------------------------
async function generateReportWithOpenAI({ apiKey, model, lang, bundle }) {
  const endpoint = 'https://api.openai.com/v1/chat/completions';

  const system = `
You are a maritime & travel assistant for Wind2Horizon.
Return ONLY valid JSON (no markdown, no commentary).
The JSON must match the schema described by the user message.
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
        // If your account/model supports JSON mode, this improves reliability:
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!res.ok) {
      // Return upstream payload for debugging (truncated)
      const snippet = text.slice(0, 2000);
      throw new Error(`OpenAI error ${res.status}: ${snippet}`);
    }

    const json = JSON.parse(text);
    const content = json?.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenAI returned no message content');

    // content should be JSON string
    const report = JSON.parse(content);

    // Minimal hardening
    if (!report || typeof report !== 'object') throw new Error('Report is not an object');
    return report;
  } finally {
    clearTimeout(t);
  }
}

// ----------------------------
// Route handlers
// ----------------------------

// Optional: GET zum Prüfen, ob Route erreichbar ist
export async function GET(req) {
  const url = new URL(req.url);
  const diag = url.searchParams.get('diag') === '1';

  return NextResponse.json({
    ok: true,
    endpoint: 'ki-report/refresh',
    method: 'GET',
    diag: !!diag,
    env: diag
      ? {
          NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY: redactKey(process.env.SUPABASE_SERVICE_ROLE_KEY),
          OPENAI_API_KEY: redactKey(process.env.OPENAI_API_KEY),
        }
      : undefined,
  });
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const location_id = Number(body.location_id);
    const lang = pickLang(body.lang || 'de');

    if (!location_id || Number.isNaN(location_id)) {
      return NextResponse.json({ ok: false, error: 'location_id missing/invalid' }, { status: 400 });
    }

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      return NextResponse.json({ ok: false, error: 'Missing OPENAI_API_KEY (server env)' }, { status: 500 });
    }

    const supabase = getServiceSupabase();

    // 1) Load location bundle
    const bundle = await loadLocationBundle(supabase, location_id, lang);
    if (!bundle.found) {
      return NextResponse.json(
        { ok: false, error: `Location ${location_id} not found`, location_id, lang },
        { status: 404 }
      );
    }

    // 2) Generate report via OpenAI
    // Model choice: keep it configurable; fallback to a reasonable default.
    const model =
      process.env.OPENAI_MODEL ||
      'gpt-4o-mini';

    const report_json = await generateReportWithOpenAI({
      apiKey: openaiKey,
      model,
      lang,
      bundle: {
        lang,
        location: bundle.location,
        attributes: bundle.attributes,
      },
    });

    // Ensure required identifiers
    report_json.lang = lang;
    report_json.location_id = location_id;
    report_json.updated_at = new Date().toISOString();

    // 3) Upsert into ai_reports
    const { data, error } = await supabase
      .from('ai_reports')
      .upsert(
        {
          location_id,
          lang,
          report_json,
          source_tag: 'openai',
        },
        { onConflict: 'location_id,lang' }
      )
      .select('id, location_id, lang, updated_at')
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      saved: true,
      generated: true,
      row: data,
      // small preview to confirm content without dumping everything
      preview: {
        title: report_json?.title || null,
        summary: report_json?.summary ? String(report_json.summary).slice(0, 220) : null,
        highlights_count: Array.isArray(report_json?.highlights) ? report_json.highlights.length : 0,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'unknown error' },
      { status: 500 }
    );
  }
}
