// app/api/ki-report/route.js
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ----------------------------
// Supabase (Service Role) client
// ----------------------------
function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // server only

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

function normLang(v) {
  return safeStr(v).toLowerCase();
}

function supabaseUrlInfo() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  try {
    const u = new URL(raw);
    // typischer Host: <projectref>.supabase.co
    const host = u.host || '';
    const projectRef = host.split('.')[0] || null;
    return { host, projectRef };
  } catch {
    return { host: null, projectRef: null };
  }
}

function jsonNoStore(payload, init = {}) {
  const res = NextResponse.json(payload, init);
  res.headers.set('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
  return res;
}

// ----------------------------
// GET /api/ki-report?location_id=...&lang=...&diag=1
// ----------------------------
export async function GET(req) {
  try {
    const u = new URL(req.url);
    const diag = u.searchParams.get('diag') === '1';

    const locationIdRaw = u.searchParams.get('location_id');
    const langRaw = u.searchParams.get('lang');

    const locationId = Number(locationIdRaw || '0');
    const lang = pickLang(langRaw || 'de');
    const want = normLang(lang);

    if (!Number.isFinite(locationId) || locationId <= 0) {
      return jsonNoStore(
        { ok: false, error: 'Missing/invalid location_id', got: { location_id: locationIdRaw, lang: langRaw } },
        { status: 400 }
      );
    }

    const supabase = supabaseAdmin();

    // 1) Alle Reports für location_id laden (damit wir Diagnose + robustes Matching haben)
    const { data: rows, error: rowsErr } = await supabase
      .from('ai_reports')
      .select('id, location_id, lang, report_json, created_at, updated_at, source_tag')
      .eq('location_id', locationId)
      .order('updated_at', { ascending: false });

    if (rowsErr) {
      return jsonNoStore({ ok: false, error: rowsErr.message }, { status: 500 });
    }

    const available_raw = (rows || []).map((r) => r.lang);
    const available = Array.from(new Set((rows || []).map((r) => normLang(r.lang)).filter(Boolean)));

    // Robust: match via normalisiertem Lang
    const match = (rows || []).find((r) => normLang(r.lang) === want) || null;

    const diagPayload = diag
      ? {
          route_hit: true,
          parsed: { location_id: locationId, lang, want },
          raw: { location_id: locationIdRaw, lang: langRaw },
          env: {
            NEXT_PUBLIC_SUPABASE_URL_set: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY_set: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
          },
          supabase: supabaseUrlInfo(), // host + projectRef (ohne secrets)
          db: {
            rows_count: (rows || []).length,
            rows: (rows || []).map((r) => ({
              id: r.id,
              lang: r.lang,
              lang_norm: normLang(r.lang),
              updated_at: r.updated_at,
              source_tag: r.source_tag || null,
            })),
          },
        }
      : undefined;

    if (!match) {
      return jsonNoStore(
        { ok: true, found: false, location_id: locationId, lang, available, available_raw, diag: diagPayload },
        { status: 200 }
      );
    }

    return jsonNoStore(
      {
        ok: true,
        found: true,
        location_id: match.location_id,
        lang: normLang(match.lang),
        available,
        available_raw,
        report: match.report_json,
        created_at: match.created_at,
        updated_at: match.updated_at,
        source_tag: match.source_tag || null,
        diag: diagPayload,
      },
      { status: 200 }
    );
  } catch (err) {
    return jsonNoStore({ ok: false, error: err?.message || 'unknown' }, { status: 500 });
  }
}
