'use client';
import { useState } from 'react';
import { useSupabase } from '@/lib/use-supabase';
import { useUser } from '@clerk/nextjs';
import type { UserPreferences } from '@/lib/types';

const DENSITY_OPTIONS = [100, 200, 500, 1000, 2000, 3000, 5000, 10000];

export default function PreferencesPanel({
  prefs,
  onChange,
  flightCount,
  totalCount,
}: {
  prefs: UserPreferences | null;
  onChange: (p: UserPreferences | null) => void;
  flightCount: number;
  totalCount: number;
}) {
  const supabase = useSupabase();
  const { user } = useUser();
  const [country, setCountry] = useState(prefs?.filter_country ?? '');
  const [density, setDensity] = useState(prefs?.flight_density ?? 500);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  async function persist(nextDensity?: number, nextCountry?: string) {
    if (!user) return;
    const payload = {
      user_id: user.id,
      map_center_lat: prefs?.map_center_lat ?? 40,
      map_center_lon: prefs?.map_center_lon ?? -95,
      map_zoom: prefs?.map_zoom ?? 4,
      filter_country: (nextCountry ?? country).trim() || null,
      flight_density: nextDensity ?? density,
    };
    const { data, error } = await supabase
      .from('user_preferences')
      .upsert(payload, { onConflict: 'user_id' })
      .select('*')
      .single();
    if (error) throw error;
    onChange(data as UserPreferences);
  }

  async function pickDensity(n: number) {
    setDensity(n);
    // Optimistically update so the map responds instantly, then persist.
    onChange({ ...(prefs ?? ({} as UserPreferences)), flight_density: n, user_id: user?.id ?? '' });
    try {
      await persist(n, country);
    } catch (e) {
      console.error('[prefs] density save error', e);
    }
  }

  async function save() {
    if (!user) {
      setStatus({ kind: 'err', msg: 'Not signed in' });
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const payload = {
        user_id: user.id,
        map_center_lat: prefs?.map_center_lat ?? 40,
        map_center_lon: prefs?.map_center_lon ?? -95,
        map_zoom: prefs?.map_zoom ?? 4,
        filter_country: country.trim() || null,
        flight_density: density,
      };
      const { data, error } = await supabase
        .from('user_preferences')
        .upsert(payload, { onConflict: 'user_id' })
        .select('*')
        .single();
      if (error) {
        console.error('[prefs] save error', error);
        setStatus({ kind: 'err', msg: error.message });
        return;
      }
      onChange(data as UserPreferences);
      setStatus({ kind: 'ok', msg: 'Saved ✓' });
      setTimeout(() => setStatus(null), 2000);
    } catch (e) {
      console.error(e);
      setStatus({ kind: 'err', msg: String(e) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div>
        <label className="block mb-1 text-slate-300">Show how many aircraft</label>
        <div className="flex flex-wrap gap-1">
          {DENSITY_OPTIONS.map(n => (
            <button
              key={n}
              onClick={() => pickDensity(n)}
              className={`text-xs px-2 py-1 rounded border transition-colors ${
                density === n
                  ? 'bg-sky-600 border-sky-500 text-white'
                  : 'bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800'
              }`}
            >
              {n >= 1000 ? `${n / 1000}k` : n}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Showing {flightCount.toLocaleString()} of {totalCount.toLocaleString()} tracked
        </p>
      </div>

      <div>
        <label className="block mb-1 text-slate-300">Filter by country</label>
        <input
          value={country}
          onChange={e => setCountry(e.target.value)}
          placeholder="United States"
          className="w-full rounded bg-slate-900 border border-slate-700 px-2 py-1"
        />
        <button
          onClick={save}
          disabled={saving}
          className="mt-2 w-full rounded bg-sky-600 hover:bg-sky-500 px-3 py-1 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save preferences'}
        </button>
        {status && (
          <p
            className={`mt-2 text-xs ${
              status.kind === 'ok' ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {status.msg}
          </p>
        )}
      </div>

      <div className="text-xs text-slate-500 border-t border-slate-800 pt-3">
        Map and favorites stream live via Supabase Realtime. Reloads are unnecessary.
      </div>
    </div>
  );
}
