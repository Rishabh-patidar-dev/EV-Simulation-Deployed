import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { findTrail } from "@/lib/modules";
import UnderDevelopmentNote from "./UnderDevelopmentNote";

/**
 * The frame for one record — an order, a quotation, a job card: breadcrumb
 * back to its module (pulled off the module registry, like ModuleScreen), the
 * record's title and state, and room on the right for what happens next.
 */
export default function DetailScreen({
  moduleHref,
  title,
  badges,
  subtitle,
  actions,
  lead,
  children,
}: {
  moduleHref: string;
  title: ReactNode;
  badges?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Shown left of the title — a record's own image. */
  lead?: ReactNode;
  children: ReactNode;
}) {
  const trail = findTrail(moduleHref);
  return (
    <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-4 px-4 py-5 sm:px-6">
      <header className="space-y-2">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-[11.5px]" style={{ color: "var(--fg-faint)" }}>
          <Link href="/" className="hover:text-[color:var(--fg)]">
            Dashboard
          </Link>
          {trail && (
            <>
              <ChevronRight className="h-3 w-3" />
              <span>{trail.section.label}</span>
              <ChevronRight className="h-3 w-3" />
              <Link href={moduleHref} className="hover:text-[color:var(--fg)]">
                {trail.module.label}
              </Link>
            </>
          )}
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            {lead}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[22px] font-bold leading-tight tracking-tight">{title}</h1>
                {badges}
                {trail?.module.underDevelopment && <UnderDevelopmentNote />}
              </div>
              {subtitle && (
                <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          {actions && <div className="flex flex-col items-start gap-1 sm:items-end">{actions}</div>}
        </div>
      </header>
      {children}
    </div>
  );
}

/** Main column and side column, stacking on narrow screens. */
export function DetailColumns({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="grid min-w-0 gap-4">{main}</div>
      <div className="grid min-w-0 gap-4">{side}</div>
    </div>
  );
}
