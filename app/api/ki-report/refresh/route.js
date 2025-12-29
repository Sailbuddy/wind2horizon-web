// app/api/ki-report/refresh/route.js
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const revalidate = 0;

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

/**
 * Normalisiert "de", "DE", "de-DE", "de_AT" -> "de"
 * und lässt nur unsere erlaubten Sprachen zu.
 */
function pickLang(lang) {
  const raw = safeStr(lang).toLowerCase();
  const base = raw.split(/[-_]/)[0];
  const allowed = new Set(['de', 'en', 'it', 'fr', 'hr']);
  return allowed.has(base) ? base : 'de';
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
// Wind2Horizon KI-Report System Instruction (dein Framework)
// ----------------------------
const PROMPT_VERSION = 'ki-report-v1';

const W2H_SYSTEM_INSTRUCTION = `
SYSTEM ROLE
You are an experienced, calm, and factual location analyst writing contextual KI-Reports for the Wind2Horizon map system.

Your task is not to promote, list attractions, or reproduce encyclopedic knowledge.
Your task is to explain what a place is, what role it plays, and how it should be understood.

You write for users who value clarity, realism, and correct expectations.

CORE PRINCIPLES (MANDATORY)
- Context over completeness: Prioritize meaning and role over lists or details.
- Expectation accuracy: Never promise experiences the place cannot realistically deliver.
- Marker-specific writing: Each report must be clearly identifiable as belonging to this exact marker. If it could apply to multiple nearby places, it is invalid.
- Reduction is allowed and encouraged: Small/functional markers must remain concise.

DATA SOURCE RULES
- Structured facts come only from the provided marker data.
- Wikipedia and general knowledge may be used only as background knowledge.
- Wikipedia content must never be summarized, paraphrased, or recognizable in structure.
- No citations, no references to Wikipedia or external sources.

REQUIRED REPORT STRUCTURE
(Headings may be adapted or omitted if inappropriate)
1. Short Profile (mandatory): 1–2 sentences: What is this place? Why relevant?
2. Role / Significance (mandatory): Explain role in region; destination/transition/reference/contrast.
3. Atmosphere / Character (mandatory): Qualitative description, no marketing.
4. Personal Recommendation (mandatory, short): One concrete, realistic suggestion or limitation.

OPTIONAL MODULES (include only if meaningful)
- Visual appearance / spatial impression
- Condensed historical or cultural context
- Activities (only if genuinely available)
- Infrastructure / harbor / logistics (functional tone only)

MARKER TYPE AWARENESS
Adapt tone and depth based on marker type (city/island/hotel/harbor/lighthouse/fixpoint/warning).
Hotel reports must describe this exact hotel, not the general area.

LANGUAGE & STYLE CONSTRAINTS
Calm, precise, non-emotional, non-promotional.
No “must-see”, “perfect”, “unique experience”.
No bullet lists unless unavoidable.
Readable in ~1–2 minutes.

STRICT NO-GO RULES
Invalid if generic/interchangeable, reads like a travel guide, lists facts without interpretation,
recreates Wikipedia tone/structure, or invents details not implied by data or common knowledge.

FINAL INTENT
You are not writing information. You are providing orientation and meaning.
Wind2Horizon does not explain everything — it explains why something matters.
`.trim();

// ----------------------------
// Load data for a location report
// (dein bestehendes loadLocationBundle – leicht erweitert für Language-Fallback)
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

  // Für KI-Report: etwas mehr Kontext zulassen (lang + de + en + und)
  const wantedLangs = Array.from(new Set([lang, 'de', 'en', 'und']));

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
    .in('language_code', wantedLangs)
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

  // pro attribute_id: prefer requested lang, dann de, en, und
  const prefOrder = new Map(wantedLangs.map((l, idx) => [l, idx]));
  function rankLang(lc) {
    const k = safeStr(lc).toLowerCase();
    return prefOrder.has(k) ? prefOrder.get(k) : 999;
  }

  const byAttr = new Map();
  for (const row of vals || []) {
    const k = String(row.attribute_id ?? '');
    if (!k) continue;
    const existing = byAttr.get(k);
    if (!existing) byAttr.set(k, row);
    else {
      if (rankLang(row.language_code) < rankLang(existing.language_code)) byAttr.set(k, row);
    }
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
      show_in_infowindow: ad?.show_in_infowindow ?? null,
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
      active: loc.active !== false,
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
// Snapshot normalisieren (DB-first Input → kontrolliertes Format)
// ----------------------------
function normalizeSnapshot(bundle, lang) {
  const loc = bundle.location || {};
  const attrs = Array.isArray(bundle.attributes) ? bundle.attributes : [];

  const normAttrs = attrs
    .filter((a) => a && a.value !== null && a.value !== undefined && safeStr(a.label || a.key || '') !== '')
    .slice(0, 40) // hartes Limit, damit Prompt nicht explodiert
    .map((a) => ({
      attribute_id: a.attribute_id ?? null,
      key: a.key ?? null,
      label: safeStr(a.label) || null,
      group: a.infowindow_group || null,
      order: a.infowindow_order ?? null,
      input_type: a.input_type || null,
      language_code: a.language_code || null,
      value: a.value,
    }));

  return {
    lang,
    location: {
      id: loc.id ?? null,
      name: loc.name ?? null,
      description: loc.description ?? null,
      category_id: loc.category_id ?? null,
      category_name: loc.category_name ?? null,
      lat: loc.lat ?? null,
      lng: loc.lng ?? null,
      plus_code: loc.plus_code ?? null,
      google_place_id: loc.google_place_id ?? null,
      address: loc.address ?? null,
      phone: loc.phone ?? null,
      website: loc.website ?? null,
      rating: loc.rating ?? null,
      price_level: loc.price_level ?? null,
      active: loc.active ?? null,
    },
    attributes: normAttrs,
  };
}

// ----------------------------
// Data-Block aus Snapshot (für UI: immer anzeigen)
// ----------------------------
function buildDataBlock(snapshot) {
  const loc = snapshot?.location || {};
  return {
    category_name: safeStr(loc.category_name) || null,
    address: safeStr(loc.address) || null,
    phone: safeStr(loc.phone) || null,
    website: safeStr(loc.website) || null,
    rating: Number.isFinite(Number(loc.rating)) ? Number(loc.rating) : null,
    price_level: loc.price_level ?? null,
    plus_code: safeStr(loc.plus_code) || null,
    google_place_id: safeStr(loc.google_place_id) || null,
    lat: Number.isFinite(Number(loc.lat)) ? Number(loc.lat) : null,
    lng: Number.isFinite(Number(loc.lng)) ? Number(loc.lng) : null,
  };
}

// ----------------------------
// Quality Gate (minimal, aber wirksam)
// ----------------------------
function qualityCheck({ reportText, modules, snapshot }) {
  const problems = [];
  const t = safeStr(reportText);

  // Optional: bei sehr "kleinen" Markern kann es kürzer sein – wir behalten aber die Schwelle
  if (t.length < 500) problems.push('report_too_short');
  if (t.length > 2500) problems.push('report_too_long');

  // must include something marker-specific (name or id)
  const name = safeStr(snapshot?.location?.name);
  const id = snapshot?.location?.id;
  if (name && !t.toLowerCase().includes(name.toLowerCase())) {
    // nicht hart failen, aber als Warnung
    problems.push('missing_location_name_in_text');
  }
  if (!name && id && !t.includes(String(id))) {
    problems.push('missing_location_identifier_in_text');
  }

  // werbliche/Standardphrasen (kleiner Filter)
  const banned = ['must-see', 'perfect', 'unique experience', 'einzigartiges erlebnis', 'muss man gesehen haben'];
  const low = t.toLowerCase();
  if (banned.some((b) => low.includes(b))) problems.push('contains_promotional_phrasing');

  // Module Pflichtfelder vorhanden?
  const must = ['short_profile', 'role_significance', 'atmosphere_character', 'personal_recommendation'];
  for (const k of must) {
    if (!safeStr(modules?.[k])) problems.push(`missing_module_${k}`);
  }

  return problems;
}

// ----------------------------
// OpenAI call (Chat Completions) → ONLY {title, report_text, modules, marker_type_guess}
// - WICHTIG: "data" kommt NICHT von OpenAI, sondern ausschließlich aus DB Snapshot.
// ----------------------------
async function generateReportWithOpenAI({ apiKey, model, lang, snapshot }) {
  const endpoint = 'https://api.openai.com/v1/chat/completions';

  const system = W2H_SYSTEM_INSTRUCTION;

  const user = `
Create a Wind2Horizon "KI-Report" for exactly this marker.

Return ONLY valid JSON (no markdown, no commentary).
Output language MUST be: ${lang}

Return JSON with this schema:
{
  "title": "<string>",
  "marker_type_guess": "<string|null>",
  "modules": {
    "short_profile": "<1-2 sentences>",
    "role_significance": "<short paragraph>",
    "atmosphere_character": "<short paragraph>",
    "personal_recommendation": "<1 short paragraph or 1-2 sentences>",
    "optional": {
      "visual_spatial_impression": "<string|null>",
      "condensed_history_context": "<string|null>",
      "activities_if_real": "<string|null>",
      "infrastructure_logistics": "<string|null>"
    }
  },
  "report_text": "<single cohesive text, ~1-2 minutes reading, calm factual tone, no lists unless unavoidable>"
}

Rules:
- Use ONLY the provided marker data as factual basis. Do NOT invent details.
- General knowledge may inform interpretation, but do not reference sources and do not mimic Wikipedia.
- No marketing language. No travel-guide tone. No generic filler.
- The report must be clearly identifiable as this exact marker; avoid text that could fit multiple nearby places.
- Modules are required (except optional.*), but may be concise for functional markers.

Marker data (DB snapshot):
${JSON.stringify(snapshot, null, 2)}
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
        temperature: 0.35,
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

    const out = JSON.parse(content);
    if (!out || typeof out !== 'object') throw new Error('Report JSON is not an object');

    const title = safeStr(out.title);
    const report_text = safeStr(out.report_text);

    if (!report_text) throw new Error('OpenAI output missing report_text');

    return {
      title: title || null,
      marker_type_guess: out.marker_type_guess ?? null,
      modules: out.modules || null,
      report_text,
    };
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
    method: 'POST',
    prompt_version: PROMPT_VERSION,
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

    const force = asBool(body.force);
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

    // Cache-hit (WICHTIG: report zurückgeben)
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

    // 1) Load DB bundle (DB-first)
    const bundle = await loadLocationBundle(supabase, location_id, lang);
    if (!bundle.found) {
      return jsonNoStore({ ok: false, error: `Location ${location_id} not found`, location_id, lang }, { status: 404 });
    }

    // 2) Normalize snapshot (DB-first truth)
    const snapshot = normalizeSnapshot(bundle, lang);

    // 3) Generate with OpenAI
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const out = await generateReportWithOpenAI({
      apiKey: openaiKey,
      model,
      lang,
      snapshot,
    });

    // 4) Enforce our final stored format:
    // - data: ALWAYS from DB snapshot
    // - report_text/modules/title: from OpenAI
    const dataBlock = buildDataBlock(snapshot);

    const modules = out.modules || {};
    const report_json = {
      lang,
      location_id,
      title: safeStr(out.title) || safeStr(snapshot?.location?.name) || `Location #${location_id}`,
      marker_type_guess: out.marker_type_guess ?? null,

      // DB-first deterministic block (UI soll diesen Teil bevorzugt mögen)
      data: dataBlock,

      // OpenAI meaning layer
      modules: {
        short_profile: safeStr(modules?.short_profile),
        role_significance: safeStr(modules?.role_significance),
        atmosphere_character: safeStr(modules?.atmosphere_character),
        personal_recommendation: safeStr(modules?.personal_recommendation),
        optional: {
          visual_spatial_impression: safeStr(modules?.optional?.visual_spatial_impression) || null,
          condensed_history_context: safeStr(modules?.optional?.condensed_history_context) || null,
          activities_if_real: safeStr(modules?.optional?.activities_if_real) || null,
          infrastructure_logistics: safeStr(modules?.optional?.infrastructure_logistics) || null,
        },
      },
      report_text: safeStr(out.report_text),

      meta: {
        prompt_version: PROMPT_VERSION,
        model,
        generated_at: new Date().toISOString(),
        source_tag: 'openai',
        source_snapshot: snapshot, // Audit/Debug: genau das DB-Input-Snapshot
      },
    };

    // 5) Quality gate
    const problems = qualityCheck({
      reportText: report_json.report_text,
      modules: report_json.modules,
      snapshot,
    });

    // Hard fail only on critical issues
    const critical = problems.filter((p) => p.startsWith('missing_module_') || p === 'report_too_short');
    if (critical.length) {
      return jsonNoStore(
        {
          ok: false,
          error: 'quality_check_failed',
          critical,
          problems,
          location_id,
          lang,
          preview: report_json.report_text ? report_json.report_text.slice(0, 240) : null,
        },
        { status: 422 }
      );
    }

    // 6) Upsert stored report
    const { data: row, error } = await supabase
      .from('ai_reports')
      .upsert(
        { location_id, lang, report_json, source_tag: 'openai' },
        { onConflict: 'location_id,lang' }
      )
      .select('id, location_id, lang, updated_at, created_at, source_tag')
      .single();

    if (error) return jsonNoStore({ ok: false, error: error.message }, { status: 500 });

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
      warnings: problems.filter((p) => !critical.includes(p)),
      preview: {
        title: report_json.title?.slice(0, 120) || null,
        short_profile: report_json.modules.short_profile?.slice(0, 220) || null,
        report_text: report_json.report_text?.slice(0, 220) || null,
      },
    });
  } catch (err) {
    return jsonNoStore({ ok: false, error: err?.message || 'unknown error' }, { status: 500 });
  }
}
