import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type ActiveCollectionResolveSource =
  | 'state'
  | 'fallback_favorites'
  | 'fallback_any'
  | 'none';

export type ResolveActiveCollectionResult = {
  activeCollectionId: number | null;
  source: ActiveCollectionResolveSource;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function createSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function findFirstOwnedFavoritesCollection(
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<{ id: number } | null> {
  const { data, error } = await supabaseAdmin
    .from('favorite_collections')
    .select('id, is_default, created_at')
    .eq('owner_user_id', userId)
    .eq('collection_type', 'favorites')
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve favorites fallback collection: ${error.message}`);
  }

  if (!data?.id) return null;

  return { id: Number(data.id) };
}

async function findFirstOwnedAnyCollection(
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<{ id: number } | null> {
  const { data, error } = await supabaseAdmin
    .from('favorite_collections')
    .select('id, is_default, created_at')
    .eq('owner_user_id', userId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve generic fallback collection: ${error.message}`);
  }

  if (!data?.id) return null;

  return { id: Number(data.id) };
}

async function validateOwnedCollection(
  supabaseAdmin: SupabaseClient,
  userId: string,
  collectionId: number
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('favorite_collections')
    .select('id')
    .eq('id', collectionId)
    .eq('owner_user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to validate active collection ownership: ${error.message}`);
  }

  return !!data?.id;
}

async function upsertUserCollectionState(
  supabaseAdmin: SupabaseClient,
  userId: string,
  activeCollectionId: number
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('user_collection_state')
    .upsert(
      {
        user_id: userId,
        active_collection_id: activeCollectionId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );

  if (error) {
    throw new Error(`Failed to upsert user_collection_state: ${error.message}`);
  }
}

export async function resolveActiveCollectionId(
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<ResolveActiveCollectionResult> {
  if (!userId) {
    throw new Error('resolveActiveCollectionId requires a userId');
  }

  const { data: stateRow, error: stateError } = await supabaseAdmin
    .from('user_collection_state')
    .select('active_collection_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (stateError) {
    throw new Error(`Failed to read user_collection_state: ${stateError.message}`);
  }

  const stateCollectionId =
    stateRow?.active_collection_id != null
      ? Number(stateRow.active_collection_id)
      : null;

  if (stateCollectionId && Number.isFinite(stateCollectionId)) {
    const isOwned = await validateOwnedCollection(
      supabaseAdmin,
      userId,
      stateCollectionId
    );

    if (isOwned) {
      return {
        activeCollectionId: stateCollectionId,
        source: 'state',
      };
    }
  }

  const favoritesFallback = await findFirstOwnedFavoritesCollection(
    supabaseAdmin,
    userId
  );

  if (favoritesFallback?.id != null) {
    await upsertUserCollectionState(supabaseAdmin, userId, favoritesFallback.id);

    return {
      activeCollectionId: favoritesFallback.id,
      source: 'fallback_favorites',
    };
  }

  const anyFallback = await findFirstOwnedAnyCollection(supabaseAdmin, userId);

  if (anyFallback?.id != null) {
    await upsertUserCollectionState(supabaseAdmin, userId, anyFallback.id);

    return {
      activeCollectionId: anyFallback.id,
      source: 'fallback_any',
    };
  }

  return {
    activeCollectionId: null,
    source: 'none',
  };
}