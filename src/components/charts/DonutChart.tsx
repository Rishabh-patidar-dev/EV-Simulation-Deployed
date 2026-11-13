"use client";

import { useState } from "react";
import { formatINR } from "@/components/ui/primitives";

/**
 * Thin-ring donut with a legend down the side — the "breakdown" panel of the
 * reference dashboard. Fixed categorical hue order (--viz-1..6, never
 * reassigned between renders) so a colour means the same category on every
 * screen in the app.
 */

interface DonutDatum {
  label: string;
  value: number;
}

const COLORS = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)", "var(--viz-5)", "var(--viz-6)"];

export default function DonutChart({
  data,
  size = 168,
  thickness = 20,
  centerLabel,
  format = "count",
}: {
  data: DonutDatum[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  /** Named rather than a function: most callers are server components, and a
      function prop cannot cross the server/client boundary. */
  format?: "count" | "inr";
}) {
  const formatValue = format === "inr" ? formatINR : (v: number) => v.toLocaleString("en-IN");
  const [hover, setHover] = useState<number | null>(null);

  const total = data.reduce((s, d) => s + d.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = 3;

  // Each segment starts where the previous one ended, so the running offset is
  // carried through a reduce rather than mutated from inside a map.
  const segments = data.reduce<Array<DonutDatum & { index: number; color: string; dash: number; dashOffset: number }>>(
    (acc, d, i) => {
      const consumed = acc.reduce((sum, s) => sum + (total > 0 ? (s.value / total) * circumference : 0), 0);
      const length = total > 0 ? (d.value / total) * circumference : 0;
      acc.push({ ...d, index: i, color: COLORS[i % COLORS.length], dash: Math.max(0, length - gap), dashOffset: -consumed });
      return acc;
    },
    []
  );

  const shown = hover != null ? data[hover] : null;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`Donut chart: ${data.map((d) => `${d.label} ${formatValue(d.value)}`).join(", ")}`}
        >
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border)" strokeWidth={thickness} opacity={total === 0 ? 1 : 0.5} />
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {segments
              .filter((s) => s.value > 0)
              .map((s) => (
                <circle
                  key={s.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={hover === s.index ? thickness + 4 : thickness}
                  strokeDasharray={`${s.dash} ${circumference - s.dash}`}
                  strokeDashoffset={s.dashOffset}
                  strokeLinecap="round"
                  style={{ transition: "stroke-width 120ms ease", cursor: "pointer" }}
                  onMouseEnter={() => setHover(s.index)}
                  onMouseLeave={() => setHover(null)}
                />
              ))}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
          <span className="num text-[17px] font-semibold leading-tight">{formatValue(shown ? shown.value : total)}</span>
          <span className="mt-0.5 line-clamp-2 text-[10.5px] leading-tight" style={{ color: "var(--fg-muted)" }}>
            {shown ? shown.label : centerLabel}
          </span>
        </div>
      </div>

      <ul className="min-w-[150px] flex-1 space-y-2">
        {data.map((d, i) => {
          const share = total > 0 ? Math.round((d.value / total) * 100) : 0;
          return (
            <li
              key={d.label}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              className="flex items-center gap-2.5 text-[12.5px]"
            >
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
              <span className="min-w-0 flex-1 truncate">{d.label}</span>
              <span className="num shrink-0 tabular-nums" style={{ color: "var(--fg-muted)" }}>
                {formatValue(d.value)}
              </span>
              <span className="num w-9 shrink-0 text-right font-semibold">{share}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
