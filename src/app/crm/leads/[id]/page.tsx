import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, Calendar, MessageSquare, Phone, TriangleAlert, User } from "lucide-react";
import ActionForm from "@/components/ui/ActionForm";
import SubmitButton from "@/components/ui/SubmitButton";
import { Card, CardHeader, Pill, StatusPill, formatINR, relativeTime } from "@/components/ui/primitives";
import { VEHICLE_MODELS, vehicleImage } from "@/lib/vehicles";
import { addLeadRemark, assignLead, convertLeadToDeal, deleteLead, deleteLeadRemark, markLeadLost, updateLead, updateLeadRemark, updateLeadStatus } from "@/server/actions/crm";
import { OPERATOR } from "@/lib/operator";
import { assignableStaff } from "@/server/staff";
import { readMany } from "@/server/store";
import type { Lead } from "@/server/types";
import { INDIAN_STATES } from "@/lib/gst";

export const dynamic = "force-dynamic";

const STATUS_OPTIONS: Lead["status"][] = ["New", "Contacted", "Qualified", "Test Drive", "Converted", "Lost"];
const SOURCE_OPTIONS: Lead["source"][] = ["Landing Page", "WhatsApp", "Walk-in", "Referral", "Dealer", "Call Centre", "Expo", "Import"];

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ data }, staff] = await Promise.all([
    readMany(["leads", "lead_remarks", "dealers", "deals", "bookings"] as const),
    assignableStaff("leads.manage"),
  ]);

  const lead = data.leads.find((l) => l.id === id);
  if (!lead) notFound();

  const remarks = data.lead_remarks
    .filter((r) => r.leadId === id)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  const dealerNames = data.dealers.filter((d) => d.status === "Active").map((d) => d.name);
  const deal = lead.dealId ? data.deals.find((d) => d.id === lead.dealId) : undefined;
  const booking = deal?.bookingId ? data.bookings.find((b) => b.id === deal.bookingId) : undefined;
  const image = vehicleImage(lead.model);
  const closed = lead.status === "Converted" || lead.status === "Lost";

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 py-5 sm:px-6">
      <Link href="/crm/leads" className="mb-4 flex items-center gap-1.5 text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
        <ArrowLeft className="h-3.5 w-3.5" /> Back to Lead Master
      </Link>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 content-start gap-4">
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-[20px] font-bold leading-tight tracking-tight">{lead.name}</h1>
                  <StatusPill value={lead.status} />
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                  <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" /> {lead.phone}</span>
                  <span>{lead.city}</span>
                  <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Captured {relativeTime(lead.createdAt)}</span>
                </p>
              </div>
              <Pill tone="brand">Score {lead.score}</Pill>
            </div>

            {image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt={lead.model} className="mt-4 h-40 w-full object-cover" style={{ background: "var(--bg)" }} />
            )}

            <div className="grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-4">
              <Field label="Model interest" value={lead.model} />
              <Field label="Source" value={lead.source} />
              <Field label="Est. value" value={formatINR(lead.value)} />
              <Field label="Next action" value={lead.nextAction} />
            </div>

            {!closed && (
              <div className="flex flex-wrap items-center gap-2 border-t px-5 py-4" style={{ borderColor: "var(--border)" }}>
                <ActionForm action={updateLeadStatus.bind(null, lead.id)} className="flex items-center gap-1.5">
                  <select name="status" className="field !w-auto py-1.5 text-[12px]" defaultValue={lead.status}>
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <SubmitButton size="sm" tone="ghost">Update status</SubmitButton>
                </ActionForm>
                <ActionForm action={convertLeadToDeal.bind(null, lead.id)}>
                  <SubmitButton size="sm">Convert to deal</SubmitButton>
                </ActionForm>
                <Link href={`/crm/test-drives?lead=${lead.id}`} className="btn btn-ghost btn-sm">
                  Book a test drive
                </Link>
                <ActionForm action={markLeadLost.bind(null, lead.id)}>
                  <SubmitButton size="sm" tone="danger">Mark lost</SubmitButton>
                </ActionForm>
              </div>
            )}

            {deal && (
              <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3 text-[12.5px]" style={{ borderColor: "var(--border)", background: "var(--brand-softer)" }}>
                <span style={{ color: "var(--fg-muted)" }}>Converted into a deal —</span>
                <Link href="/crm/pipeline" className="font-medium hover:underline" style={{ color: "var(--brand-ink)" }}>
                  view in pipeline
                </Link>
                {booking && (
                  <>
                    <span style={{ color: "var(--fg-muted)" }}>· booking</span>
                    <Link href="/crm/bookings" className="font-medium hover:underline" style={{ color: "var(--brand-ink)" }}>
                      {booking.bookingNo}
                    </Link>
                    <StatusPill value={booking.status} />
                  </>
                )}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Activity timeline" subtitle="Calls, visits and notes against this lead" />
            <div className="border-t px-5 py-4" style={{ borderColor: "var(--border)" }}>
              <ActionForm action={addLeadRemark.bind(null, lead.id)} resetOnSuccess className="flex items-start gap-2">
                <input type="hidden" name="author" value={lead.assignedTo ?? OPERATOR.name} />
                <textarea
                  name="note"
                  required
                  rows={2}
                  className="field flex-1"
                  placeholder="Log a call, a visit, or any update…"
                />
                <SubmitButton>Add note</SubmitButton>
              </ActionForm>
            </div>
            <ul className="space-y-4 px-5 pb-5">
              {remarks.length === 0 && (
                <li className="py-6 text-center text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                  No activity logged yet.
                </li>
              )}
              {remarks.map((r) => (
                <li key={r.id} className="flex gap-3">
                  <span
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                    style={{ background: "var(--brand-soft)", color: "var(--brand-ink)" }}
                  >
                    {r.author.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-[12.5px] font-semibold">{r.author}</span>
                      <span className="text-[11px]" style={{ color: "var(--fg-faint)" }}>{relativeTime(r.createdAt)}</span>
                    </span>
                    <span className="mt-0.5 block text-[13px]" style={{ color: "var(--fg)" }}>
                      <MessageSquare className="mr-1 inline h-3 w-3" style={{ color: "var(--fg-faint)" }} />
                      {r.note}
                    </span>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[11px] font-semibold" style={{ color: "var(--fg-muted)" }}>
                        Edit…
                      </summary>
                      <div className="mt-1.5 space-y-2">
                        <ActionForm action={updateLeadRemark.bind(null, r.id)} className="flex items-start gap-2">
                          <textarea name="note" defaultValue={r.note} required rows={2} maxLength={2000} className="field flex-1" aria-label="Note" />
                          <SubmitButton size="sm">Save</SubmitButton>
                        </ActionForm>
                        <ActionForm action={deleteLeadRemark.bind(null, r.id)}>
                          <SubmitButton size="sm" tone="danger">Delete note</SubmitButton>
                        </ActionForm>
                      </div>
                    </details>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="grid min-w-0 content-start gap-4">
          <Card>
            <CardHeader title="Ownership" subtitle={lead.assignedTo ? "Currently assigned" : "Not yet routed"} />
            <div className="px-5 pb-5">
              {lead.assignedTo && (
                <p className="mb-3 flex items-center gap-2 text-[13px]">
                  <User className="h-4 w-4" style={{ color: "var(--fg-faint)" }} />
                  {lead.assignedTo}
                  <span style={{ color: "var(--fg-faint)" }}>·</span>
                  <Building2 className="h-4 w-4" style={{ color: "var(--fg-faint)" }} />
                  {lead.dealer}
                </p>
              )}
              {!closed && (
                <ActionForm action={assignLead.bind(null, lead.id)} className="grid gap-2">
                  <select name="assignedTo" required className="field" defaultValue={lead.assignedTo && staff.includes(lead.assignedTo) ? lead.assignedTo : ""}>
                    <option value="" disabled>Owner…</option>
                    {staff.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <select name="dealer" required className="field" defaultValue={lead.dealer ?? ""}>
                    <option value="" disabled>Dealer…</option>
                    {dealerNames.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  <SubmitButton size="sm">{lead.assignedTo ? "Reassign" : "Assign"}</SubmitButton>
                </ActionForm>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title={`Score ${lead.score}`} subtitle="Worked out as EV-CRM scores a lead — profile completeness 70%, contact quality 30% — plus engagement since" />
            <div className="px-5 pb-5">
              {lead.scoreBreakdown ? (
                <dl className="space-y-1.5 text-[12.5px]">
                  <ScoreRow label="Profile completeness" value={`${lead.scoreBreakdown.completeness} / 100`} />
                  <ScoreRow label="Contact quality" value={`${lead.scoreBreakdown.quality} / 100`} />
                  <ScoreRow label="Base score" value={String(lead.scoreBreakdown.base)} />
                  <ScoreRow label="Engagement since" value={`${lead.score - lead.scoreBreakdown.base >= 0 ? "+" : ""}${lead.score - lead.scoreBreakdown.base}`} />
                  {lead.scoreBreakdown.missing.length > 0 && <p style={{ color: "var(--fg-muted)" }}>Missing: {lead.scoreBreakdown.missing.join(", ")} — fill them in to raise it.</p>}
                  {lead.scoreBreakdown.invalid.length > 0 && <p style={{ color: "var(--negative)" }}>Invalid: {lead.scoreBreakdown.invalid.join(", ")}</p>}
                </dl>
              ) : (
                <p className="text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                  Captured before scoring — saving its details below works the score out.
                </p>
              )}
              {lead.routing && (
                <p className="mt-3 text-[12px]" style={{ color: "var(--fg-muted)" }}>
                  {lead.routing.by === "Territory" ? "Routed by territory" : "Assigned by hand"}
                  {lead.routing.why ? ` — ${lead.routing.why}` : ""}.
                </p>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Lead details" subtitle="What was captured — correct it here" />
            <div className="px-5 pb-5">
              <ActionForm action={updateLead.bind(null, lead.id)} className="grid gap-2.5">
                <div>
                  <label className="field-label" htmlFor="lead-name">Name</label>
                  <input id="lead-name" name="name" required maxLength={200} defaultValue={lead.name} className="field" />
                </div>
                <div>
                  <label className="field-label" htmlFor="lead-phone">Phone</label>
                  <input id="lead-phone" name="phone" type="tel" required defaultValue={lead.phone} className="field" />
                </div>
                <div>
                  <label className="field-label" htmlFor="lead-email">Email</label>
                  <input id="lead-email" name="email" type="email" maxLength={120} defaultValue={lead.email ?? ""} className="field" />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="field-label" htmlFor="lead-city">City</label>
                    <input id="lead-city" name="city" maxLength={200} defaultValue={lead.city} className="field" />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="lead-state">State</label>
                    <select id="lead-state" name="state" defaultValue={lead.state ?? ""} className="field">
                      <option value="">Not given</option>
                      {INDIAN_STATES.map((st) => (
                        <option key={st}>{st}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="field-label" htmlFor="lead-model">Model interest</label>
                  <select id="lead-model" name="model" defaultValue={lead.model} className="field">
                    {VEHICLE_MODELS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="lead-source">Source</label>
                  <select id="lead-source" name="source" defaultValue={lead.source} className="field">
                    {SOURCE_OPTIONS.map((src) => (
                      <option key={src} value={src}>{src}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="field-label" htmlFor="lead-value">Est. value (₹)</label>
                    <input id="lead-value" name="value" type="number" min={0} step={1} defaultValue={lead.value} className="field" />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="lead-pincode">Pincode</label>
                    <input id="lead-pincode" name="pincode" inputMode="numeric" maxLength={6} defaultValue={lead.pincode ?? ""} className="field" />
                  </div>
                </div>
                <div>
                  <label className="field-label" htmlFor="lead-next">Next action</label>
                  <input id="lead-next" name="nextAction" maxLength={200} defaultValue={lead.nextAction} className="field" />
                </div>
                <SubmitButton size="sm">Save details</SubmitButton>
              </ActionForm>

              {/* A duplicate or a junk capture. Anything with work behind it is refused. */}
              <details className="disclosure mt-4 rounded-[12px]" style={{ border: "1px solid var(--negative-border)" }}>
                <summary className="flex items-center gap-2 px-3.5 py-2.5 text-[12.5px] font-semibold" style={{ color: "var(--negative)" }}>
                  <TriangleAlert className="h-4 w-4" />
                  Delete this lead…
                </summary>
                <ActionForm action={deleteLead.bind(null, lead.id)} className="space-y-2.5 px-3.5 pb-3.5">
                  <p className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
                    {lead.name} and every note on this page go for good. A lead with a deal, a quotation or a test drive behind it is kept
                    — mark it lost instead.
                  </p>
                  <SubmitButton size="sm" tone="danger">
                    Yes, delete {lead.name}
                  </SubmitButton>
                </ActionForm>
              </details>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-wide" style={{ color: "var(--fg-faint)" }}>{label}</p>
      <p className="mt-0.5 truncate text-[13px] font-medium">{value}</p>
    </div>
  );
}

function ScoreRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt style={{ color: "var(--fg-muted)" }}>{label}</dt>
      <dd className="num font-medium">{value}</dd>
    </div>
  );
}
