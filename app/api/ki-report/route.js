// app/api/ki-report/route.js
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // server only

  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');

  return createClient(url, key, { auth: { persistSession: false } });
}

function normalizeLang(v) {
  // "de", "DE", "de-DE", "de " -> "de"
  const s = String(v || 'de').trim().toLowerCase();
  const m = s.match(/^[a-z]{2}/);
  return m ? m[0] : 'de';
}

function supabaseFingerprint() {
  // Kein Secret, nur Host-Snippet zur DB-Identifikation
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  try {
    const u = new URL(url);
    const host = u.host || '';
    // z.B. "ufebkrjjnrfhupwxvpmb.supabase.co" -> "ufebkrj...vpmb"
    const first = host.slice(0, 6);
    const last = host.slice(-4);
    return { host_hint: `${first}…${last}`, full_host: host };
  } catch {
    return { host_hint: '(invalid url)', full_host: '(invalid url)' };
  }
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const locationId = Number(url.searchParams.get('location_id') || '0');
    const lang = normalizeLang(url.searchParams.get('lang') || 'de');
    const diag = url.searchParams.get('diag') === '1';

    if (!Number.isFinite(locationId) || locationId <= 0) {
      return NextResponse.json(
        { ok: false, error: 'Missing/invalid location_id' },
        { status: 400 }
      );
    }

    const supabase = supabaseAdmin();

    // 1) Primär: exact match location_id + lang
    const { data, error } = await supabase
      .from('ai_reports')
      .select('location_id, lang, report_json, created_at, updated_at, source_tag')
      .eq('location_id', locationId)
      .eq('lang', lang)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    if (data) {
      return NextResponse.json(
        {
          ok: true,
          found: true,
          location_id: data.location_id,
          lang: data.lang,
          report: data.report_json,
          created_at: data.created_at,
          updated_at: data.updated_at,
          source_tag: data.source_tag ?? null,
          ...(diag ? { diag: { supabase: supabaseFingerprint() } } : {}),
        },
        { status: 200 }
      );
    }

    // 2) Fallback: zeige, was wir in DIESER DB für diese location_id überhaupt haben
    const { data: rows, error: e2 } = await supabase
      .from('ai_reports')
      .select('lang, updated_at, source_tag')
      .eq('location_id', locationId)
      .order('updated_at', { ascending: false })
      .limit(20);

    if (e2) {
      return NextResponse.json({ ok: false, error: e2.message }, { status: 500 });
    }

    return NextResponse.json(
      {
        ok: true,
        found: false,
        location_id: locationId,
        lang,
        available: (rows || []).map((r) => ({
          lang: r.lang,
          updated_at: r.updated_at,
          source_tag: r.source_tag ?? null,
        })),
        ...(diag ? { diag: { supabase: supabaseFingerprint() } } : {}),
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json({ ok: false, error: err?.message || 'unknown' }, { status: 500 });
  }
}
