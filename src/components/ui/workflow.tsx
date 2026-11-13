import type { ReactNode } from "react";
import Link from "next/link";
import { Check, CircleX } from "lucide-react";
import { formatDate } from "@/components/ui/primitives";

/**
 * The pieces every record page shares: where it is in its flow, what happened
 * to it, and the facts about it. Server components throughout.
 */

/** Date and time in India time — the network's working clock. */
export function fullDate(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
}

/**
 * Progress through a fixed flow. `reachedAt` gives the date each step was
 * reached, when known; `stopped` replaces the steps with the reason a record
 * left the flow (cancelled, rejected).
 */
export function Stepper({
  steps,
  current,
  reachedAt = {},
  complete = false,
  stopped,
  label = "Progress",
}: {
  steps: readonly string[];
  /** Index of the step the record is at. */
  current: number;
  reachedAt?: Record<string, string | undefined>;
  /** True when the last step is itself the finished state. */
  complete?: boolean;
  stopped?: { title: string; detail: ReactNode };
  label?: string;
}) {
  if (stopped) {
    return (
      <section aria-label={label} className="surface px-4 py-3.5">
        <p className="flex items-start gap-2 text-[13px]">
          <CircleX className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--negative)" }} />
          <span>
            <span className="font-semibold">{stopped.title}</span> <span style={{ color: "var(--fg-muted)" }}>{stopped.detail}</span>
          </span>
        </p>
      </section>
    );
  }
  const cols = steps.length <= 4 ? "sm:grid-cols-4" : steps.length === 5 ? "sm:grid-cols-5" : "sm:grid-cols-6";
  return (
    <section aria-label={label} className="surface px-4 py-3.5">
      <ol className={`grid gap-2 ${cols}`}>
        {steps.map((step, i) => {
          const done = i < current || (i === current && complete);
          const here = i === current && !complete;
          const at = reachedAt[step];
          return (
            <li key={step} className="flex items-center gap-2.5 sm:flex-col sm:items-start" aria-current={here ? "step" : undefined}>
              <span className="flex items-center gap-2 sm:w-full">
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                  style={
                    done
                      ? { background: "var(--brand)", color: "#0e2107" }
                      : here
                        ? { background: "var(--brand-soft)", color: "var(--brand-ink)", boxShadow: "0 0 0 2px var(--brand)" }
                        : { background: "var(--surface-subtle)", color: "var(--fg-faint)", border: "1px solid var(--border)" }
                  }
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                </span>
                {i < steps.length - 1 && (
                  <span className="hidden h-0.5 flex-1 rounded-full sm:block" style={{ background: i < current ? "var(--brand)" : "var(--border)" }} />
                )}
              </span>
              <span className="min-w-0">
                <span className={`block text-[12.5px] ${here ? "font-semibold" : ""}`} style={i > current ? { color: "var(--fg-faint)" } : undefined}>
                  {step}
                </span>
                <span className="block text-[11px]" style={{ color: "var(--fg-faint)" }}>
                  {at ? formatDate(at) : i > current ? "Not yet" : "—"}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** When each step was first reached, from a record's history. */
export function reachedFrom(history: ReadonlyArray<{ status: string; at: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of history) if (!out[e.status]) out[e.status] = e.at;
  return out;
}

export function Timeline({ events, empty = "Nothing recorded yet." }: { events: ReadonlyArray<{ status: string; at: string; by: string; note?: string }>; empty?: string }) {
  const newestFirst = [...events].reverse();
  if (!newestFirst.length) {
    return (
      <p className="text-[13px]" style={{ color: "var(--fg-muted)" }}>
        {empty}
      </p>
    );
  }
  return (
    <ol className="relative space-y-4 pl-5" style={{ borderLeft: "1px solid var(--border)" }}>
      {newestFirst.map((e, i) => (
        <li key={i} className="relative">
          <span
            className="absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full"
            style={{
              background: /Cancel|Reject|Objection|Fail/.test(e.status) ? "var(--negative)" : i === 0 ? "var(--brand)" : "var(--border-strong)",
              boxShadow: "0 0 0 3px var(--card)",
            }}
          />
          <p className="text-[13px] font-medium">{e.status}</p>
          <p className="text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
            {fullDate(e.at)} · {e.by}
          </p>
          {e.note && <p className="mt-1 text-[12px]">{e.note}</p>}
        </li>
      ))}
    </ol>
  );
}

/** Label / value rows for a side panel. */
export function Facts({ rows }: { rows: ReadonlyArray<readonly [ReactNode, ReactNode] | null | false | undefined | "" | 0> }) {
  return (
    <dl className="space-y-2 text-[12.5px]">
      {rows.filter(Boolean).map((row, i) => {
        const [label, value] = row as readonly [ReactNode, ReactNode];
        return (
          <div key={i} className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0" style={{ color: "var(--fg-muted)" }}>
              {label}
            </dt>
            <dd className="num min-w-0 text-right font-medium" style={{ overflowWrap: "anywhere" }}>
              {value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** Filter chips across the top of a table: "All", then one per value, each with its count. */
export function FilterChips({
  options,
  current,
  hrefFor,
  total,
}: {
  options: ReadonlyArray<{ value: string; label?: string; count: number }>;
  current: string | undefined;
  hrefFor: (value: string | undefined) => string;
  total: number;
}) {
  const chip = (value: string | undefined, label: string, count: number) => {
    const selected = current === value;
    return (
      <Link
        key={value ?? "all"}
        href={hrefFor(value)}
        aria-current={selected ? "true" : undefined}
        className="rounded-full px-3 py-1 text-[12px] font-medium transition-colors"
        style={
          selected
            ? { background: "var(--brand-soft)", color: "var(--brand-ink)", border: "1px solid color-mix(in srgb, var(--brand) 35%, transparent)" }
            : { border: "1px solid var(--border)", color: "var(--fg-muted)" }
        }
      >
        {label} <span className="num opacity-70">{count}</span>
      </Link>
    );
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
      {chip(undefined, "All", total)}
      {options.map((o) => chip(o.value, o.label ?? o.value, o.count))}
    </div>
  );
}

/** `/path?a=1&b=2` from the params that are set. */
export function withParams(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const s = query.toString();
  return s ? `${path}?${s}` : path;
}

/** Tabs that are links — each tab is its own route, so the back button and deep links work. */
export function Tabs({ tabs, current }: { tabs: ReadonlyArray<{ href: string; label: string; count?: number }>; current: string }) {
  return (
    <nav aria-label="Sections" className="flex flex-wrap gap-1 border-b" style={{ borderColor: "var(--border)" }}>
      {tabs.map((t) => {
        const active = t.href === current;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className="-mb-px rounded-t-[8px] px-3.5 py-2 text-[13px] font-medium transition-colors hover:text-[color:var(--fg)]"
            style={
              active
                ? { color: "var(--brand-ink)", borderBottom: "2px solid var(--brand)" }
                : { color: "var(--fg-muted)", borderBottom: "2px solid transparent" }
            }
          >
            {t.label}
            {t.count !== undefined && <span className="num ml-1.5 text-[11.5px] opacity-70">{t.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/** A small caption under a primary action button. */
export function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
      {children}
    </p>
  );
}

/** Honest label on anything that stands in for an external system. */
export function SimulatedNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-[10px] px-3 py-2 text-[11.5px] leading-snug" style={{ background: "var(--surface-subtle)", color: "var(--fg-muted)", border: "1px dashed var(--border)" }}>
      {children}
    </p>
  );
}
