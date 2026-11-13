import Link from "next/link";
import { notFound } from "next/navigation";
import DetailScreen, { DetailColumns } from "@/components/shell/DetailScreen";
import ActionForm from "@/components/ui/ActionForm";
import { Panel } from "@/components/ui/cards";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill } from "@/components/ui/primitives";
import { Facts, fullDate } from "@/components/ui/workflow";
import { SLA, isOpenTicket, slaState } from "@/lib/sla";
import { escalateTicket, linkClaimToTicket, logCustomerReply, reassignTicket, recordCsat, reopenTicket, replyToTicket, resolveTicket } from "@/server/actions/support";
import { assignableStaff } from "@/server/staff";
import { readMany } from "@/server/store";
import { TICKET_PRIORITIES, type TicketMessage } from "@/server/types";

export const dynamic = "force-dynamic";

const BUBBLE: Record<TicketMessage["kind"], { align: string; bg: string; label: string }> = {
  Customer: { align: "mr-auto", bg: "var(--surface-subtle)", label: "Customer" },
  Agent: { align: "ml-auto", bg: "var(--brand-soft)", label: "Reply" },
  Internal: { align: "ml-auto", bg: "var(--warning-surface)", label: "Internal note" },
  System: { align: "mx-auto", bg: "transparent", label: "" },
};

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [{ data }, agents] = await Promise.all([readMany(["tickets", "warranty_claims", "vehicle_units"] as const), assignableStaff("support.manage")]);
  const t = data.tickets.find((x) => x.id === id);
  if (!t) notFound();

  const s = slaState(t);
  const open = isOpenTicket(t);
  const claim = t.claimId ? data.warranty_claims.find((c) => c.id === t.claimId) : undefined;
  const vinClaims = t.vin ? data.warranty_claims.filter((c) => c.vin === t.vin && c.id !== t.claimId) : [];

  return (
    <DetailScreen
      moduleHref="/crm/support"
      title={t.subject}
      badges={
        <>
          <StatusPill value={t.status} />
          <Pill tone={t.priority === "P1" ? "negative" : t.priority === "P2" ? "warning" : "neutral"}>
            {t.priority} · {SLA[t.priority].label}
          </Pill>
          {open && s.resolutionBreached && <Pill tone="negative">SLA breached</Pill>}
        </>
      }
      subtitle={`${t.ticketNo} · ${t.customer} · ${t.category} · via ${t.channel} · opened ${fullDate(t.openedAt)}`}
    >
      <DetailColumns
        main={
          <>
            <Panel title="Conversation" description="Replies go to the customer on WhatsApp; internal notes stay here.">
              <ol className="space-y-2.5">
                {t.thread.map((m, i) => {
                  const style = BUBBLE[m.kind];
                  if (m.kind === "System") {
                    return (
                      <li key={i} className="text-center text-[11.5px]" style={{ color: "var(--fg-faint)" }}>
                        {m.text} · {fullDate(m.at)}
                      </li>
                    );
                  }
                  return (
                    <li key={i} className={`max-w-[85%] rounded-[12px] px-3.5 py-2.5 ${style.align}`} style={{ background: style.bg, border: "1px solid var(--border)" }}>
                      <p className="text-[11px] font-semibold" style={{ color: "var(--fg-muted)" }}>
                        {style.label} · {m.by} · {fullDate(m.at)}
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-[13px]">{m.text}</p>
                    </li>
                  );
                })}
              </ol>

              {t.status !== "Closed" && (
                <ActionForm action={replyToTicket.bind(null, t.id)} resetOnSuccess className="mt-4 space-y-2 pt-3" >
                  <textarea name="text" required maxLength={2000} rows={3} className="field" placeholder="Reply to the customer, or add an internal note" aria-label="Reply" />
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-1.5 text-[12.5px]">
                      <input type="checkbox" name="internal" /> Internal note
                    </label>
                    <label className="flex items-center gap-1.5 text-[12.5px]">
                      <input type="checkbox" name="awaitCustomer" /> Waiting on the customer
                    </label>
                    <SubmitButton size="sm">Send</SubmitButton>
                  </div>
                </ActionForm>
              )}
            </Panel>

            {open && (
              <div className="grid gap-4 md:grid-cols-2">
                <Panel title="Customer came back" description="Log a call or message that arrived outside WhatsApp.">
                  <ActionForm action={logCustomerReply.bind(null, t.id)} resetOnSuccess className="space-y-2">
                    <textarea name="text" required maxLength={2000} rows={2} className="field" aria-label="What the customer said" />
                    <SubmitButton size="sm" tone="ghost">
                      Log it
                    </SubmitButton>
                  </ActionForm>
                </Panel>
                <Panel title="Resolve" description="The customer is asked to rate the support.">
                  <ActionForm action={resolveTicket.bind(null, t.id)} className="space-y-2">
                    <textarea name="resolution" required minLength={5} maxLength={1000} rows={2} className="field" placeholder="What fixed it" aria-label="Resolution" />
                    <SubmitButton size="sm">Mark resolved</SubmitButton>
                  </ActionForm>
                </Panel>
              </div>
            )}

            {t.status === "Resolved" && (
              <Panel title="Customer rating" description="Record the CSAT the customer gave — this closes the ticket.">
                <ActionForm action={recordCsat.bind(null, t.id)} className="flex flex-wrap items-center gap-3">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <label key={n} className="flex items-center gap-1 text-[13px]">
                      <input type="radio" name="csat" value={n} required /> {n}
                    </label>
                  ))}
                  <SubmitButton size="sm">Close with rating</SubmitButton>
                </ActionForm>
              </Panel>
            )}
          </>
        }
        side={
          <>
            <Panel title="SLA">
              <Facts
                rows={[
                  ["Respond by", fullDate(t.respondBy)],
                  ["First response", t.firstResponseAt ? `${fullDate(t.firstResponseAt)}${s.responseBreached ? " (late)" : ""}` : s.responseBreached ? "Overdue" : "Not yet"],
                  ["Resolve by", fullDate(t.resolveBy)],
                  ["Resolved", t.resolvedAt ? `${fullDate(t.resolvedAt)}${s.resolutionBreached ? " (late)" : ""}` : s.hoursLeft !== null ? `${s.hoursLeft}h ${s.hoursLeft < 0 ? "over" : "left"}` : "—"],
                  t.csat !== null && ["CSAT", `${t.csat} / 5`],
                ]}
              />
            </Panel>

            <Panel title="Customer & vehicle">
              <Facts
                rows={[
                  ["Customer", t.customer],
                  ["Mobile", t.phone],
                  t.city && ["City", t.city],
                  t.vin && ["Chassis", t.vin],
                  t.model && ["Model", t.model],
                  t.dealer && ["Dealer", t.dealer],
                  claim && ["Warranty claim", <Link key="c" href={`/dms/service/warranty/${claim.id}`} className="underline">{claim.claimNo} · {claim.status}</Link>],
                ]}
              />
              {t.vin && (
                <Link href={`/dms/service/jobcards?vin=${encodeURIComponent(t.vin)}`} className="btn btn-ghost btn-sm mt-3 w-full">
                  Open a job card for this vehicle
                </Link>
              )}
            </Panel>

            {open && (
              <Panel title="Owner & priority">
                <ActionForm action={reassignTicket.bind(null, t.id)} className="space-y-2">
                  <select name="assignee" className="field" defaultValue={t.assignee} aria-label="Assignee">
                    {agents.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                  <select name="priority" className="field" defaultValue={t.priority} aria-label="Priority">
                    {TICKET_PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p} — {SLA[p].label}
                      </option>
                    ))}
                  </select>
                  <SubmitButton size="sm" tone="ghost">
                    Update
                  </SubmitButton>
                </ActionForm>
              </Panel>
            )}

            {open && t.status !== "Escalated" && (
              <details className="disclosure surface">
                <summary className="px-4 py-3 text-[12.5px] font-semibold" style={{ color: "var(--warning)" }}>
                  Escalate to the Relationship Manager…
                </summary>
                <ActionForm action={escalateTicket.bind(null, t.id)} className="space-y-2 px-4 pb-4">
                  <textarea name="note" required minLength={3} maxLength={500} rows={2} className="field" placeholder="Why it needs the RM" aria-label="Escalation note" />
                  <SubmitButton size="sm">Escalate</SubmitButton>
                </ActionForm>
              </details>
            )}

            {!claim && (t.category === "Warranty Support" || vinClaims.length > 0) && (
              <Panel title="Link a warranty claim">
                <ActionForm action={linkClaimToTicket.bind(null, t.id)} className="flex gap-2">
                  <input name="claimNo" required list="ticket-claims" maxLength={30} className="field" placeholder="WC/26/…" aria-label="Claim number" />
                  <datalist id="ticket-claims">
                    {vinClaims.map((c) => (
                      <option key={c.id} value={c.claimNo}>
                        {c.component} · {c.status}
                      </option>
                    ))}
                  </datalist>
                  <SubmitButton size="sm" tone="ghost">
                    Link
                  </SubmitButton>
                </ActionForm>
              </Panel>
            )}

            {!open && (
              <details className="disclosure surface">
                <summary className="px-4 py-3 text-[12.5px] font-semibold" style={{ color: "var(--brand-ink)" }}>
                  Reopen…
                </summary>
                <ActionForm action={reopenTicket.bind(null, t.id)} className="space-y-2 px-4 pb-4">
                  <input name="reason" required minLength={3} maxLength={300} className="field" placeholder="Why the customer came back" aria-label="Reason" />
                  <SubmitButton size="sm">Reopen</SubmitButton>
                </ActionForm>
              </details>
            )}
          </>
        }
      />
    </DetailScreen>
  );
}
