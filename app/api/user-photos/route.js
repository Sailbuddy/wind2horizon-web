// app/api/user-photos/route.js
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Env: nimm was da ist (anon reicht für SELECT, wenn RLS lesen erlaubt)
const SUPA_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL

const SUPA_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY

// Fallback-Schutz
function badEnv() {
  return !SUPA_URL || !SUPA_KEY
}

/** GET /api/user-photos?ids=1,2,3 */
export async function GET(req) {
  try {
    if (badEnv()) {
      return NextResponse.json(
        { ok: false, error: 'Missing SUPABASE_URL / ANON_KEY on server' },
        { status: 500 }
      )
    }

    const url = new URL(req.url)
    const idsParam = url.searchParams.get('ids') || ''
    const ids = idsParam
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isFinite(n))

    if (!ids.length) {
      return NextResponse.json({ ok: true, rows: [] }, { status: 200 })
    }

    const supabase = createClient(SUPA_URL, SUPA_KEY)

    const { data, error } = await supabase
      .from('user_photos')
      .select('location_id, public_url, width, height, caption, author')
      .in('location_id', ids)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, rows: data || [] }, { status: 200 })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'unknown error' },
      { status: 500 }
    )
  }
}
