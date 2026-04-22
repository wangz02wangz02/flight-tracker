'use client';
import { useAuth } from '@clerk/nextjs';
import { useMemo } from 'react';
import { makeSupabaseBrowser } from './supabase-browser';

/** Returns a memoized Supabase client that always sends the current Clerk JWT. */
export function useSupabase() {
  const { getToken } = useAuth();
  return useMemo(() => makeSupabaseBrowser(() => getToken()), [getToken]);
}
