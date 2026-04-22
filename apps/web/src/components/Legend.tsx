'use client';

const bands: Array<[string, string]> = [
  ['#38bdf8', '> 11 km (cruise)'],
  ['#34d399', '7 – 11 km'],
  ['#fbbf24', '3 – 7 km'],
  ['#fb923c', '1 – 3 km'],
  ['#f87171', '< 1 km'],
  ['#94a3b8', 'on ground'],
];

export default function Legend() {
  return (
    <div className="text-xs border-t border-slate-800 pt-3">
      <div className="text-slate-400 mb-1.5 font-medium">Altitude</div>
      <ul className="space-y-1">
        {bands.map(([color, label]) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ backgroundColor: color }}
            />
            <span className="text-slate-300">{label}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-800">
        <span className="inline-block w-3 h-3 rounded-full border-2 border-red-500 animate-pulse" />
        <span className="text-slate-300">emergency squawk</span>
      </div>
    </div>
  );
}
