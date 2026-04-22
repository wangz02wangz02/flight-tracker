'use client';
import { useEffect, useState } from 'react';
import { useSupabase } from '@/lib/use-supabase';
import type { Flight, UserFavorite } from '@/lib/types';

type Row = UserFavorite & { flight: Flight | null };

export default function FavoritesClient() {
  const supabase = useSupabase();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: favs } = await supabase
        .from('user_favorites')
        .select('*')
        .order('created_at', { ascending: false });
      const icaos = (favs ?? []).map(f => f.icao24);
      let flights: Flight[] = [];
      if (icaos.length) {
        const { data } = await supabase.from('flights').select('*').in('icao24', icaos);
        flights = (data ?? []) as Flight[];
      }
      const byIcao = new Map(flights.map(f => [f.icao24, f]));
      if (!cancelled) {
        setRows((favs ?? []).map(f => ({ ...(f as UserFavorite), flight: byIcao.get(f.icao24) ?? null })));
        setLoading(false);
      }
    }

    load();

    // Live-refresh positions for favorited flights.
    const channel = supabase
      .channel('fav-flights')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'flights' }, payload => {
        const f = payload.new as Flight;
        setRows(prev => prev.map(r => (r.icao24 === f.icao24 ? { ...r, flight: f } : r)));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_favorites' }, () => {
        load();
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  async function remove(id: string) {
    await supabase.from('user_favorites').delete().eq('id', id);
  }

  if (loading) return <p className="text-slate-400">Loading…</p>;
  if (!rows.length) return <p className="text-slate-400">Nothing saved yet. Open the map and tap ☆ on a plane.</p>;

  return (
    <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {rows.map(r => (
        <li key={r.id} className="border border-slate-800 rounded p-3 bg-slate-950">
          <div className="flex items-center justify-between">
            <div className="font-semibold">{r.label?.trim() || r.icao24}</div>
            <button onClick={() => remove(r.id)} className="text-xs text-slate-400 hover:text-red-400">
              remove
            </button>
          </div>
          <div className="text-xs text-slate-400 mt-1">
            {r.flight ? (
              <>
                {r.flight.origin_country} ·{' '}
                {r.flight.baro_altitude ? `${Math.round(r.flight.baro_altitude)} m` : '—'} ·{' '}
                {r.flight.velocity ? `${Math.round(r.flight.velocity * 3.6)} km/h` : '—'}
              </>
            ) : (
              'No recent position'
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
