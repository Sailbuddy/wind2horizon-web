import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabaseClient';

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const locationIdRaw = searchParams.get('locationId');
    const locationId = Number(locationIdRaw);

    if (!Number.isFinite(locationId)) {
      return NextResponse.json(
        { error: 'locationId is required' },
        { status: 400 }
      );
    }

    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : '';

    if (!token) {
      return NextResponse.json({
        isFavorite: false,
        authenticated: false,
      });
    }

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return NextResponse.json({
        isFavorite: false,
        authenticated: false,
      });
    }

    const { data: collections, error: collectionsError } = await supabase
      .from('collections')
      .select('id,is_default,collection_type')
      .eq('user_id', user.id);

    if (collectionsError) {
      console.error('[favorites/status] collections error:', collectionsError);
      return NextResponse.json(
        { error: 'Could not load collections' },
        { status: 500 }
      );
    }

    const targetCollection =
      collections?.find((c) => c?.is_default) ||
      collections?.find((c) => c?.collection_type === 'favorites') ||
      collections?.[0] ||
      null;

    if (!targetCollection?.id) {
      return NextResponse.json({
        isFavorite: false,
        authenticated: true,
      });
    }

    const { data: item, error: itemError } = await supabase
      .from('items')
      .select('id')
      .eq('collection_id', Number(targetCollection.id))
      .eq('location_id', locationId)
      .maybeSingle();

    if (itemError) {
      console.error('[favorites/status] item error:', itemError);
      return NextResponse.json(
        { error: 'Could not check favorite status' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      isFavorite: !!item,
      authenticated: true,
    });
  } catch (err) {
    console.error('[favorites/status] unexpected error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}