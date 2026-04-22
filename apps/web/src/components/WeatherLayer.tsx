'use client';
import { TileLayer } from 'react-leaflet';
import { useEffect, useState } from 'react';

/**
 * Global weather radar overlay. Pulls the latest tile manifest from
 * RainViewer (free, no API key) and renders it as a semi-transparent
 * Leaflet TileLayer above the base map.
 * Docs: https://www.rainviewer.com/api.html
 */
type Frame = { time: number; path: string };
type Manifest = {
  host: string;
  radar: { past: Frame[]; nowcast: Frame[] };
};

export default function WeatherLayer({ opacity = 0.55 }: { opacity?: number }) {
  const [frame, setFrame] = useState<{ host: string; path: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await fetch('https://api.rainviewer.com/public/weather-maps.json');
        if (!r.ok) return;
        const m = (await r.json()) as Manifest;
        const latest = m.radar.past[m.radar.past.length - 1];
        if (!cancelled && latest) setFrame({ host: m.host, path: latest.path });
      } catch (e) {
        console.error('[weather] failed to load manifest', e);
      }
    }
    load();
    // refresh every 5 min; RainViewer publishes new frames every ~10 min.
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!frame) return null;
  // color scheme 2 = Universal Blue, smooth=1, snow=1
  const url = `${frame.host}${frame.path}/256/{z}/{x}/{y}/2/1_1.png`;
  return (
    <TileLayer
      url={url}
      opacity={opacity}
      attribution='&copy; <a href="https://rainviewer.com/">RainViewer</a>'
    />
  );
}
