'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useSupabase } from '@/lib/use-supabase';
import type { Flight, UserPreferences } from '@/lib/types';
import PreferencesPanel from './PreferencesPanel';

// Leaflet needs window; disable SSR for the actual map.
const FlightMap = dynamic(() => import('./FlightMap'), { ssr: false });

export default function MapClient() {
  const supabase = useSupabase();
  const [flights, setFlights] = useState<Map<string, Flight>>(new Map());
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Initial load + realtime subscription.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const [{ data: rows }, { data: pref }] = await Promise.all([
        supabase.from('flights').select('*').not('latitude', 'is', null).limit(2000),
        supabase.from('user_preferences').select('*').maybeSingle(),
      ]);
      if (cancelled) return;
      const m = new Map<string, Flight>();
      for (const r of (rows ?? []) as Flight[]) m.set(r.icao24, r);
      setFlights(m);
      setPrefs(pref as UserPreferences | null);
      setLoaded(true);
    })();

    const channel = supabase
      .channel('flights-stream')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'flights' },
        payload => {
          setFlights(prev => {
            const next = new Map(prev);
            if (payload.eventType === 'DELETE') {
              next.delete((payload.old as Flight).icao24);
            } else {
              const row = payload.new as Flight;
              if (row.latitude != null && row.longitude != null) next.set(row.icao24, row);
            }
            return next;
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  const filtered = useMemo(() => {
    const list = Array.from(flights.values());
    if (!prefs?.filter_country) return list;
    return list.filter(f => f.origin_country === prefs.filter_country);
  }, [flights, prefs?.filter_country]);

  return (
    <div className="flex-1 grid md:grid-cols-[320px_1fr] grid-rows-[auto_1fr] md:grid-rows-1">
      <aside className="p-4 border-r border-slate-800 bg-slate-950 overflow-y-auto">
        <PreferencesPanel prefs={prefs} onChange={setPrefs} flightCount={filtered.length} totalCount={flights.size} />
      </aside>
      <div className="relative">
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400">
            Loading flights…
          </div>
        )}
        <FlightMap
          flights={filtered}
          center={[prefs?.map_center_lat ?? 40, prefs?.map_center_lon ?? -95]}
          zoom={prefs?.map_zoom ?? 4}
        />
      </div>
    </div>
  );
}
