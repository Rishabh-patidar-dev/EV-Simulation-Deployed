import type { ReactNode } from "react";

/** Tone → pill class. Status vocabulary is shared across every module table. */
const TONES = {
  positive: "pill pill-positive",
  warning: "pill pill-warning",
  negative: "pill pill-negative",
  info: "pill pill-info",
  neutral: "pill pill-neutral",
  brand: "pill pill-brand",
} as const;

type Tone = keyof typeof TONES;

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={TONES[tone]}>{children}</span>;
}

/**
 * Every module in this simulation uses the same status words, so the mapping
 * from word to colour lives here once instead of in twenty table definitions.
 */
const TONE_BY_STATUS: Record<string, Tone> = {
  // good
  Converted: "positive", Verified: "positive", Approved: "positive", Paid: "positive",
  Active: "positive", Valid: "positive", Delivered: "positive", Received: "positive",
  Live: "positive", Done: "positive", Recovered: "positive", "In Stock": "positive",
  Running: "positive", Qualified: "positive", Confirmed: "positive",
  // in-flight
  "In Progress": "info", "In Production": "info", Dispatched: "info", "In Transit": "info",
  Contacted: "info", Responded: "info", Quoted: "info", Acknowledged: "info", Placed: "info",
  "Test Drive": "info", Allocated: "info", Demo: "info", Negotiation: "info", Quotation: "info",
  Booked: "info", Scheduled: "info", Submitted: "info", "Under Review": "info", Due: "info",
  "Ready for Delivery": "info", New: "info", Invited: "info",
  // needs attention
  Pending: "warning", "Expiring Soon": "warning", "Part Paid": "warning", "On Hold": "warning",
  "Awaiting Finance": "warning", Paused: "warning", Draft: "warning", Onboarding: "warning",
  Open: "warning", "Not Uploaded": "warning",
  // bad
  Overdue: "negative", Expired: "negative", Rejected: "negative", Lost: "negative",
  Cancelled: "negative", Suspended: "negative", Unpaid: "negative", Deactivated: "negative",
  // inert
  Closed: "neutral", Archived: "neutral", Completed: "neutral",
  // added with the retail, workshop and ERP modules
  Accepted: "positive", Disbursed: "positive", Issued: "positive", "Handed Over": "positive", "RC Issued": "positive",
  Resolved: "positive", Posted: "positive", Synced: "positive", Connected: "positive", Read: "positive", Captured: "positive", Online: "positive",
  "Pending Approval": "warning", "Awaiting Parts": "warning", "Awaiting Customer": "warning", Escalated: "warning", Objection: "warning", Offline: "warning",
  Sent: "info", Applied: "info", Sanctioned: "info", "PDI Done": "info", "TP Issued": "info", "Documents Ready": "info", "Checked In": "info",
  Ready: "info", Queued: "info", Created: "info",
  Failed: "negative", "No Show": "negative", Error: "negative",
  // added with warranty adjudication
  "Info Requested": "warning", "In Repair": "info", Reimbursed: "info", Recovery: "info", "Written Off": "neutral",
  "Auto-approve": "positive", "Needs review": "warning", Void: "negative",
  "Stock Short": "warning", Short: "warning", Requested: "info",
  Withdrawn: "neutral", Disconnected: "neutral", Refunded: "neutral",
};

export function StatusPill({ value }: { value: string }) {
  return <Pill tone={TONE_BY_STATUS[value] ?? "neutral"}>{value}</Pill>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`surface ${className}`}>{children}</section>;
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-5">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold leading-tight">{title}</h2>
        {subtitle && (
          <p className="mt-0.5 text-[12px] leading-snug" style={{ color: "var(--fg-muted)" }}>
            {subtitle}
          </p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}

/** ₹15.4 L / ₹1.87 Cr — the units an Indian dealer network actually reads in. */
export function formatINR(value: number): string {
  if (Math.abs(value) >= 10_000_000) return `₹${(value / 10_000_000).toFixed(2)} Cr`;
  if (Math.abs(value) >= 100_000) return `₹${(value / 100_000).toFixed(2)} L`;
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
}

/** Whole days elapsed since `iso`. Kept out of component bodies — calling
    Date.now() during render is an impurity React's lint rules reject. */
export function daysSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}
