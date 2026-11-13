"use client";

import { useId, useState } from "react";
import { formatINR } from "@/components/ui/primitives";

/**
 * Two-series smoothed area chart — the "cashflow" panel of the reference
 * dashboard, here showing dealer order intake against billing. Hand-rolled
 * SVG rather than a charting library: it is one shape, and a library would
 * be the largest dependency in the app.
 */

interface AreaPoint {
  label: string;
  intake: number;
  billed: number;
}

const SERIES = [
  { key: "intake" as const, label: "Order intake", color: "var(--viz-1)" },
  { key: "billed" as const, label: "Billed", color: "var(--viz-2)" },
];

export default function AreaChart({ data, height = 230 }: { data: AreaPoint[]; height?: number }) {
  const gradId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const width = 680;
  const padX = 12;
  const padTop = 14;
  const padBottom = 26;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBottom;

  const max = Math.max(1, ...data.flatMap((d) => [d.intake, d.billed]));
  const n = data.length;
  const xAt = (i: number) => padX + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const yAt = (v: number) => padTop + plotH - (v / max) * plotH;

  // Monotone cubic: the line passes through every dot and never overshoots
  // between them, so a run of zero days stays on the baseline.
  const linePath = (key: "intake" | "billed") => {
    const pts = data.map((d, i) => [xAt(i), yAt(d[key])] as const);
    if (pts.length < 2) return pts.length ? `M ${pts[0][0]} ${pts[0][1]}` : "";
    const slopes = pts.slice(1).map(([x1, y1], i) => (y1 - pts[i][1]) / (x1 - pts[i][0]));
    const tangents = pts.map((_, i) => {
      if (i === 0) return slopes[0];
      if (i === pts.length - 1) return slopes[i - 1];
      const [s0, s1] = [slopes[i - 1], slopes[i]];
      return (Math.sign(s0) + Math.sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.25 * Math.abs(s0 + s1));
    });
    let path = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const h = (x1 - x0) / 3;
      path += ` C ${x0 + h} ${y0 + tangents[i] * h} ${x1 - h} ${y1 - tangents[i + 1] * h} ${x1} ${y1}`;
    }
    return path;
  };

  const areaPath = (key: "intake" | "billed") => {
    const line = linePath(key);
    if (!line) return "";
    return `${line} L ${xAt(n - 1)} ${padTop + plotH} L ${xAt(0)} ${padTop + plotH} Z`;
  };

  return (
    <div className="relative">
      <ul className="mb-2 flex flex-wrap items-center gap-4 px-1">
        {SERIES.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
            <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
            {s.label}
          </li>
        ))}
      </ul>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`Order intake and billing over the last ${n} days`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {SERIES.map((s, i) => (
            <linearGradient key={s.key} id={`${gradId}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.26} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>

        {SERIES.map((s, i) => (
          <path key={`a-${s.key}`} d={areaPath(s.key)} fill={`url(#${gradId}-${i})`} />
        ))}
        {SERIES.map((s) => (
          <path key={`l-${s.key}`} d={linePath(s.key)} fill="none" stroke={s.color} strokeWidth={2.25} strokeLinecap="round" />
        ))}

        {hover != null && (
          <line x1={xAt(hover)} x2={xAt(hover)} y1={padTop} y2={padTop + plotH} stroke="var(--fg-faint)" strokeWidth={1} strokeDasharray="3 3" />
        )}

        {SERIES.map((s) =>
          data.map((d, i) => (
            <circle
              key={`${s.key}-${i}`}
              cx={xAt(i)}
              cy={yAt(d[s.key])}
              r={hover === i ? 4.5 : 2.5}
              fill={s.color}
              stroke="var(--card)"
              strokeWidth={1.5}
            />
          ))
        )}

        {data.map((d, i) => (
          <rect
            key={d.label + i}
            x={xAt(i) - plotW / n / 2}
            y={padTop}
            width={plotW / n}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}

        {data.map((d, i) => (
          <text key={`t-${i}`} x={xAt(i)} y={height - 7} textAnchor="middle" fontSize={10.5} fill="var(--fg-faint)">
            {d.label}
          </text>
        ))}
      </svg>

      {hover != null && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-[8px] px-2.5 py-2 text-[11px] leading-snug shadow-lg"
          style={{
            left: `${(xAt(hover) / width) * 100}%`,
            top: `${(Math.min(yAt(data[hover].intake), yAt(data[hover].billed)) / height) * 100}%`,
            background: "var(--fg)",
            color: "var(--card)",
            marginTop: -10,
            whiteSpace: "nowrap",
          }}
        >
          <div className="font-semibold">{data[hover].label}</div>
          <div>Intake {formatINR(data[hover].intake)}</div>
          <div>Billed {formatINR(data[hover].billed)}</div>
        </div>
      )}
    </div>
  );
}
