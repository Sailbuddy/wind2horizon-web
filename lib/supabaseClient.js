import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anon) {
  throw new Error(
    'Supabase ENV fehlt: Bitte NEXT_PUBLIC_SUPABASE_URL und NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel (.env) setzen.'
  );
}

export const supabase = createClient(url, anon, {
  auth: { persistSession: false },
  global: { fetch },
  db: { schema: 'public' },
});
