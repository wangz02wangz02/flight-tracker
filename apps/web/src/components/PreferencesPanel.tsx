'use client';
import { useState } from 'react';
import { useSupabase } from '@/lib/use-supabase';
import { useUser } from '@clerk/nextjs';
import type { UserPreferences } from '@/lib/types';

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
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!user) return;
    setSaving(true);
    try {
      const payload = {
        user_id: user.id,
        map_center_lat: prefs?.map_center_lat ?? 40,
        map_center_lon: prefs?.map_center_lon ?? -95,
        map_zoom: prefs?.map_zoom ?? 4,
        filter_country: country.trim() || null,
      };
      const { data, error } = await supabase
        .from('user_preferences')
        .upsert(payload, { onConflict: 'user_id' })
        .select('*')
        .single();
      if (error) throw error;
      onChange(data as UserPreferences);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h2 className="font-semibold mb-1">Live feed</h2>
        <p className="text-slate-400">
          {flightCount.toLocaleString()} shown / {totalCount.toLocaleString()} tracked
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
      </div>

      <div className="text-xs text-slate-500 border-t border-slate-800 pt-3">
        Map and favorites stream live via Supabase Realtime. Reloads are unnecessary.
      </div>
    </div>
  );
}
