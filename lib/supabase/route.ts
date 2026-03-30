import { createClient } from "@supabase/supabase-js";

export function createSupabaseRouteClient(req: Request) {
  const authHeader = req.headers.get("authorization") || "";

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: authHeader ? { Authorization: authHeader } : {},
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
}