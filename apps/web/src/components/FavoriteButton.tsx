'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useSupabase } from '@/lib/use-supabase';

export default function FavoriteButton({ icao24, label }: { icao24: string; label: string | null }) {
  const supabase = useSupabase();
  const { userId } = useAuth();
  const [favId, setFavId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('user_favorites')
        .select('id')
        .eq('icao24', icao24)
        .maybeSingle();
      if (!cancelled) setFavId(data?.id ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, icao24]);

  async function toggle() {
    if (!userId) {
      setErr('Not signed in');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      if (favId) {
        const { error } = await supabase.from('user_favorites').delete().eq('id', favId);
        if (error) throw error;
        setFavId(null);
      } else {
        const { data, error } = await supabase
          .from('user_favorites')
          .insert({ user_id: userId, icao24, label })
          .select('id')
          .single();
        if (error) throw error;
        if (data) setFavId(data.id);
      }
    } catch (e) {
      console.error('[favorite] save failed', e);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        onClick={toggle}
        disabled={busy}
        className={`px-2 py-1 rounded text-xs ${
          favId ? 'bg-amber-500 text-slate-900' : 'bg-slate-700 text-white hover:bg-slate-600'
        } disabled:opacity-50`}
      >
        {busy ? 'Saving…' : favId ? '★ Saved' : '☆ Save'}
      </button>
      {err && <div className="text-[11px] text-red-400 mt-1 max-w-[220px]">{err}</div>}
    </div>
  );
}
