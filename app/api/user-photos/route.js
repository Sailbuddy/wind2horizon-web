// app/api/user-photos/route.js
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ---- Env: URLs/Keys ---------------------------------------------------------
const SUPA_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL

// Für READ reicht anon (wenn RLS-Select erlaubt ist)
const SUPA_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY // fallback

// Für WRITE/UPDATE bevorzugt Service-Role-Key (server-side only!)
const SUPA_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY // optional fallback name

function badEnvRead() {
  return !SUPA_URL || !SUPA_ANON_KEY
}
function badEnvWrite() {
  // Für Updates brauchen wir idealerweise den Service-Key
  return !SUPA_URL || !SUPA_SERVICE_KEY
}

function supaRead() {
  return createClient(SUPA_URL, SUPA_ANON_KEY, { auth: { persistSession: false } })
}
function supaWrite() {
  return createClient(SUPA_URL, SUPA_SERVICE_KEY, { auth: { persistSession: false } })
}

// ---- GET /api/user-photos?ids=1,2,3 ----------------------------------------
export async function GET(req) {
  try {
    if (badEnvRead()) {
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
      return NextResponse.json({ ok: true, rows: [], items: {} }, { status: 200 })
    }

    const supabase = supaRead()

    const { data, error } = await supabase
      .from('user_photos')
      .select('id, location_id, public_url, width, height, caption, author, preferred_width')
      .in('location_id', ids)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    // Zusätzlich ein Map-Format bereitstellen: { [location_id]: Photo[] }
    const items = {}
    for (const r of data || []) {
      if (!items[r.location_id]) items[r.location_id] = []
      items[r.location_id].push({
        id: r.id,
        public_url: r.public_url,
        width: r.width,
        height: r.height,
        caption: r.caption,
        author: r.author,
        preferred_width: r.preferred_width ?? null,
      })
    }

    return NextResponse.json({ ok: true, rows: data || [], items }, { status: 200 })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'unknown error' },
      { status: 500 }
    )
  }
}

// ---- POST /api/user-photos --------------------------------------------------
// Body: { action: "update", id: number, caption?: string|null, author?: string|null, preferred_width?: number|null }
export async function POST(req) {
  try {
    if (badEnvWrite()) {
      return NextResponse.json(
        { ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY on server' },
        { status: 500 }
      )
    }

    const body = await req.json()
    if (!body || body.action !== 'update') {
      return NextResponse.json(
        { ok: false, error: 'unknown or missing action' },
        { status: 400 }
      )
    }

    const { id, caption, author, preferred_width } = body
    if (!id) {
      return NextResponse.json(
        { ok: false, error: 'missing id' },
        { status: 400 }
      )
    }

    const patch = {}
    if (caption !== undefined) patch.caption = caption
    if (author !== undefined) patch.author = author
    if (preferred_width !== undefined) patch.preferred_width = preferred_width

    if (!Object.keys(patch).length) {
      return NextResponse.json({ ok: true }) // nichts zu tun
    }

    const supabase = supaWrite()
    const { error } = await supabase
      .from('user_photos')
      .update(patch)
      .eq('id', id)

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'unknown error' },
      { status: 500 }
    )
  }
}
