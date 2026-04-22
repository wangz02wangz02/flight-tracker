'use client';
import { useEffect, useState } from 'react';
import { useSupabase } from '@/lib/use-supabase';

export default function FavoriteButton({ icao24, label }: { icao24: string; label: string | null }) {
  const supabase = useSupabase();
  const [favId, setFavId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    setBusy(true);
    try {
      if (favId) {
        await supabase.from('user_favorites').delete().eq('id', favId);
        setFavId(null);
      } else {
        const { data } = await supabase
          .from('user_favorites')
          .insert({ icao24, label })
          .select('id')
          .single();
        if (data) setFavId(data.id);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`mt-2 px-2 py-1 rounded text-xs ${
        favId ? 'bg-amber-500 text-slate-900' : 'bg-slate-700 text-white hover:bg-slate-600'
      }`}
    >
      {favId ? '★ Saved' : '☆ Save'}
    </button>
  );
}
