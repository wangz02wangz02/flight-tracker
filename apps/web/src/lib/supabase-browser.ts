'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser Supabase client wired to the Clerk session via third-party auth.
 * Supabase calls `accessToken()` on every request, so we always hand it the
 * freshest Clerk JWT. This is the integration that makes RLS policies using
 * `auth.jwt()->>'sub'` resolve to the Clerk user id.
 */
export function makeSupabaseBrowser(getToken: () => Promise<string | null>): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anon, {
    accessToken: async () => (await getToken()) ?? null,
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
