import Link from "next/link";
import { notFound } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import DetailScreen, { DetailColumns } from "@/components/shell/DetailScreen";
import ActionForm from "@/components/ui/ActionForm";
import { Panel } from "@/components/ui/cards";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill, formatDate } from "@/components/ui/primitives";
import { Facts, Hint, Stepper, Timeline, reachedFrom } from "@/components/ui/workflow";
import { rupees } from "@/lib/gst";
import { LABOUR_RATE } from "@/lib/service";
import { isPast } from "@/lib/time";
import { addLabour, cancelJobCard, closeJobCard, issuePart, markJobReady, returnPart, setAwaitingParts, updateDiagnosis } from "@/server/actions/service";
import { readMany } from "@/server/store";
import { JOB_BILL_TO, JOB_FLOW, type JobCard } from "@/server/types";

export const dynamic = "force-dynamic";

const GST = 0.18;

function split(j: JobCard) {
  return JOB_BILL_TO.map((billTo) => {
    const labour = j.labour.filter((l) => l.billTo === billTo).reduce((s, l) => s + Math.round(l.hours * l.rate), 0);
    const parts = j.parts.filter((p) => p.billTo === billTo).reduce((s, p) => s + p.quantity * p.unitPrice, 0);
    return { billTo, labour, parts, net: labour + parts };
  });
}

