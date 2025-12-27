// app/api/ki-report/route.js
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Optional, aber hilfreich in Next 14+ um Fetch-Caches auszubremsen:
export const revalidate = 0;

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // server only
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY (server env)');
  return createClient(url, key, { auth: { persistSession: false } });
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
  const base = raw.split(/[-_]/)[0]; // "de-de" -> "de", "de_at" -> "de"
  const allowed = new Set(['de', 'en', 'it', 'fr', 'hr']);
  return allowed.has(base) ? base : 'de';
}

function jsonNoStore(payload, init = {}) {
  const res = NextResponse.json(payload, init);
  res.headers.set('cache-control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.headers.set('pragma', 'no-cache');
  res.headers.set('expires', '0');
  return res;
}

export async function GET(req) {
  try {
    const u = new URL(req.url);

    const diag = u.searchParams.get('diag') === '1';

    const locationIdRaw = u.searchParams.get('location_id');
    const langRaw = u.searchParams.get('lang');

    const locationId = Number(locationIdRaw || '0');
    const lang = pickLang(langRaw || 'de');

    if (!Number.isFinite(locationId) || locationId <= 0) {
      return jsonNoStore(
        { ok: false, error: 'Missing/invalid location_id', got: { location_id: locationIdRaw, lang: langRaw } },
        { status: 400 }
      );
    }

    const supabase = supabaseAdmin();

    // 1) Available languages (Debug + UI-Hilfe)
    const { data: availRows, error: availErr } = await supabase
      .from('ai_reports')
      .select('lang, updated_at')
      .eq('location_id', locationId)
      .order('updated_at', { ascending: false });

    if (availErr) {
      return jsonNoStore({ ok: false, error: `ai_reports available error: ${availErr.message}` }, { status: 500 });
    }

    const available_raw = (availRows || []).map((r) => r.lang);
    const available = available_raw.map((l) => pickLang(l)); // normalisiert für Anzeige

    // 2) Wanted language report
    const { data, error } = await supabase
      .from('ai_reports')
      .select('id, location_id, lang, report_json, created_at, updated_at, source_tag')
      .eq('location_id', locationId)
      .eq('lang', lang)
      .maybeSingle();

    if (error) {
      return jsonNoStore({ ok: false, error: error.message }, { status: 500 });
    }

    const diagPayload = diag
      ? {
          route_hit: true,
          parsed: { location_id: locationId, lang },
          raw: { location_id: locationIdRaw, lang: langRaw },
          env: {
            NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
          },
        }
      : undefined;

    if (!data) {
      return jsonNoStore(
        { ok: true, found: false, location_id: locationId, lang, available, available_raw, diag: diagPayload },
        { status: 200 }
      );
    }

    return jsonNoStore(
      {
        ok: true,
        found: true,
        location_id: data.location_id,
        lang: data.lang,
        available,
        available_raw,
        report: data.report_json,
        created_at: data.created_at,
        updated_at: data.updated_at,
        source_tag: data.source_tag || null,
        diag: diagPayload,
      },
      { status: 200 }
    );
  } catch (err) {
    return jsonNoStore({ ok: false, error: err?.message || 'unknown' }, { status: 500 });
  }
}
