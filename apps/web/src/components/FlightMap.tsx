'use client';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import type { Flight } from '@/lib/types';
import FlightPopup from './FlightPopup';
import WeatherLayer from './WeatherLayer';

const EMERGENCY_SQUAWKS = new Set(['7500', '7600', '7700']);

// Color by altitude band (meters). Ground → red, mid → amber, cruise → sky.
function altitudeColor(alt: number | null, onGround: boolean | null): string {
  if (onGround) return '#94a3b8';
  if (alt == null) return '#94a3b8';
  if (alt < 1000) return '#f87171';
  if (alt < 3000) return '#fb923c';
  if (alt < 7000) return '#fbbf24';
  if (alt < 11000) return '#34d399';
  return '#38bdf8';
}

function planeIcon(f: Flight): L.DivIcon {
  const color = altitudeColor(f.baro_altitude, f.on_ground);
  const emergency = f.squawk && EMERGENCY_SQUAWKS.has(f.squawk);
  const heading = f.true_track ?? 0;
  const ring = emergency
    ? `<circle cx='0' cy='0' r='14' fill='none' stroke='#ef4444' stroke-width='2' opacity='0.9'><animate attributeName='r' values='10;18;10' dur='1s' repeatCount='indefinite'/><animate attributeName='opacity' values='1;0;1' dur='1s' repeatCount='indefinite'/></circle>`
    : '';
  const svg = `
    <svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='-14 -14 28 28'>
      ${ring}
      <g style='transform: rotate(${heading}deg); transform-origin: 0 0; transition: transform 0.4s linear;'>
        <path d='M0,-10 L3,3 L10,6 L3,6 L0,10 L-3,6 L-10,6 L-3,3 Z'
              fill='${color}' stroke='#0f172a' stroke-width='1'/>
      </g>
    </svg>`;
  return L.divIcon({
    html: svg,
    className: 'plane-icon',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

// Dead-reckon the position between worker refreshes using the plane's own
// velocity + heading. last-known position becomes the integration origin;
// every 1s tick nudges the marker forward along its track, so planes visibly
// move between upserts instead of freezing. Capped at 120 s to avoid runaway
// predictions on stale rows (a landed or out-of-coverage plane).
const PROJECT_CAP_S = 120;
function projectPos(f: Flight, nowMs: number): [number, number] | null {
  if (f.latitude == null || f.longitude == null) return null;
  if (f.on_ground || f.velocity == null || f.true_track == null || !f.updated_at) {
    return [f.latitude, f.longitude];
  }
  const updatedMs = Date.parse(f.updated_at);
  if (!updatedMs) return [f.latitude, f.longitude];
  const elapsedS = Math.max(0, Math.min((nowMs - updatedMs) / 1000, PROJECT_CAP_S));
  const dist = f.velocity * elapsedS; // meters
  const hdg = (f.true_track * Math.PI) / 180;
  const latRad = (f.latitude * Math.PI) / 180;
  const dLat = (dist * Math.cos(hdg)) / 111_000;
  const dLon = (dist * Math.sin(hdg)) / (111_000 * Math.cos(latRad));
  return [f.latitude + dLat, f.longitude + dLon];
}

function Recenter({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom, { animate: true });
  }, [map, center[0], center[1], zoom]);
  return null;
}

type Trail = Array<[number, number]>;
const TRAIL_MAX = 30;

export default function FlightMap({
  flights,
  center,
  zoom,
  showWeather = true,
}: {
  flights: Flight[];
  center: [number, number];
  zoom: number;
  showWeather?: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const trailsRef = useRef<Map<string, Trail>>(new Map());
  const [, forceTick] = useState(0);
  // Re-render every second so dead-reckoned positions advance visibly.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Append the current position of every flight to its in-memory trail on every
  // render. The realtime stream in MapClient mutates `flights` in place, so a
  // new reference means new positions arrived.
  useEffect(() => {
    const trails = trailsRef.current;
    const seen = new Set<string>();
    for (const f of flights) {
      if (f.latitude == null || f.longitude == null) continue;
      seen.add(f.icao24);
      const t = trails.get(f.icao24) ?? [];
      const last = t[t.length - 1];
      if (!last || last[0] !== f.latitude || last[1] !== f.longitude) {
        t.push([f.latitude, f.longitude]);
        if (t.length > TRAIL_MAX) t.shift();
        trails.set(f.icao24, t);
      }
    }
    // Drop trails for planes that fell out of the viewport / dataset.
    for (const k of trails.keys()) if (!seen.has(k)) trails.delete(k);
    forceTick(n => n + 1);
  }, [flights]);

  const selectedTrail = useMemo(
    () => (selected ? trailsRef.current.get(selected) ?? [] : []),
    [selected, flights],
  );

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      style={{ height: '100%', width: '100%', minHeight: '70vh' }}
      scrollWheelZoom
      zoomControl
    >
      <TileLayer
        attribution='&copy; OpenStreetMap contributors &copy; CARTO'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      {showWeather && <WeatherLayer opacity={0.55} />}
      <Recenter center={center} zoom={zoom} />

      {selected && selectedTrail.length > 1 && (
        <Polyline
          positions={selectedTrail}
          pathOptions={{ color: '#38bdf8', weight: 3, opacity: 0.85, dashArray: '4 4' }}
        />
      )}

      {flights.map(f => {
        const pos = projectPos(f, nowMs);
        if (!pos) return null;
        return (
          <Marker
            key={f.icao24}
            position={pos}
            icon={planeIcon(f)}
            eventHandlers={{
              click: () => setSelected(f.icao24),
              popupclose: () => setSelected(s => (s === f.icao24 ? null : s)),
            }}
          >
            <Popup maxWidth={280}>
              <FlightPopup f={f} />
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}
