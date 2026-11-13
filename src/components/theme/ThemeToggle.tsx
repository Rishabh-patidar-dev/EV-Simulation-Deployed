"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { setThemePreference, useThemePreference, type ThemePreference } from "./theme";

const OPTIONS: Array<{ value: ThemePreference; label: string; Icon: typeof Sun }> = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

/** System / Light / Dark as one segmented radio group. `labels` spells the options out. */
export default function ThemeToggle({ labels = false, className = "" }: { labels?: boolean; className?: string }) {
  const preference = useThemePreference();

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={`inline-flex items-center gap-0.5 rounded-[10px] p-0.5 ${className}`}
      style={{ background: "var(--surface-subtle)", border: "1px solid var(--border)" }}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const selected = preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            onClick={() => setThemePreference(value)}
            className={`inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[8px] text-[12px] font-medium transition-colors ${
              labels ? "px-2.5" : "w-7"
            }`}
            style={
              selected
                ? { background: "var(--brand-soft)", color: "var(--brand-ink)" }
                : { color: "var(--fg-muted)" }
            }
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {labels && <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
