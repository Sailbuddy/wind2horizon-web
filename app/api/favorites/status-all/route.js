import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getTokenFromRequest(req) {
  const auth = req.headers.get('authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export async function GET(req) {
  try {
    const token = getTokenFromRequest(req);

    if (!token) {
      return NextResponse.json(
        { authenticated: false, favoriteLocationIds: [] },
        { status: 200 }
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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
        { authenticated: false, favoriteLocationIds: [] },
        { status: 200 }
      );
    }

    const { data: collections, error: colError } = await supabase
      .from('favorite_collections')
      .select('id, is_default, collection_type')
      .eq('user_id', user.id);

    if (colError) {
      return NextResponse.json(
        { error: colError.message, favoriteLocationIds: [] },
        { status: 500 }
      );
    }

    const targetCollection =
      collections?.find((c) => c?.is_default) ||
      collections?.find((c) => c?.collection_type === 'favorites') ||
      null;

    if (!targetCollection?.id) {
      return NextResponse.json(
        { authenticated: true, favoriteLocationIds: [] },
        { status: 200 }
      );
    }

    const { data: items, error: itemError } = await supabase
      .from('favorite_collection_items')
      .select('location_id')
      .eq('collection_id', targetCollection.id)
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
        favoriteLocationIds,
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: String(err?.message || err),
        favoriteLocationIds: [],
      },
      { status: 500 }
    );
  }
}