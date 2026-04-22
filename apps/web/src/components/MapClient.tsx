'use client';
import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@clerk/nextjs';
import { useSupabase } from '@/lib/use-supabase';
import type { Flight, UserPreferences } from '@/lib/types';
import PreferencesPanel from './PreferencesPanel';
import Legend from './Legend';

const FlightMap = dynamic(() => import('./FlightMap'), { ssr: false });

const EMERGENCY_SQUAWKS = new Set(['7500', '7600', '7700']);
// Minimum time between flushes. First event flushes instantly; further events
// in the same window are coalesced so bursts don't rerender thousands of markers.
const MIN_FLUSH_INTERVAL_MS = 5_000;
// Upper bound for the initial load pool. We subsample client-side for density.
const POOL_SIZE = 10_000;

export default function MapClient() {
  const supabase = useSupabase();
  const { getToken } = useAuth();
  const [flights, setFlights] = useState<Map<string, Flight>>(new Map());
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showWeather, setShowWeather] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

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

        // Supabase REST defaults to 1000 rows per request. Page through until we
        // reach POOL_SIZE or the server stops returning full pages.
        const PAGE = 1000;
        const rows: Flight[] = [];
        for (let from = 0; from < POOL_SIZE; from += PAGE) {
          const to = Math.min(from + PAGE - 1, POOL_SIZE - 1);
          const { data, error } = await supabase
            .from('flights')
            .select('*')
            .not('latitude', 'is', null)
            .order('icao24')
            .range(from, to);
          if (error) {
            console.error('[supabase] flights error', error);
            setErr(`flights: ${error.message}`);
            break;
          }
          const batch = (data ?? []) as Flight[];
          rows.push(...batch);
          if (batch.length < PAGE) break;
        }
        const prefsRes = await supabase.from('user_preferences').select('*').maybeSingle();
        if (cancelled) return;
        if (prefsRes.error) console.error('[supabase] prefs error', prefsRes.error);
        console.log('[supabase] flights rows =', rows.length);

        const m = new Map<string, Flight>();
        for (const r of rows) m.set(r.icao24, r);
        setFlights(m);
        setPrefs(prefsRes.data as UserPreferences | null);
        if (rows.length === 0) {
          setErr('Query returned 0 flights. Supabase is treating you as anon — Clerk JWT is not being recognized. Check Supabase → Authentication → Third-party Auth → Clerk domain.');
        }
      } catch (e) {
        console.error(e);
        setErr(String(e));
      } finally {
        setLoaded(true);
      }
    })();

    let channel: ReturnType<typeof supabase.channel> | null = null;

    // Buffer realtime events in a mutable Map keyed by icao24 so a burst of 10k
    // updates collapses to one entry per aircraft. First event flushes instantly;
    // subsequent events within MIN_FLUSH_INTERVAL_MS are coalesced.
    const pending = new Map<string, { kind: 'upsert' | 'delete'; row: Flight }>();
    let bufferedEvents = 0;
    let lastFlush = 0;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      flushTimer = null;
      lastFlush = Date.now();
      if (pending.size === 0) return;
      setFlights(prev => {
        const next = new Map(prev);
        for (const { kind, row } of pending.values()) {
          if (kind === 'delete') next.delete(row.icao24);
          else if (row.latitude != null && row.longitude != null) next.set(row.icao24, row);
        }
        return next;
      });
      pending.clear();
      if (bufferedEvents > 0) {
        setEventCount(c => c + bufferedEvents);
        bufferedEvents = 0;
      }
      setLastUpdate(Date.now());
    };

    const scheduleFlush = () => {
      if (flushTimer) return;
      const wait = Math.max(0, MIN_FLUSH_INTERVAL_MS - (Date.now() - lastFlush));
      flushTimer = setTimeout(flush, wait);
    };

    (async () => {
      // Make sure the realtime socket authenticates with the current Clerk JWT
      // BEFORE subscribing — otherwise it opens as anon and RLS drops every event.
      const tok = await getToken();
      if (tok) supabase.realtime.setAuth(tok);

      channel = supabase
        .channel('flights-stream')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'flights' },
          payload => {
            bufferedEvents++;
            if (payload.eventType === 'DELETE') {
              const row = payload.old as Flight;
              pending.set(row.icao24, { kind: 'delete', row });
            } else {
              const row = payload.new as Flight;
              pending.set(row.icao24, { kind: 'upsert', row });
            }
            scheduleFlush();
          },
        )
        .subscribe(status => console.log('[realtime] channel status:', status));
    })();

    return () => {
      cancelled = true;
      if (flushTimer) clearTimeout(flushTimer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [supabase, getToken]);

  const density = prefs?.flight_density ?? 500;

  const filtered = useMemo(() => {
    let list = Array.from(flights.values());
    if (prefs?.filter_country) {
      list = list.filter(f => f.origin_country === prefs.filter_country);
    }
    // Stable stride sample so the subset doesn't flicker as realtime events
    // replace existing rows. Sorting by icao24 gives a deterministic order.
    list.sort((a, b) => (a.icao24 < b.icao24 ? -1 : 1));
    if (list.length <= density) return list;
    const stride = list.length / density;
    const picked: Flight[] = [];
    for (let i = 0; i < density; i++) picked.push(list[Math.floor(i * stride)]);
    return picked;
  }, [flights, prefs?.filter_country, density]);

  // Emergency squawks should never be sampled away — union them in.
  const emergencies = useMemo(
    () => Array.from(flights.values()).filter(f => f.squawk && EMERGENCY_SQUAWKS.has(f.squawk)),
    [flights],
  );

  const displayed = useMemo(() => {
    if (emergencies.length === 0) return filtered;
    const ids = new Set(filtered.map(f => f.icao24));
    const extras = emergencies.filter(f => !ids.has(f.icao24));
    return extras.length ? [...filtered, ...extras] : filtered;
  }, [filtered, emergencies]);

  return (
    <div className="flex-1 grid md:grid-cols-[320px_1fr] grid-rows-[auto_1fr] md:grid-rows-1">
      <aside className="p-4 border-r border-slate-800 bg-slate-950 overflow-y-auto space-y-4">
        <PreferencesPanel prefs={prefs} onChange={setPrefs} flightCount={displayed.length} totalCount={flights.size} />

        <div className="text-xs border-t border-slate-800 pt-3 space-y-1">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                lastUpdate && Date.now() - lastUpdate < 60_000 ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
              }`}
            />
            <span className="text-slate-300">Realtime</span>
            <span className="text-slate-500 ml-auto">{eventCount.toLocaleString()} events</span>
          </div>
          <p className="text-slate-500">
            Last update:{' '}
            {lastUpdate ? `${Math.max(0, Math.round((Date.now() - lastUpdate) / 1000))}s ago` : 'waiting…'}
          </p>
          <p className="text-slate-500">
            Source: OpenSky Network → worker → Supabase Realtime
          </p>
        </div>

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

        <Legend />
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
        {emergencies.length > 0 && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] bg-red-600/95 text-white text-xs font-semibold rounded-full px-4 py-1.5 shadow-lg flex items-center gap-2 animate-pulse">
            <span className="inline-block w-2 h-2 rounded-full bg-white" />
            {emergencies.length} aircraft squawking emergency
          </div>
        )}
        <FlightMap
          flights={displayed}
          center={[prefs?.map_center_lat ?? 40, prefs?.map_center_lon ?? -95]}
          zoom={prefs?.map_zoom ?? 4}
          showWeather={showWeather}
        />
      </div>
    </div>
  );
}
