"use client";

import { Activity } from "lucide-react";
import { worstLevel, type StatusGroup, type StatusLevel } from "@/lib/status";
import { usePopover } from "./usePopover";

const DOT: Record<StatusLevel, string> = {
  healthy: "var(--positive)",
  warning: "var(--warning)",
  offline: "var(--fg-faint)",
};

const SUMMARY_COLOR: Record<StatusLevel, string> = { ...DOT, offline: "var(--fg-muted)" };

const SUMMARY: Record<StatusLevel, string> = {
  healthy: "All systems normal",
  warning: "Changes will not persist",
  offline: "Partly disabled",
};

/** Pulse icon in the header: where data is read from, whether writes persist, what is switched off. */
export default function StatusMenu({ groups }: { groups: StatusGroup[] }) {
  const { open, setOpen, ref } = usePopover();
  const level = worstLevel(groups);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-popover-trigger
        onClick={() => setOpen((o) => !o)}
        className="icon-btn"
        aria-label={`System status: ${SUMMARY[level]}`}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <Activity className="h-4 w-4" />
        <span
          aria-hidden
          className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full"
          style={{ background: DOT[level], border: "2px solid var(--card)" }}
        />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="System status"
          className="popover fixed inset-x-4 top-[4.25rem] z-50 p-1 sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[19rem]"
        >
          <div className="flex items-center justify-between gap-3 px-2.5 py-2">
            <p className="text-[13px] font-semibold">System status</p>
            <span className="text-[11.5px] font-medium" style={{ color: SUMMARY_COLOR[level] }}>
              {SUMMARY[level]}
            </span>
          </div>
          {groups.map((group) => (
            <div key={group.id} className="pb-1" style={{ borderTop: "1px solid var(--border)" }}>
              <p className="menu-label px-2.5 pb-1 pt-2">{group.label}</p>
              {group.entries.map((entry) => (
                <div key={entry.id} className="flex items-start justify-between gap-3 rounded-[8px] px-2.5 py-1.5" title={entry.tooltip}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: DOT[entry.level] }} />
                    <span className="truncate text-[12.5px]">{entry.label}</span>
                  </span>
                  <span className="shrink-0 text-right text-[11.5px] font-medium" style={{ color: "var(--fg-muted)" }}>
                    {entry.detail}
                  </span>
                </div>
              ))}
              {group.entries
                .filter((entry) => entry.tooltip && entry.level !== "healthy")
                .map((entry) => (
                  <p key={`${entry.id}-note`} className="px-2.5 pb-1 text-[11px] leading-snug" style={{ color: "var(--fg-faint)" }}>
                    {entry.tooltip}
                  </p>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
