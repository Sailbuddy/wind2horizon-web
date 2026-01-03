// app/api/user-photos/route.js
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ---- Env: URLs/Keys ---------------------------------------------------------
const SUPA_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL

// Für READ reicht anon (wenn RLS-Select erlaubt ist) – wir bevorzugen aber serverseitig Service-Role, falls vorhanden
const SUPA_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY // fallback

// Für WRITE/UPDATE bevorzugt Service-Role-Key (server-side only!)
const SUPA_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY // optional fallback name

function badEnvRead() {
  // Read geht, wenn URL + (Service ODER Anon) vorhanden
  return !SUPA_URL || !(SUPA_SERVICE_KEY || SUPA_ANON_KEY)
}

function badEnvWrite() {
  // Für Updates brauchen wir idealerweise den Service-Key
  return !SUPA_URL || !SUPA_SERVICE_KEY
}

function supaRead() {
  // Serverseitig Service-Role bevorzugen -> robust gegen RLS-Select-Probleme
  const key = SUPA_SERVICE_KEY || SUPA_ANON_KEY
  return createClient(SUPA_URL, key, { auth: { persistSession: false } })
}

function supaWrite() {
  return createClient(SUPA_URL, SUPA_SERVICE_KEY, { auth: { persistSession: false } })
}

// ---- GET /api/user-photos?location_ids=2030,2031  (alias: ?ids=...) ---------
export async function GET(req) {
  try {
    if (badEnvRead()) {
      return NextResponse.json(
        { ok: false, error: 'Missing SUPABASE_URL and (SUPABASE_SERVICE_ROLE_KEY or ANON_KEY) on server' },
        { status: 500 }
      )
    }

    const url = new URL(req.url)

    // prefer explicit name, keep ids as backward-compatible fallback
    const idsParam =
      url.searchParams.get('location_ids') ||
      url.searchParams.get('ids') ||
      ''

    const locationIds = idsParam
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => Number.isFinite(n))

    if (!locationIds.length) {
      return NextResponse.json({ ok: true, rows: [], items: {} }, { status: 200 })
    }

    const supabase = supaRead()

    const { data, error } = await supabase
      .from('user_photos')
      .select('id, location_id, storage_path, public_url, width, height, author, caption, source_tag, created_at, preferred_width')
      .in('location_id', locationIds)
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
        location_id: r.location_id,
        storage_path: r.storage_path ?? null,
        public_url: r.public_url ?? null,
        url: r.public_url ?? null, // alias for UI compatibility
        width: r.width ?? null,
        height: r.height ?? null,
        caption: r.caption ?? null,
        author: r.author ?? null,
        source_tag: r.source_tag ?? null,
        created_at: r.created_at ?? null,
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
