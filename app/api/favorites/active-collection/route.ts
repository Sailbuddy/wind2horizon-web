import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseClients(accessToken) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    throw new Error('Missing Supabase environment variables.');
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey);

  return { userClient, adminClient };
}

async function getUserFromRequest(req) {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return { error: 'Missing bearer token.', status: 401 };
  }

  try {
    const { userClient, adminClient } = getSupabaseClients(token);

    const {
      data: { user },
      error,
    } = await userClient.auth.getUser();

    if (error || !user) {
      return { error: 'Unauthorized.', status: 401 };
    }

    return { user, adminClient };
  } catch (err) {
    return {
      error: String(err?.message || err),
      status: 500,
    };
  }
}

async function resolveFallbackActiveCollectionId(adminClient, userId) {
  const { data, error } = await adminClient
    .from('favorite_collections')
    .select('id')
    .eq('user_id', userId)
    .order('id', { ascending: true })
    .limit(1);

  if (error) throw error;

  return data?.[0]?.id ?? null;
}

export async function GET(req) {
  const auth = await getUserFromRequest(req);
  if (auth.error) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status }
    );
  }

  const { user, adminClient } = auth;

  try {
    const { data: stateRow, error: stateError } = await adminClient
      .from('user_collection_state')
      .select('active_collection_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (stateError) throw stateError;

    let activeCollectionId = stateRow?.active_collection_id ?? null;

    if (!activeCollectionId) {
      activeCollectionId = await resolveFallbackActiveCollectionId(
        adminClient,
        user.id
      );
    }

    return NextResponse.json({
  ok: true,
  activeCollectionId,
});

  } catch (err) {
    console.error('[api/favorites/active-collection][GET] failed:', err);

    return NextResponse.json(
      {
        ok: false,
        error: String(err?.message || err),
      },
      { status: 500 }
    );
  }
}

export async function PATCH(req) {
  const auth = await getUserFromRequest(req);
  if (auth.error) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status }
    );
  }

  const { user, adminClient } = auth;

  try {
    const body = await req.json();
    const activeCollectionId = Number(body?.activeCollectionId);

    if (!Number.isFinite(activeCollectionId)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid activeCollectionId.' },
        { status: 400 }
      );
    }

    // Sicherheitscheck: gehört diese Collection wirklich dem User?
    const { data: ownedCollection, error: ownError } = await adminClient
      .from('favorite_collections')
      .select('id')
      .eq('id', activeCollectionId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (ownError) throw ownError;

    if (!ownedCollection) {
      return NextResponse.json(
        { ok: false, error: 'Collection not found for this user.' },
        { status: 404 }
      );
    }

    const { error: upsertError } = await adminClient
      .from('user_collection_state')
      .upsert(
        {
          user_id: user.id,
          active_collection_id: activeCollectionId,
        },
        {
          onConflict: 'user_id',
        }
      );

    if (upsertError) throw upsertError;

    return NextResponse.json({
      ok: true,
      activeCollectionId,
    });
  } catch (err) {
    console.error('[api/favorites/active-collection][PATCH] failed:', err);

    return NextResponse.json(
      {
        ok: false,
        error: String(err?.message || err),
      },
      { status: 500 }
    );
  }
}