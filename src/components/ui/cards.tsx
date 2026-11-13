import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

/**
 * The card vocabulary the dashboard and module screens are built from. All
 * server components — plain markup on the app's tokens, no client JS.
 */

export type MetricTone = "neutral" | "positive" | "negative" | "warning" | "info";

const TONE_CHIP: Record<MetricTone, { background: string; color: string }> = {
  neutral: { background: "var(--surface-subtle)", color: "var(--fg-muted)" },
  positive: { background: "var(--positive-surface)", color: "var(--positive)" },
  negative: { background: "var(--negative-surface)", color: "var(--negative)" },
  warning: { background: "var(--warning-surface)", color: "var(--warning)" },
  info: { background: "var(--info-surface)", color: "var(--info)" },
};

const TONE_TEXT: Record<MetricTone, string> = {
  neutral: "var(--fg-muted)",
  positive: "var(--positive)",
  negative: "var(--negative)",
  warning: "var(--warning)",
  info: "var(--info)",
};

/**
 * A headline number on a plain card. `tone` colours only the icon chip and
 * the hint, so colour always means something. With `href`, the whole card
 * links to the screen behind it.
 */
export function MetricCard({
  label,
  value,
  hint,
  tone = "neutral",
  icon: Icon,
  href,
  className = "",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: MetricTone;
  icon?: LucideIcon;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: "var(--fg-faint)" }}>
          {label}
        </p>
        {Icon && (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]" style={TONE_CHIP[tone]}>
            <Icon aria-hidden className="h-4 w-4" />
          </span>
        )}
      </div>
      <p className="num mt-2 truncate text-[24px] font-bold leading-none tracking-tight" title={typeof value === "string" ? value : undefined}>
        {value}
      </p>
      {hint && (
        <p className="mt-2 text-[11.5px] font-medium leading-4" style={{ color: TONE_TEXT[tone] }}>
          {hint}
        </p>
      )}
    </>
  );

  const shell = `surface flex min-w-0 flex-col px-4 py-3.5 ${className}`;

  return href ? (
    <Link href={href} className={`${shell} card-link`}>
      {body}
    </Link>
  ) : (
    <section className={shell}>{body}</section>
  );
}

/**
 * A titled panel: header, body, and an optional footer action that links to
 * the full screen behind the summary.
 */
export function Panel({
  title,
  description,
  action,
  children,
  className = "",
  bodyClassName = "",
  headerExtra,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: { href: string; label: string };
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Right-aligned header content — a tag, a total. */
  headerExtra?: ReactNode;
}) {
  return (
    <section className={`surface flex h-full min-w-0 flex-col overflow-hidden ${className}`}>
      <header className="flex items-start justify-between gap-3 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="min-w-0">
          <h2 className="truncate text-[14px] font-semibold leading-5">{title}</h2>
          {description && (
            <p className="mt-0.5 text-[12px] leading-snug" style={{ color: "var(--fg-muted)" }}>
              {description}
            </p>
          )}
        </div>
        {headerExtra && <div className="shrink-0">{headerExtra}</div>}
      </header>
      <div className={`flex min-w-0 flex-1 flex-col p-4 ${bodyClassName}`}>{children}</div>
      {action && (
        <div className="px-3 pb-3 pt-2.5" style={{ borderTop: "1px solid var(--border)" }}>
          <Link
            href={action.href}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[9px] text-[12.5px] font-semibold outline-none transition-colors hover:bg-[color:var(--hover)] focus-visible:shadow-[0_0_0_2px_color-mix(in_srgb,var(--brand)_45%,transparent)]"
            style={{ color: "var(--brand-ink)" }}
          >
            {action.label}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </section>
  );
}

/** A shortcut into a workspace, carrying one live line about it. */
export function ModuleCard({ title, detail, href, icon: Icon }: { title: string; detail: string; href: string; icon: LucideIcon }) {
  return (
    <Link href={href} className="surface card-link flex min-w-0 items-center gap-3 px-3.5 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]" style={{ background: "var(--brand-soft)", color: "var(--brand-ink)" }}>
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-4" style={{ color: "var(--fg-muted)" }}>
          {detail}
        </span>
      </span>
    </Link>
  );
}

/** Small bordered figures in a grid — the supporting numbers under a chart. */
export function MetricTiles({ items, columns = 2, className = "" }: { items: Array<{ label: string; value: ReactNode }>; columns?: number; className?: string }) {
  return (
    <div className={`rounded-[12px] p-2 ${className}`} style={{ border: "1px solid var(--border)" }}>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {items.map((item) => (
          <div key={item.label} className="min-w-0 rounded-[9px] px-3 py-2.5" style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}>
            <p className="truncate text-[11px] leading-4" style={{ color: "var(--fg-muted)" }}>
              {item.label}
            </p>
            <p className="num mt-1 truncate text-[18px] font-bold leading-none">{item.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Three-quarter ring showing one ratio. */
export function RatioGauge({ value, caption, size = 140, emphasis = "neutral" }: { value: number; caption?: ReactNode; size?: number; emphasis?: "neutral" | "warning" }) {
  const safe = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const arc = circumference * 0.75;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${Math.round(safe)} percent`} style={{ transform: "rotate(135deg)" }}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--chart-track)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${arc} ${circumference}`} />
          {safe > 0 && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={emphasis === "warning" ? "var(--warning)" : "var(--brand)"}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${(arc * safe) / 100} ${circumference}`}
            />
          )}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="num text-[26px] font-bold leading-none">
            {Math.round(safe)}
            <span className="text-[15px] font-medium" style={{ color: "var(--fg-muted)" }}>
              %
            </span>
          </span>
        </div>
      </div>
      {caption && (
        <p className="-mt-3 text-center text-[12px] leading-4" style={{ color: "var(--fg-muted)" }}>
          {caption}
        </p>
      )}
    </div>
  );
}

/** Labelled horizontal bars scaled to the largest value — shares, progress, ranking. */
export function MagnitudeBars({
  data,
  max,
}: {
  data: Array<{ key: string; label: string; value: number; display: string; meta?: string; muted?: boolean }>;
  /** Scale against this instead of the largest value (e.g. 100 for percentages). */
  max?: number;
}) {
  const scale = max ?? Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="flex flex-col gap-3">
      {data.map((d) => (
        <li key={d.key}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-[12.5px]">
              <span className="font-medium">{d.label}</span>
              {d.meta && <span style={{ color: "var(--fg-muted)" }}> · {d.meta}</span>}
            </span>
            <span className="num shrink-0 text-[12.5px] font-semibold">{d.display}</span>
          </div>
          <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-[3px]" style={{ background: "var(--chart-track)" }}>
            <div
              className="h-full"
              style={{
                width: `${Math.max(1.5, Math.min(100, (d.value / scale) * 100))}%`,
                background: d.muted ? "var(--viz-3)" : "var(--brand)",
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
