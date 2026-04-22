'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@clerk/nextjs';
import { useSupabase } from '@/lib/use-supabase';
import type { Flight, UserPreferences } from '@/lib/types';
import PreferencesPanel from './PreferencesPanel';

const FlightMap = dynamic(() => import('./FlightMap'), { ssr: false });

export default function MapClient() {
  const supabase = useSupabase();
  const { getToken } = useAuth();
  const [flights, setFlights] = useState<Map<string, Flight>>(new Map());
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showWeather, setShowWeather] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // Diagnostic: what issuer is our Clerk token? Supabase must recognize it.
        const tok = await getToken();
        if (tok) {
          const payload = JSON.parse(atob(tok.split('.')[1]));
          console.log('[clerk] iss=%s sub=%s aud=%s', payload.iss, payload.sub, payload.aud);
        } else {
          console.warn('[clerk] no token returned');
        }

        const [flightsRes, prefsRes] = await Promise.all([
          supabase.from('flights').select('*').not('latitude', 'is', null).limit(2000),
          supabase.from('user_preferences').select('*').maybeSingle(),
        ]);
        if (cancelled) return;

        if (flightsRes.error) {
          console.error('[supabase] flights error', flightsRes.error);
          setErr(`flights: ${flightsRes.error.message}`);
        }
        if (prefsRes.error) console.error('[supabase] prefs error', prefsRes.error);

        const rows = (flightsRes.data ?? []) as Flight[];
        console.log('[supabase] flights rows =', rows.length);

        const m = new Map<string, Flight>();
        for (const r of rows) m.set(r.icao24, r);
        setFlights(m);
        setPrefs(prefsRes.data as UserPreferences | null);
        if (rows.length === 0 && !flightsRes.error) {
          setErr('Query returned 0 flights. Supabase is treating you as anon — Clerk JWT is not being recognized. Check Supabase → Authentication → Third-party Auth → Clerk domain.');
        }
      } catch (e) {
        console.error(e);
        setErr(String(e));
      } finally {
        setLoaded(true);
      }
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
      <aside className="p-4 border-r border-slate-800 bg-slate-950 overflow-y-auto space-y-4">
        <PreferencesPanel prefs={prefs} onChange={setPrefs} flightCount={filtered.length} totalCount={flights.size} />
        <label className="flex items-center gap-2 text-sm border-t border-slate-800 pt-3">
          <input
            type="checkbox"
            checked={showWeather}
            onChange={e => setShowWeather(e.target.checked)}
            className="accent-sky-500"
          />
          Weather radar overlay
          <span className="text-xs text-slate-500 ml-auto">RainViewer</span>
        </label>
      </aside>
      <div className="relative">
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400">
            Loading flights…
          </div>
        )}
        {err && (
          <div className="absolute top-3 left-3 right-3 z-[1000] bg-red-950/90 border border-red-700 text-red-100 text-sm rounded px-3 py-2">
            {err}
          </div>
        )}
        <FlightMap
          flights={filtered}
          center={[prefs?.map_center_lat ?? 40, prefs?.map_center_lon ?? -95]}
          zoom={prefs?.map_zoom ?? 4}
          showWeather={showWeather}
        />
      </div>
    </div>
  );
}
