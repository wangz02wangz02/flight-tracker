import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  OPENSKY_USERNAME,
  OPENSKY_PASSWORD,
  OPENSKY_BBOX,
  POLL_INTERVAL_MS,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const pollMs = Number(POLL_INTERVAL_MS ?? 30_000);

// OpenSky /states/all returns a 17-element array per aircraft.
// https://openskynetwork.github.io/opensky-api/rest.html#all-state-vectors
type OpenSkyState = [
  string,             // 0  icao24
  string | null,      // 1  callsign
  string,             // 2  origin_country
  number | null,      // 3  time_position (unix)
  number,             // 4  last_contact  (unix)
  number | null,      // 5  longitude
  number | null,      // 6  latitude
  number | null,      // 7  baro_altitude
  boolean,            // 8  on_ground
  number | null,      // 9  velocity
  number | null,      // 10 true_track
  number | null,      // 11 vertical_rate
  number[] | null,    // 12 sensors
  number | null,      // 13 geo_altitude
  string | null,      // 14 squawk
  boolean,            // 15 spi
  number,             // 16 position_source
];

type OpenSkyResponse = { time: number; states: OpenSkyState[] | null };

function buildUrl(): string {
  const base = 'https://opensky-network.org/api/states/all';
  if (!OPENSKY_BBOX) return base;
  const [minLat, maxLat, minLon, maxLon] = OPENSKY_BBOX.split(',').map(s => s.trim());
  const p = new URLSearchParams({ lamin: minLat, lamax: maxLat, lomin: minLon, lomax: maxLon });
  return `${base}?${p.toString()}`;
}

function authHeader(): Record<string, string> {
  if (!OPENSKY_USERNAME || !OPENSKY_PASSWORD) return {};
  const token = Buffer.from(`${OPENSKY_USERNAME}:${OPENSKY_PASSWORD}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

async function fetchStates(): Promise<OpenSkyState[]> {
  const res = await fetch(buildUrl(), { headers: authHeader() });
  if (!res.ok) throw new Error(`OpenSky ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as OpenSkyResponse;
  return data.states ?? [];
}

function toRow(s: OpenSkyState) {
  return {
    icao24: s[0],
    callsign: s[1]?.trim() || null,
    origin_country: s[2],
    last_contact: new Date(s[4] * 1000).toISOString(),
    longitude: s[5],
    latitude: s[6],
    baro_altitude: s[7],
    on_ground: s[8],
    velocity: s[9],
    true_track: s[10],
    vertical_rate: s[11],
    updated_at: new Date().toISOString(),
  };
}

async function upsertBatch(rows: ReturnType<typeof toRow>[]) {
  // Supabase limits payload size; chunk to be safe.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from('flights').upsert(chunk, { onConflict: 'icao24' });
    if (error) throw error;
  }
}

async function tick() {
  const t0 = Date.now();
  try {
    const states = await fetchStates();
    const rows = states
      .filter(s => s[5] !== null && s[6] !== null) // must have lon/lat
      .map(toRow);
    if (rows.length === 0) {
      console.log('[poll] no rows');
      return;
    }
    await upsertBatch(rows);
    console.log(`[poll] upserted ${rows.length} flights in ${Date.now() - t0}ms`);
  } catch (err) {
    console.error('[poll] error:', err);
  }
}

let running = true;
async function loop() {
  while (running) {
    await tick();
    await new Promise(r => setTimeout(r, pollMs));
  }
}

function shutdown(sig: string) {
  console.log(`[worker] received ${sig}, shutting down`);
  running = false;
  setTimeout(() => process.exit(0), 1000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log(`[worker] starting; polling every ${pollMs}ms${OPENSKY_BBOX ? ` bbox=${OPENSKY_BBOX}` : ' (global)'}`);
loop();
