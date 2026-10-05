import { type CSSProperties, useId, useState } from 'react';

export function Sparkline({
  points,
  color,
  label,
}: {
  points: { day: string; value: number }[];
  color: string;
  label: string;
}) {
  const gradient = useId();
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...points.map((point) => point.value));
  const coords = points.map((point, index) => ({
    x: 5 + (index / Math.max(1, points.length - 1)) * 110,
    y: 48 - (point.value / max) * 40,
  }));
  const path = coords.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ');
  const current = active === null ? undefined : points[active];
  return (
    <div className="metric-chart" style={{ '--chart-color': color } as CSSProperties}>
      <svg viewBox="0 0 120 54" aria-hidden="true">
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${path} L115,54 L5,54 Z`} fill={`url(#${gradient})`} />
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {active !== null && coords[active] && (
          <circle cx={coords[active].x} cy={coords[active].y} r="3" fill={color} />
        )}
      </svg>
      <div className="chart-targets">
        {points.map((point, index) => (
          <button
            type="button"
            key={point.day}
            aria-label={`${point.day}: ${point.value} ${label}`}
            onPointerEnter={() => setActive(index)}
            onPointerLeave={() => setActive(null)}
            onFocus={() => setActive(index)}
            onBlur={() => setActive(null)}
            onClick={() => setActive(active === index ? null : index)}
          />
        ))}
      </div>
      {current && (
        <div className="chart-tooltip" role="status">
          <span>{current.day}</span>
          <b>
            {current.value} {label}
          </b>
        </div>
      )}
    </div>
  );
}
export function MetricMeter({
  value,
  max,
  label,
  color,
}: {
  value: number;
  max: number;
  label: string;
  color: string;
}) {
  return (
    <meter
      className="metric-meter"
      min={0}
      max={max}
      value={value}
      style={{ '--meter-color': color } as CSSProperties}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.max(0, Math.min(max, value))}
    ></meter>
  );
}