export default async function JobCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await readMany(["job_cards", "spare_parts", "tax_invoices", "warranty_claims"] as const);
  const j = data.job_cards.find((x) => x.id === id);
  if (!j) notFound();

  const editable = j.status === "Open" || j.status === "In Progress" || j.status === "Awaiting Parts";
  const step = j.status === "Awaiting Parts" ? 1 : (JOB_FLOW as readonly string[]).indexOf(j.status);
  const totals = split(j);
  const customer = totals.find((t) => t.billTo === "Customer")!;
  const invoice = j.taxInvoiceId ? data.tax_invoices.find((i) => i.id === j.taxInvoiceId) : undefined;
  const claim = j.warrantyClaimId ? data.warranty_claims.find((c) => c.id === j.warrantyClaimId) : undefined;
  const parts = [...data.spare_parts].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const defaultBill = j.serviceType === "Free Service" ? "Free Service" : j.serviceType === "Warranty Repair" ? "Warranty" : "Customer";

  const actions =
    j.status === "In Progress" ? (
      <>
        <ActionForm action={markJobReady.bind(null, j.id)}>
          <SubmitButton>Work done — ready for pickup</SubmitButton>
        </ActionForm>
        <Hint>Needs a correction on every complaint.</Hint>
      </>
    ) : j.status === "Ready" ? (
      <>
        <ActionForm action={closeJobCard.bind(null, j.id)}>
          <SubmitButton>Close &amp; bill</SubmitButton>
        </ActionForm>
        <Hint>
          {customer.net ? `Invoices ${rupees(Math.round(customer.net * (1 + GST)))} to the customer` : "Nothing to bill the customer"}
          {totals.find((t) => t.billTo === "Warranty")!.net ? "; raises the warranty claim." : "."}
        </Hint>
      </>
    ) : j.status === "Awaiting Parts" ? (
      <Hint>Waiting on parts — receive them under Spare Parts Inventory, then issue them here.</Hint>
    ) : null;

  return (
    <DetailScreen
      moduleHref="/dms/service/jobcards"
      title={j.jobNo}
      badges={
        <>
          <StatusPill value={j.status} />
          <Pill tone="neutral">
            {j.serviceType}
            {j.freeServiceNo ? ` #${j.freeServiceNo}` : ""}
          </Pill>
          {editable && isPast(j.promisedAt) && <Pill tone="negative">Past promised time</Pill>}
        </>
      }
      subtitle={`${j.customer} · ${j.model} · ${j.registrationNo ?? j.vin} · ${j.odometerKm.toLocaleString("en-IN")} km · ${j.dealer}`}
      actions={actions}
    >
      <Stepper
        label="Job progress"
        steps={JOB_FLOW}
        current={Math.max(0, step)}
        complete={j.status === "Closed"}
        reachedAt={reachedFrom(j.history)}
        stopped={j.status === "Cancelled" ? { title: "Cancelled.", detail: [...j.history].reverse().find((e) => e.status === "Cancelled")?.note ?? "" } : undefined}
      />

      <DetailColumns
        main={
          <>
            <Panel title="Complaint · cause · correction" description="Each complaint closes with what caused it and what fixed it.">
              <ActionForm action={updateDiagnosis.bind(null, j.id)} className="space-y-3">
                <ol className="space-y-3">
                  {j.complaints.map((c, i) => (
                    <li key={i} className="rounded-[10px] p-3" style={{ background: "var(--surface-subtle)" }}>
                      <p className="text-[13px] font-medium">
                        {i + 1}. {c.complaint}
                      </p>
                      {editable ? (
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <input name="cause" maxLength={300} defaultValue={c.cause} className="field" placeholder="Cause" aria-label={`Cause ${i + 1}`} />
                          <input name="correction" maxLength={300} defaultValue={c.correction} className="field" placeholder="Correction" aria-label={`Correction ${i + 1}`} />
                        </div>
                      ) : (
                        <p className="mt-1 text-[12px]" style={{ color: "var(--fg-muted)" }}>
                          Cause: {c.cause || "—"} · Correction: {c.correction || "—"}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
                {editable && (
                  <div className="flex flex-wrap gap-2">
                    <input name="newComplaint" maxLength={200} className="field min-w-0 flex-1" placeholder="Add a complaint found in the workshop (optional)" aria-label="New complaint" />
                    <SubmitButton size="sm" tone="ghost">
                      Save diagnosis
                    </SubmitButton>
                  </div>
                )}
              </ActionForm>
            </Panel>

            <Panel title="Labour" description={`₹${LABOUR_RATE} an hour before GST.`} bodyClassName="p-0!">
              {j.labour.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Work</th>
                        <th className="text-right">Hours</th>
                        <th>Billed to</th>
                        <th className="text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {j.labour.map((l, i) => (
                        <tr key={i}>
                          <td>{l.description}</td>
                          <td className="num text-right">{l.hours}</td>
                          <td>{l.billTo}</td>
                          <td className="num text-right">{rupees(Math.round(l.hours * l.rate))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {editable && (
                <ActionForm action={addLabour.bind(null, j.id)} resetOnSuccess className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_6rem_9rem_auto]">
                  <input name="description" required maxLength={120} className="field" placeholder="e.g. Battery balancing and BMS reset" aria-label="Labour description" />
                  <input name="hours" type="number" min={0.25} max={24} step={0.25} defaultValue={1} className="field" aria-label="Hours" />
                  <select name="billTo" className="field" defaultValue={defaultBill} aria-label="Billed to">
                    {JOB_BILL_TO.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                  <SubmitButton size="sm">Add</SubmitButton>
                </ActionForm>
              )}
            </Panel>

            <Panel title="Parts" description="Issued straight off spare-parts stock — the movement lands in the Inventory Logs." bodyClassName="p-0!">
              {j.parts.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Part</th>
                        <th>HSN</th>
                        <th className="text-right">Qty</th>
                        <th>Billed to</th>
                        <th className="text-right">Amount</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {j.parts.map((p, i) => (
                        <tr key={i}>
                          <td>
                            {p.name} <span style={{ color: "var(--fg-faint)" }}>{p.sku}</span>
                          </td>
                          <td className="num">{p.hsn}</td>
                          <td className="num text-right">{p.quantity}</td>
                          <td>{p.billTo}</td>
                          <td className="num text-right">{rupees(p.quantity * p.unitPrice)}</td>
                          <td className="text-right">
                            {editable && (
                              <ActionForm action={returnPart.bind(null, j.id, i)}>
                                <SubmitButton size="sm" tone="ghost">
                                  Return
                                </SubmitButton>
                              </ActionForm>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {editable && (
                <ActionForm action={issuePart.bind(null, j.id)} className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_5rem_9rem_auto]">
                  <select name="partId" required className="field" defaultValue="" aria-label="Part">
                    <option value="" disabled>
                      Choose a part
                    </option>
                    {parts.map((p) => (
                      <option key={p.id} value={p.id} disabled={p.onHand === 0}>
                        {p.name} · {p.sku} · {rupees(p.unitPrice)} · {p.onHand} in stock
                      </option>
                    ))}
                  </select>
                  <input name="quantity" type="number" min={1} max={50} defaultValue={1} className="field" aria-label="Quantity" />
                  <select name="billTo" className="field" defaultValue={defaultBill} aria-label="Billed to">
                    {JOB_BILL_TO.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                  <SubmitButton size="sm">Issue</SubmitButton>
                </ActionForm>
              )}
            </Panel>

            <Panel title="History" description="Every step, newest first.">
              <Timeline events={j.history} />
            </Panel>
          </>
        }
        side={
          <>
            <Panel title="Bill">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr style={{ color: "var(--fg-muted)" }}>
                    <th className="text-left font-normal">Billed to</th>
                    <th className="text-right font-normal">Before GST</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.map((t) => (
                    <tr key={t.billTo}>
                      <td className="py-1">{t.billTo}</td>
                      <td className="num py-1 text-right">{rupees(t.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-2 flex items-baseline justify-between gap-3 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
                <span className="font-semibold">Customer pays (18% GST)</span>
                <span className="num text-[16px] font-bold">{rupees(Math.round(customer.net * (1 + GST)))}</span>
              </div>
            </Panel>

            <Panel title="Vehicle">
              <Facts
                rows={[
                  ["Chassis", j.vin],
                  ["Registration", j.registrationNo ?? "Not yet"],
                  ["Model", j.model],
                  ["Odometer in", `${j.odometerKm.toLocaleString("en-IN")} km`],
                  ["Customer", j.customer],
                  j.phone && ["Mobile", j.phone],
                  ["Technician", j.technician],
                  ["Promised", formatDate(j.promisedAt)],
                  j.nextServiceAt && ["Next service", `${formatDate(j.nextServiceAt)} or ${j.nextServiceKm?.toLocaleString("en-IN")} km`],
                ]}
              />
            </Panel>

            {(invoice || claim) && (
              <Panel title="Billed">
                <Facts
                  rows={[
                    invoice && ["Tax invoice", <Link key="i" href={`/dms/quotations/invoices/${invoice.id}`} className="underline">{invoice.invoiceNo}</Link>],
                    claim && ["Warranty claim", <Link key="c" href={`/dms/service/warranty/${claim.id}`} className="underline">{claim.claimNo} · {claim.status}</Link>],
                  ]}
                />
              </Panel>
            )}

            {(j.status === "In Progress" || j.status === "Open") && (
              <ActionForm action={setAwaitingParts.bind(null, j.id)}>
                <SubmitButton size="sm" tone="ghost" className="w-full">
                  Mark waiting on parts
                </SubmitButton>
              </ActionForm>
            )}

            {j.status !== "Closed" && j.status !== "Cancelled" && (
              <details className="disclosure surface">
                <summary className="flex items-center gap-2 px-4 py-3 text-[12.5px] font-semibold" style={{ color: "var(--negative)" }}>
                  <TriangleAlert className="h-4 w-4" />
                  Cancel the job…
                </summary>
                <ActionForm action={cancelJobCard.bind(null, j.id)} className="space-y-2.5 px-4 pb-4">
                  <p className="text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                    Issued parts go back into stock.
                  </p>
                  <textarea name="reason" required minLength={3} maxLength={300} rows={2} className="field" placeholder="Reason" aria-label="Reason" />
                  <SubmitButton size="sm" tone="danger">
                    Cancel job card
                  </SubmitButton>
                </ActionForm>
              </details>
            )}
          </>
        }
      />
    </DetailScreen>
  );
}
