"use client";

import { OPERATOR, initials } from "@/lib/operator";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { usePopover } from "./usePopover";

/**
 * The account menu: who the demo is signed in as, and the theme. Pages and
 * tools already on the rail are not repeated here. The demo has no sign-in,
 * so there is deliberately no "Sign out" item, which would do nothing.
 */
export default function ProfileMenu() {
  const { open, setOpen, ref } = usePopover();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-popover-trigger
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 items-center gap-2 rounded-[10px] pl-1 pr-1 outline-none transition-colors hover:bg-[color:var(--hover)] focus-visible:shadow-[0_0_0_2px_color-mix(in_srgb,var(--brand)_45%,transparent)] sm:pr-2.5"
        aria-label={`Account menu for ${OPERATOR.name}`}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-bold"
          style={{ background: "var(--brand-soft)", color: "var(--brand-ink)" }}
        >
          {initials(OPERATOR.name)}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-[12.5px] font-semibold leading-tight">{OPERATOR.name}</span>
          <span className="block text-[11px] leading-tight" style={{ color: "var(--fg-faint)" }}>
            {OPERATOR.team}
          </span>
        </span>
      </button>

      {open && (
        <div role="dialog" aria-label="Account" className="popover absolute right-0 top-11 z-50 w-[min(16.5rem,calc(100vw-2rem))] p-1">
          <div className="px-2.5 py-2">
            <p className="truncate text-[13px] font-semibold">{OPERATOR.name}</p>
            <p className="truncate text-[11.5px]" style={{ color: "var(--fg-muted)" }} title={OPERATOR.email}>
              {OPERATOR.email}
            </p>
            <span className="pill pill-brand mt-1.5">{OPERATOR.role}</span>
          </div>

          <div className="px-2.5 pb-2 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
            <p className="menu-label mb-1.5">Appearance</p>
            <ThemeToggle labels className="flex w-full" />
          </div>
        </div>
      )}
    </div>
  );
}
