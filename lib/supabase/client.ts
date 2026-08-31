import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser Supabase client, built from the public env vars in `.env.local`:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY
 *
 * The anon key is safe to ship to the browser — Row Level Security (see
 * `supabase/migrations/0001_init.sql`) is what actually scopes data to the
 * signed-in user.
 */
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
        'Copy them from Supabase → Project Settings → API into .env.local.',
    );
  }

  return createBrowserClient(url, anonKey);
}
