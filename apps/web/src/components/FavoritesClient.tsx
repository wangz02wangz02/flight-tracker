'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useSupabase } from '@/lib/use-supabase';
import type { Flight, UserFavorite } from '@/lib/types';

type Row = UserFavorite & { flight: Flight | null };

export default function FavoritesClient() {
  const supabase = useSupabase();
  const { getToken } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data: favs, error } = await supabase
        .from('user_favorites')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) console.error('[favorites] load error', error);
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

    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const tok = await getToken();
      if (tok) supabase.realtime.setAuth(tok);
      channel = supabase
        .channel('fav-flights')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'flights' }, payload => {
          const f = payload.new as Flight;
          setRows(prev => prev.map(r => (r.icao24 === f.icao24 ? { ...r, flight: f } : r)));
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'user_favorites' }, () => {
          load();
        })
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [supabase, getToken]);

  async function remove(id: string) {
    await supabase.from('user_favorites').delete().eq('id', id);
  }

  if (loading) return <p className="text-slate-400">Loading…</p>;
  if (!rows.length) return <p className="text-slate-400">Nothing saved yet. Open the map and tap ☆ on a plane.</p>;

  return (
    <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {rows.map(r => (
        <FavoriteCard key={r.id} row={r} onRemove={() => remove(r.id)} />
      ))}
    </ul>
  );
}

function FavoriteCard({ row, onRemove }: { row: Row; onRemove: () => void }) {
  const supabase = useSupabase();
  const [notes, setNotes] = useState(row.notes ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'err'>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const dirty = notes !== (row.notes ?? '');

  async function save() {
    setStatus('saving');
    setErrMsg(null);
    const { error } = await supabase
      .from('user_favorites')
      .update({ notes: notes.trim() || null })
      .eq('id', row.id);
    if (error) {
      console.error('[notes] save error', error);
      setErrMsg(error.message);
      setStatus('err');
      return;
    }
    setStatus('saved');
    setTimeout(() => setStatus('idle'), 1500);
  }

  return (
    <li className="border border-slate-800 rounded p-3 bg-slate-950">
      <div className="flex items-center justify-between">
        <div className="font-semibold">{row.label?.trim() || row.icao24}</div>
        <button onClick={onRemove} className="text-xs text-slate-400 hover:text-red-400">
          remove
        </button>
      </div>
      <div className="text-xs text-slate-400 mt-1">
        {row.flight ? (
          <>
            {row.flight.origin_country} ·{' '}
            {row.flight.baro_altitude ? `${Math.round(row.flight.baro_altitude)} m` : '—'} ·{' '}
            {row.flight.velocity ? `${Math.round(row.flight.velocity * 3.6)} km/h` : '—'}
          </>
        ) : (
          'No recent position'
        )}
      </div>

      <div className="mt-3">
        <label className="block text-xs text-slate-400 mb-1">Notes</label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="e.g. Dad's return flight, watch for delays…"
          rows={2}
          className="w-full rounded bg-slate-900 border border-slate-700 text-sm px-2 py-1 resize-y"
        />
        <div className="flex items-center gap-2 mt-1">
          <button
            onClick={save}
            disabled={!dirty || status === 'saving'}
            className="text-xs rounded bg-sky-600 hover:bg-sky-500 px-2 py-1 disabled:opacity-50"
          >
            {status === 'saving' ? 'Saving…' : 'Save note'}
          </button>
          {status === 'saved' && <span className="text-xs text-emerald-400">Saved ✓</span>}
          {status === 'err' && <span className="text-xs text-red-400">Save failed</span>}
        </div>
        {errMsg && <p className="text-[11px] text-red-400 mt-1 break-words">{errMsg}</p>}
      </div>
    </li>
  );
}
