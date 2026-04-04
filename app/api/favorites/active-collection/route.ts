import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  createSupabaseAdminClient,
  resolveActiveCollectionId,
} from '@/lib/server/favorites/resolveActiveCollectionId';

export const runtime = 'nodejs';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getBearerToken(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!authHeader) return null;

  const [scheme, token] = authHeader.split(' ');
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;

  return token.trim();
}

async function getAuthenticatedUserIdFromBearerToken(
  accessToken: string
): Promise<string | null> {
  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const anonKey = requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');

  const supabaseAuth = createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  const { data, error } = await supabaseAuth.auth.getUser(accessToken);

  if (error) {
    throw new Error(`Failed to validate access token: ${error.message}`);
  }

  return data.user?.id ?? null;
}

export async function GET(req: NextRequest) {
  try {
    const accessToken = getBearerToken(req);

    if (!accessToken) {
      return NextResponse.json(
        {
          ok: false,
          authenticated: false,
          error: 'Missing bearer token.',
          activeCollectionId: null,
          source: 'none',
        },
        { status: 401 }
      );
    }

    const userId = await getAuthenticatedUserIdFromBearerToken(accessToken);

    if (!userId) {
      return NextResponse.json(
        {
          ok: false,
          authenticated: false,
          error: 'Invalid or expired access token.',
          activeCollectionId: null,
          source: 'none',
        },
        { status: 401 }
      );
    }

    const supabaseAdmin = createSupabaseAdminClient();

    const result = await resolveActiveCollectionId(supabaseAdmin, userId);

    return NextResponse.json(
      {
        ok: true,
        authenticated: true,
        activeCollectionId: result.activeCollectionId,
        source: result.source,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('[api/favorites/active-collection][GET] failed:', error);

    return NextResponse.json(
      {
        ok: false,
        authenticated: false,
        error:
          error instanceof Error
            ? error.message
            : 'Unknown error while resolving active collection.',
        activeCollectionId: null,
        source: 'none',
      },
      { status: 500 }
    );
  }
}