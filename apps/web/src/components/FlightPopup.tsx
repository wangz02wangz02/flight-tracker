'use client';
import { useEffect, useState } from 'react';
import type { Flight } from '@/lib/types';
import FavoriteButton from './FavoriteButton';

type Photo = { thumbnail_large: { src: string }; link: string; photographer: string };
type Route = { dep: string | null; arr: string | null };

const photoCache = new Map<string, Photo | null>();
const routeCache = new Map<string, Route | null>();

async function fetchPhoto(icao24: string): Promise<Photo | null> {
  if (photoCache.has(icao24)) return photoCache.get(icao24)!;
  try {
    const r = await fetch(`https://api.planespotters.net/pub/photos/hex/${icao24}`);
    if (!r.ok) throw new Error(`planespotters ${r.status}`);
    const j = await r.json();
    const p = (j.photos?.[0] ?? null) as Photo | null;
    photoCache.set(icao24, p);
    return p;
  } catch {
    photoCache.set(icao24, null);
    return null;
  }
}

async function fetchRoute(icao24: string): Promise<Route | null> {
  if (routeCache.has(icao24)) return routeCache.get(icao24)!;
  const end = Math.floor(Date.now() / 1000);
  const begin = end - 60 * 60 * 24 * 7; // last 7 days
  try {
    const r = await fetch(
      `https://opensky-network.org/api/flights/aircraft?icao24=${icao24}&begin=${begin}&end=${end}`,
    );
    if (!r.ok) throw new Error(`opensky ${r.status}`);
    const flights = (await r.json()) as Array<{
      estDepartureAirport: string | null;
      estArrivalAirport: string | null;
      lastSeen: number;
    }>;
    if (!flights.length) {
      routeCache.set(icao24, null);
      return null;
    }
    const latest = flights.sort((a, b) => b.lastSeen - a.lastSeen)[0];
    const route: Route = { dep: latest.estDepartureAirport, arr: latest.estArrivalAirport };
    routeCache.set(icao24, route);
    return route;
  } catch {
    routeCache.set(icao24, null);
    return null;
  }
}

function squawkLabel(sq: string | null): string | null {
  if (sq === '7500') return 'HIJACK';
  if (sq === '7600') return 'RADIO FAIL';
  if (sq === '7700') return 'EMERGENCY';
  return null;
}

export default function FlightPopup({ f }: { f: Flight }) {
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [loadingPhoto, setLoadingPhoto] = useState(true);
  const [route, setRoute] = useState<Route | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(true);
  const sq = squawkLabel(f.squawk);

  useEffect(() => {
    let cancelled = false;
    setLoadingPhoto(true);
    fetchPhoto(f.icao24).then(p => {
      if (!cancelled) {
        setPhoto(p);
        setLoadingPhoto(false);
      }
    });
    setLoadingRoute(true);
    fetchRoute(f.icao24).then(r => {
      if (!cancelled) {
        setRoute(r);
        setLoadingRoute(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [f.icao24]);

  return (
    <div className="text-sm text-slate-900 space-y-2 min-w-[240px]">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-base">{f.callsign?.trim() || f.icao24}</div>
        {sq && (
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white animate-pulse">
            {sq}
          </span>
        )}
      </div>

      {loadingPhoto ? (
        <div className="h-24 rounded bg-slate-200 animate-pulse" />
      ) : photo ? (
        <a href={photo.link} target="_blank" rel="noreferrer" className="block">
          <img
            src={photo.thumbnail_large.src}
            alt={f.callsign ?? f.icao24}
            className="w-full rounded object-cover max-h-32"
          />
          <div className="text-[10px] text-slate-500 mt-0.5">© {photo.photographer}</div>
        </a>
      ) : (
        <div className="h-16 rounded bg-slate-100 text-slate-400 text-xs flex items-center justify-center">
          No photo on planespotters.net
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
        <div className="text-slate-500">Country</div>
        <div>{f.origin_country ?? '—'}</div>
        <div className="text-slate-500">Altitude</div>
        <div>{f.baro_altitude ? `${Math.round(f.baro_altitude)} m` : '—'}</div>
        <div className="text-slate-500">Speed</div>
        <div>{f.velocity ? `${Math.round(f.velocity * 3.6)} km/h` : '—'}</div>
        <div className="text-slate-500">Heading</div>
        <div>{f.true_track != null ? `${Math.round(f.true_track)}°` : '—'}</div>
        <div className="text-slate-500">Vertical</div>
        <div>
          {f.vertical_rate != null
            ? `${f.vertical_rate > 0.5 ? '↑' : f.vertical_rate < -0.5 ? '↓' : '→'} ${Math.abs(
                Math.round(f.vertical_rate),
              )} m/s`
            : '—'}
        </div>
        <div className="text-slate-500">Squawk</div>
        <div>{f.squawk ?? '—'}</div>
      </div>

      <div className="text-xs border-t border-slate-200 pt-2">
        <div className="text-slate-500 mb-0.5">Recent route</div>
        {loadingRoute ? (
          <div className="text-slate-400">Looking up…</div>
        ) : route ? (
          <div className="font-mono">
            {route.dep ?? '???'} <span className="text-slate-400">→</span> {route.arr ?? '???'}
          </div>
        ) : (
          <div className="text-slate-400">No recent flight on record</div>
        )}
      </div>

      <FavoriteButton icao24={f.icao24} label={f.callsign ?? null} />
    </div>
  );
}
