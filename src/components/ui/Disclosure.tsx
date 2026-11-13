import type { ReactNode } from "react";
import { ChevronDown, Plus } from "lucide-react";

/**
 * A `<details>`-backed expanding panel — every "create" form in the CRM
 * (new lead, new segment, new deal …) opens this way instead of a modal, so
 * none of them need client-side JS just to open and close.
 *
 * `open` starts it expanded: pages pass it for `?new=1`, which is how the
 * command palette's "Add a lead" / "Invite a user" land straight on the form.
 */
export default function Disclosure({ label, children, open = false }: { label: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="disclosure surface" open={open}>
      <summary className="flex items-center gap-2 px-5 py-3.5 text-[13px] font-semibold" style={{ color: "var(--brand-ink)" }}>
        <Plus className="h-4 w-4" />
        <span className="flex-1">{label}</span>
        <ChevronDown className="disclosure-chevron h-4 w-4 transition-transform" style={{ color: "var(--fg-faint)" }} />
      </summary>
      <div className="disclosure-panel px-5 py-4">{children}</div>
    </details>
  );
}
