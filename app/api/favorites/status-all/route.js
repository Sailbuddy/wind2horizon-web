import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { resolveActiveCollectionId, createSupabaseAdminClient } from '@/lib/server/favorites/resolveActiveCollectionId';

function getTokenFromRequest(req) {
  const auth = req.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

function parseCollectionId(raw) {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export async function GET(req) {
  try {
    const token = getTokenFromRequest(req);

    if (!token) {
      return NextResponse.json(
        {
          authenticated: false,
          collectionId: null,
          resolvedVia: 'none',
          favoriteLocationIds: [],
        },
        { status: 200 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    // 🔐 User-Client (wie bisher)
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        {
          authenticated: false,
          collectionId: null,
          resolvedVia: 'none',
          favoriteLocationIds: [],
        },
        { status: 200 }
      );
    }

    const userId = user.id;

    // 🔧 NEU: collectionId aus Query
    const requestedCollectionId = parseCollectionId(
      new URL(req.url).searchParams.get('collectionId')
    );

    const supabaseAdmin = createSupabaseAdminClient();

    let resolvedCollectionId = null;
    let resolvedVia = 'none';

    // -----------------------------------------
    // Fall A: explizite collectionId
    // -----------------------------------------
    if (requestedCollectionId != null) {
      const { data: ownedCollection, error } = await supabaseAdmin
        .from('favorite_collections')
        .select('id')
        .eq('id', requestedCollectionId)
        .eq('owner_user_id', userId)
        .maybeSingle();

      if (error) {
        return NextResponse.json(
          { error: error.message, favoriteLocationIds: [] },
          { status: 500 }
        );
      }

      if (!ownedCollection?.id) {
        return NextResponse.json(
          {
            authenticated: true,
            collectionId: null,
            resolvedVia: 'none',
            favoriteLocationIds: [],
            error: 'Collection not owned by user',
          },
          { status: 403 }
        );
      }

      resolvedCollectionId = Number(ownedCollection.id);
      resolvedVia = 'explicit';
    }

    // -----------------------------------------
    // Fall B: activeCollectionId Resolver
    // -----------------------------------------
    else {
      const resolved = await resolveActiveCollectionId(
        supabaseAdmin,
        userId
      );

      resolvedCollectionId = resolved.activeCollectionId;
      resolvedVia =
        resolved.activeCollectionId != null ? 'active' : 'none';
    }

    // -----------------------------------------
    // Kein Ergebnis → leere Liste
    // -----------------------------------------
    if (!resolvedCollectionId) {
      return NextResponse.json(
        {
          authenticated: true,
          collectionId: null,
          resolvedVia,
          favoriteLocationIds: [],
        },
        { status: 200 }
      );
    }

    // -----------------------------------------
    // Favoriten laden (wie bisher)
    // -----------------------------------------
    const { data: items, error: itemError } = await supabase
      .from('favorite_collection_items')
      .select('location_id')
      .eq('collection_id', resolvedCollectionId)
      .eq('status', 'saved');

    if (itemError) {
      return NextResponse.json(
        { error: itemError.message, favoriteLocationIds: [] },
        { status: 500 }
      );
    }

    const favoriteLocationIds = (items || [])
      .map((row) => Number(row.location_id))
      .filter(Number.isFinite);

    return NextResponse.json(
      {
        authenticated: true,
        collectionId: resolvedCollectionId,
        resolvedVia,
        favoriteLocationIds,
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: String(err?.message || err),
        collectionId: null,
        resolvedVia: 'none',
        favoriteLocationIds: [],
      },
      { status: 500 }
    );
  }
}