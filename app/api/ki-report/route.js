// app/api/ki-report/route.js
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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

function pickLang(lang) {
  const l = safeStr(lang).toLowerCase();
  const allowed = new Set(['de', 'en', 'it', 'fr', 'hr']);
  return allowed.has(l) ? l : 'de';
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const locationId = Number(url.searchParams.get('location_id') || '0');
    const lang = pickLang(url.searchParams.get('lang') || 'de');

    if (!Number.isFinite(locationId) || locationId <= 0) {
      return NextResponse.json(
        { ok: false, error: 'Missing/invalid location_id' },
        { status: 400 }
      );
    }

    const supabase = supabaseAdmin();

    const { data, error } = await supabase
      .from('ai_reports')
      .select('location_id, lang, report_json, created_at, updated_at')
      .eq('location_id', locationId)
      .eq('lang', lang)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json(
        { ok: true, found: false, location_id: locationId, lang },
        { status: 200 }
      );
    }

    // Optional: kompatibel zu beiden Varianten (report_json oder report)
    const report = data.report_json ?? null;

    // Optional: ein paar Metadaten fürs UI (z.B. "wie alt ist der Report")
    const updatedMs = data.updated_at ? Date.parse(data.updated_at) : NaN;
    const age_seconds = Number.isFinite(updatedMs)
      ? Math.max(0, Math.floor((Date.now() - updatedMs) / 1000))
      : null;

    return NextResponse.json(
      {
        ok: true,
        found: true,
        location_id: data.location_id,
        lang: data.lang,
        report,
        created_at: data.created_at,
        updated_at: data.updated_at,
        meta: {
          age_seconds,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'unknown' },
      { status: 500 }
    );
  }
}
