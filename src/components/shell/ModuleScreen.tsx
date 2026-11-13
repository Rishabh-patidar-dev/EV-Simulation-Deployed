import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight, Download } from "lucide-react";
import { MetricCard, type MetricTone } from "@/components/ui/cards";
import { Card } from "@/components/ui/primitives";
import TableToolbar from "@/components/ui/TableToolbar";
import Icon from "@/components/ui/Icon";
import UnderDevelopmentNote from "./UnderDevelopmentNote";
import { findModule, findTrail } from "@/lib/modules";
import type { CollectionName } from "@/server/types";

/**
 * The frame every module screen shares: a breadcrumb and title block
 * pulled straight off the module registry (so a screen can never be titled
 * differently from its nav entry), a strip of headline numbers, and one table
 * with a search box.
 */

interface ModuleStat {
  label: string;
  value: string;
  hint?: string;
  /** Tint the card when the figure is a state — overdue, expired, at risk. */
  tone?: MetricTone;
}

export default function ModuleScreen({
  href,
  stats,
  searchPlaceholder,
  children,
  aside,
  toolbar,
  actions,
  exportCollection,
  tabs,
}: {
  /** Route of this module — the key into lib/modules.ts. */
  href: string;
  stats: ModuleStat[];
  searchPlaceholder?: string;
  children: ReactNode;
  aside?: ReactNode;
  /** Rendered above the table's own card — a "create" Disclosure form, say —
      so it gets its own surface instead of nesting inside the table's. */
  toolbar?: ReactNode;
  /** Extra header buttons, beside search. */
  actions?: ReactNode;
  /** Offers an "Export CSV" of this collection (the full collection, not the filtered view). */
  exportCollection?: CollectionName;
  /** Section tabs under the title, for a module with more than one screen. */
  tabs?: ReactNode;
}) {
  const meta = findModule(href);
  const trail = findTrail(href);

  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-4 py-5 sm:px-6">
      <header className="space-y-2">
        {trail && (
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-[11.5px]" style={{ color: "var(--fg-faint)" }}>
            <Link href="/" className="rounded-sm transition-colors hover:text-[color:var(--fg)]">
              Dashboard
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span>{trail.section.label}</span>
            {trail.group && (
              <>
                <ChevronRight className="h-3 w-3" />
                <span>{trail.group.label}</span>
              </>
            )}
          </nav>
        )}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
              style={{ background: "var(--brand-soft)", color: "var(--brand-ink)" }}
            >
              <Icon name={meta?.icon ?? "Squircle"} className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[22px] font-bold leading-tight tracking-tight">{meta?.label ?? "Module"}</h1>
                {meta?.underDevelopment && <UnderDevelopmentNote />}
              </div>
              <p className="mt-0.5 max-w-3xl text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                {meta?.blurb}
              </p>
            </div>
          </div>
          {(searchPlaceholder || actions || exportCollection) && (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              {searchPlaceholder && <TableToolbar placeholder={searchPlaceholder} />}
              {actions}
              {exportCollection && (
                <a href={`/api/v1/collections/${exportCollection}?format=csv`} download className="btn btn-ghost" title="Download every row as CSV">
                  <Download className="h-3.5 w-3.5" />
                  Export CSV
                </a>
              )}
            </div>
          )}
        </div>
      </header>

      {tabs}

      {stats.length > 0 && (
        <section aria-label="Headline figures" className="grid-auto-fit-sm gap-3">
          {stats.map((stat) => (
            <MetricCard key={stat.label} label={stat.label} value={stat.value} hint={stat.hint} tone={stat.tone} />
          ))}
        </section>
      )}

      {toolbar}

      <div className={aside ? "grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]" : ""}>
        <Card className="min-w-0 overflow-hidden">{children}</Card>
        {aside && <div className="grid min-w-0 content-start gap-4">{aside}</div>}
      </div>
    </div>
  );
}
