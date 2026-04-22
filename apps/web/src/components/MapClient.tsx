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

// djb2 — cheap deterministic hash on icao24 for stable sampling.
function hashIcao(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  return h >>> 0;
}
// Supabase Realtime is the live signal: any postgres_changes event on flights
// triggers a coalesced REST refetch. The channel is rate-limited (~10 evt/sec
// on the default plan) under 3k+ upserts/tick, so we treat it as a heartbeat
// rather than a data source — a single surviving event is enough to refresh.
// A slower poll still runs as a safety net in case the channel stalls.
const REALTIME_DEBOUNCE_MS = 1_000;
const POLL_INTERVAL_MS = 15_000;
// An aircraft that hasn't appeared in a refresh for this long is dropped.
// Shorter ⇒ faster removal of landed/out-of-coverage planes; longer ⇒ less
// flicker when a single region fetch fails on the worker. 2 worker ticks.
const STALE_MS = 60_000;
// Upper bound for what a single refresh fetches. Subsample client-side for density.
const POOL_SIZE = 10_000;
const PAGE = 1000;

export default function MapClient() {
  const supabase = useSupabase();
  const { getToken } = useAuth();
  const [flights, setFlights] = useState<Map<string, Flight>>(new Map());
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showWeather, setShowWeather] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    // Paginates through public.flights up to POOL_SIZE. Supabase REST caps a
    // single response at 1000 rows by default, so we range-page until done.
    async function fetchAllFlights(): Promise<Flight[] | null> {
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
          return null;
        }
        const batch = (data ?? []) as Flight[];
        rows.push(...batch);
        if (batch.length < PAGE) break;
      }
      return rows;
    }

    async function refresh(initial = false) {
      try {
        if (initial) {
          const tok = await getToken();
          if (tok) {
            const payload = JSON.parse(atob(tok.split('.')[1]));
            console.log('[clerk] iss=%s sub=%s', payload.iss, payload.sub);
          }
          const prefsRes = await supabase.from('user_preferences').select('*').maybeSingle();
          if (prefsRes.error) console.error('[supabase] prefs error', prefsRes.error);
          setPrefs(prefsRes.data as UserPreferences | null);
        }

        const rows = await fetchAllFlights();
        if (cancelled || rows == null) return;

        // Merge instead of replace: a momentary gap in the response (region
        // fetch failure, adsb.lol coverage flicker) shouldn't make planes
        // disappear for one tick and reappear the next. Carry forward the
        // prior entry; prune only when genuinely stale.
        setFlights(prev => {
          const next = new Map(prev);
          for (const r of rows) next.set(r.icao24, r);
          const nowMs = Date.now();
          for (const [k, f] of next) {
            const ts = f.updated_at ? new Date(f.updated_at).getTime() : 0;
            if (nowMs - ts > STALE_MS) next.delete(k);
          }
          return next;
        });
        setLastUpdate(Date.now());
        setRefreshCount(c => c + 1);
        if (initial && rows.length === 0) {
          setErr(
            'Query returned 0 flights. Supabase is treating you as anon — Clerk JWT is not being recognized.',
          );
        }
      } catch (e) {
        console.error('[poll] refresh failed', e);
      } finally {
        if (initial) setLoaded(true);
        if (!cancelled) pollTimer = setTimeout(() => refresh(false), POLL_INTERVAL_MS);
      }
    }

    function scheduleRealtimeRefetch() {
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        if (!cancelled) refresh(false);
      }, REALTIME_DEBOUNCE_MS);
    }

    refresh(true);

    let channel: ReturnType<typeof supabase.channel> | null = null;
    (async () => {
      const tok = await getToken();
      if (tok) supabase.realtime.setAuth(tok);
      if (cancelled) return;
      channel = supabase
        .channel('flights-heartbeat')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'flights' }, () => {
          scheduleRealtimeRefetch();
        })
        .subscribe(status => {
          console.log('[realtime] flights channel:', status);
        });
    })();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [supabase, getToken]);

  const density = prefs?.flight_density ?? 500;

  const filtered = useMemo(() => {
    let list = Array.from(flights.values());
    if (prefs?.filter_country) {
      list = list.filter(f => f.origin_country === prefs.filter_country);
    }
    if (list.length <= density) return list;
    // Stable membership sample: each aircraft's inclusion depends only on its
    // icao24, not on what else is in the pool. This way the subset stays
    // identity-stable across refreshes — planes visibly move instead of being
    // swapped out by stride-index shifts when the total count changes.
    const scored = list.map(f => [hashIcao(f.icao24), f] as const);
    scored.sort((a, b) => a[0] - b[0]);
    return scored.slice(0, density).map(([, f]) => f);
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
            <span className="text-slate-500 ml-auto">{refreshCount.toLocaleString()} refreshes</span>
          </div>
          <p className="text-slate-500">
            Last update:{' '}
            {lastUpdate ? `${Math.max(0, Math.round((Date.now() - lastUpdate) / 1000))}s ago` : 'waiting…'}
          </p>
          <p className="text-slate-500">
            Source: adsb.lol → Railway worker → Supabase Realtime
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
