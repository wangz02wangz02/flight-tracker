import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, POLL_INTERVAL_MS } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const pollMs = Number(POLL_INTERVAL_MS ?? 15_000);

// adsb.lol /v2/point/{lat}/{lon}/{radius_nm} — radius capped at 250 nm. No auth,
// no rate limit. We cover the major traffic regions with overlapping circles.
// Aircraft present in multiple circles dedupe on icao24 upsert downstream.
const POINTS: Array<{ lat: number; lon: number; dist: number; name: string }> = [
  { lat: 40, lon: -95, dist: 250, name: 'US-Central' },
  { lat: 40, lon: -75, dist: 250, name: 'US-East' },
  { lat: 35, lon: -115, dist: 250, name: 'US-West' },
  { lat: 25, lon: -80, dist: 250, name: 'US-South' },
  { lat: 50, lon: 10, dist: 250, name: 'EU-Central' },
  { lat: 51, lon: 0, dist: 250, name: 'UK' },
  { lat: 41, lon: 2, dist: 250, name: 'Iberia/Med' },
  { lat: 55, lon: 37, dist: 250, name: 'Moscow' },
  { lat: 35, lon: 139, dist: 250, name: 'Japan' },
  { lat: 22, lon: 114, dist: 250, name: 'HK/PRD' },
  { lat: 39, lon: 117, dist: 250, name: 'N-China' },
  { lat: 1, lon: 104, dist: 250, name: 'Singapore' },
  { lat: -33, lon: 151, dist: 250, name: 'Sydney' },
  { lat: 19, lon: 73, dist: 250, name: 'India' },
  { lat: 25, lon: 55, dist: 250, name: 'Dubai' },
  { lat: -23, lon: -46, dist: 250, name: 'Sao Paulo' },
  { lat: 19, lon: -99, dist: 250, name: 'Mexico City' },
  { lat: -34, lon: 18, dist: 250, name: 'Cape Town' },
];

// adsb.lol aircraft shape (only the fields we care about).
type AdsbAircraft = {
  hex: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | 'ground';
  gs?: number;
  track?: number;
  baro_rate?: number;
  squawk?: string;
  emergency?: string;
  r?: string;
  t?: string;
  seen_pos?: number;
};

type AdsbResponse = { ac?: AdsbAircraft[] };

async function fetchPoint(p: (typeof POINTS)[number]): Promise<AdsbAircraft[]> {
  const url = `https://api.adsb.lol/v2/point/${p.lat}/${p.lon}/${p.dist}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'flight-tracker/1.0' } });
  if (!res.ok) throw new Error(`adsb.lol ${p.name} ${res.status}`);
  const data = (await res.json()) as AdsbResponse;
  return data.ac ?? [];
}

// Feet → meters
const ftToM = (ft: number) => ft * 0.3048;
// Knots → m/s
const ktToMs = (kt: number) => kt * 0.514444;
// ft/min → m/s
const fpmToMs = (fpm: number) => fpm * 0.00508;

function toRow(a: AdsbAircraft) {
  const altFt = typeof a.alt_baro === 'number' ? a.alt_baro : null;
  const onGround = a.alt_baro === 'ground';
  const lastContact = a.seen_pos
    ? new Date(Date.now() - a.seen_pos * 1000).toISOString()
    : new Date().toISOString();
  return {
    icao24: a.hex.toLowerCase(),
    callsign: a.flight?.trim() || null,
    origin_country: null as string | null,
    last_contact: lastContact,
    longitude: a.lon ?? null,
    latitude: a.lat ?? null,
    baro_altitude: altFt != null ? ftToM(altFt) : null,
    on_ground: onGround,
    velocity: a.gs != null ? ktToMs(a.gs) : null,
    true_track: a.track ?? null,
    vertical_rate: a.baro_rate != null ? fpmToMs(a.baro_rate) : null,
    squawk: a.squawk ?? null,
    updated_at: new Date().toISOString(),
  };
}

async function upsertBatch(rows: ReturnType<typeof toRow>[]) {
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
    const results = await Promise.allSettled(POINTS.map(fetchPoint));
    const seen = new Map<string, AdsbAircraft>();
    let failures = 0;
    for (const r of results) {
      if (r.status === 'rejected') {
        failures++;
        continue;
      }
      for (const a of r.value) {
        if (a.lat == null || a.lon == null) continue;
        // Dedupe — aircraft in overlapping circles.
        seen.set(a.hex.toLowerCase(), a);
      }
    }
    const rows = Array.from(seen.values()).map(toRow);
    if (rows.length === 0) {
      console.warn(`[poll] 0 rows (${failures} region fetch failures)`);
      return;
    }
    await upsertBatch(rows);
    console.log(
      `[poll] upserted ${rows.length} flights in ${Date.now() - t0}ms (${failures} region failures)`,
    );
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

console.log(
  `[worker] starting; source=adsb.lol points=${POINTS.length} poll=${pollMs}ms`,
);
loop();
