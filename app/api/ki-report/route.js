// app/api/ki-report/route.js
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // wichtig: server only
  if (!url || !key) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const locationId = Number(url.searchParams.get('location_id') || '0');
    const lang = (url.searchParams.get('lang') || 'de').toLowerCase();

    if (!Number.isFinite(locationId) || locationId <= 0) {
      return NextResponse.json({ ok: false, error: 'Missing/invalid location_id' }, { status: 400 });
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
      return NextResponse.json({ ok: true, found: false, location_id: locationId, lang }, { status: 200 });
    }

    return NextResponse.json(
      { ok: true, found: true, location_id: data.location_id, lang: data.lang, report: data.report_json, created_at: data.created_at, updated_at: data.updated_at },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json({ ok: false, error: err?.message || 'unknown' }, { status: 500 });
  }
}
