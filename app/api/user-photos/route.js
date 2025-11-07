// app/api/user-photos/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPA_URL =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL || ''

const SUPA_KEY =
  process.env.SUPABASE_ANON_KEY ||               // wenn gesetzt
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||   // alternativ
  process.env.VITE_SUPABASE_ANON_KEY || ''       // alternativ

const supabase = createClient(SUPA_URL, SUPA_KEY) // SELECT ist per RLS public erlaubt

export async function GET(req: Request) {
  const url = new URL(req.url)
  const idsParam = url.searchParams.get('ids') || ''
  const ids = idsParam.split(',')
    .map(s => Number(s.trim()))
    .filter(n => Number.isFinite(n))

  if (!ids.length) {
    return NextResponse.json({ ok:false, error:'Query param "ids" missing' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('user_photos')
    .select('location_id, public_url, width, height, caption, author')
    .in('location_id', ids)
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ ok:false, error: error.message }, { status: 500 })
  }

  // Gruppieren je Location + Thumb/Full-URLs via Image Transform
  const grouped: Record<number, any[]> = {}
  for (const r of data || []) {
    (grouped[r.location_id] ||= []).push({
      url: `${r.public_url}?width=1600`,
      thumb: `${r.public_url}?width=400`,
      w: r.width ?? null,
      h: r.height ?? null,
      caption: r.caption ?? null,
      author: r.author ?? null,
      source: 'user',
    })
  }

  return NextResponse.json(
    { ok:true, items: grouped },
    { headers: { 'cache-control': 'public, max-age=60' } } // 1 min Cache
  )
}
