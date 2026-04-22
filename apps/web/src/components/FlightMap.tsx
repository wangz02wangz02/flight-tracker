'use client';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useEffect } from 'react';
import 'leaflet/dist/leaflet.css';
import type { Flight } from '@/lib/types';
import FavoriteButton from './FavoriteButton';
import WeatherLayer from './WeatherLayer';

// A small plane icon, rotated by heading. SVG inlined as data URI.
function planeIcon(heading: number) {
  const svg = `
    <svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='-12 -12 24 24'
         style='transform: rotate(${heading}deg); transform-origin: 50% 50%;'>
      <path d='M0,-10 L3,3 L10,6 L3,6 L0,10 L-3,6 L-10,6 L-3,3 Z'
            fill='#38bdf8' stroke='#0f172a' stroke-width='1'/>
    </svg>`;
  return L.divIcon({
    html: svg,
    className: 'plane-icon',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

function Recenter({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom, { animate: true });
  }, [map, center[0], center[1], zoom]);
  return null;
}

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
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      style={{ height: '100%', width: '100%', minHeight: '70vh' }}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; OpenStreetMap contributors &copy; CARTO'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      {showWeather && <WeatherLayer opacity={0.55} />}
      <Recenter center={center} zoom={zoom} />
      {flights.map(f =>
        f.latitude != null && f.longitude != null ? (
          <Marker
            key={f.icao24}
            position={[f.latitude, f.longitude]}
            icon={planeIcon(f.true_track ?? 0)}
          >
            <Popup>
              <div className="text-sm text-slate-900 space-y-1">
                <div className="font-semibold">{f.callsign?.trim() || f.icao24}</div>
                <div>Country: {f.origin_country}</div>
                <div>Altitude: {f.baro_altitude ? `${Math.round(f.baro_altitude)} m` : '—'}</div>
                <div>Speed: {f.velocity ? `${Math.round(f.velocity * 3.6)} km/h` : '—'}</div>
                <div>Heading: {f.true_track ? `${Math.round(f.true_track)}°` : '—'}</div>
                <FavoriteButton icao24={f.icao24} label={f.callsign ?? null} />
              </div>
            </Popup>
          </Marker>
        ) : null,
      )}
    </MapContainer>
  );
}
