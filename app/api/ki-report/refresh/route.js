import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function getServiceSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY; // server-only

  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY (server env)');

  return createClient(url, key, { auth: { persistSession: false } });
}

// Optional: GET zum Prüfen, ob Route erreichbar ist
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'ki-report/refresh', method: 'GET' });
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const location_id = Number(body.location_id);
    const lang = String(body.lang || 'de');

    if (!location_id || Number.isNaN(location_id)) {
      return NextResponse.json({ ok: false, error: 'location_id missing/invalid' }, { status: 400 });
    }

    const supabase = getServiceSupabase();

    // Nur Test: upsert “leeren” Report, damit wir DB+Unique-Constraint testen
    const report_json = { status: 'stub', location_id, lang, updated_at: new Date().toISOString() };

    const { data, error } = await supabase
      .from('ai_reports')
      .upsert(
        { location_id, lang, report_json, source_tag: 'openai' },
        { onConflict: 'location_id,lang' }
      )
      .select('id, location_id, lang, updated_at')
      .single();

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, saved: true, row: data });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'unknown error' },
      { status: 500 }
    );
  }
}
