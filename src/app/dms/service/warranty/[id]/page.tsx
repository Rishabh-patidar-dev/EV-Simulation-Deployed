import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleAlert, CircleCheck, CircleX, RotateCcw } from "lucide-react";
import DetailScreen, { DetailColumns } from "@/components/shell/DetailScreen";
import ActionForm from "@/components/ui/ActionForm";
import { Panel } from "@/components/ui/cards";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill, formatDate, formatINR } from "@/components/ui/primitives";
import { Facts, Hint, Stepper, Timeline, reachedFrom } from "@/components/ui/workflow";
import { vehicleImage } from "@/lib/vehicles";
import { APPROVED_CHARGERS, CLAIM_FLOW, PART_RETURN_REQUIRED, coverageEnds, warrantyPlan } from "@/lib/warranty";
import {
  closeRecovery,
  decideClaim,
  openRecovery,
  receivePart,
  reimburseDealer,
  reopenClaim,
  requestInfo,
  reviewClaim,
  startRepair,
  supplyInfo,
} from "@/server/actions/warranty";
import { readMany } from "@/server/store";
import type { WarrantyClaim } from "@/server/types";

export const dynamic = "force-dynamic";

/** Where the claim sits on the happy path — review and info requests count as "Submitted". */
function stepOf(c: WarrantyClaim): number {
  if (c.status === "Recovered") return CLAIM_FLOW.length - 1;
  const i = (CLAIM_FLOW as readonly string[]).indexOf(c.status);
  return i >= 0 ? i : 0;
}

/**
 * One warranty claim — EV-CRM's claim page: what failed and the evidence,
 * the rules engine's decision with every check it made, the vehicle's cover,
 * and the next thing to do, all the way to the supplier paying it back.
 */
export default async function WarrantyClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await readMany(["warranty_claims", "job_cards", "tickets", "telematics", "products", "sync_queue"] as const);
  const c = data.warranty_claims.find((x) => x.id === id);
  if (!c) notFound();

  const job = c.jobCardId ? data.job_cards.find((j) => j.id === c.jobCardId) : undefined;
  const tickets = data.tickets.filter((t) => t.claimId === c.id);
  const device = data.telematics.find((t) => t.vin === c.vin);
  const product = data.products.find((p) => p.model === c.model);
  const plan = c.model ? warrantyPlan(c.component, product?.warranty) : null;
  const others = data.warranty_claims.filter((x) => x.vin === c.vin && x.id !== c.id);
  const voucher = data.sync_queue.find((v) => v.sourceId === c.id && v.source === "Warranty Claim");
  const approved = c.approvedAmount ?? c.claimedAmount;
  const image = c.model ? vehicleImage(c.model) : undefined;
  const awaitingPerson = c.status === "Submitted" || c.status === "Under Review" || c.status === "Info Requested";

  return (
    <DetailScreen
      moduleHref="/dms/service/warranty"
      title={c.claimNo}
      badges={
        <>
          <StatusPill value={c.status} />
          <Pill tone="brand">{c.component}</Pill>
        </>
      }
      subtitle={
        <>
          {c.model ?? "Vehicle"} · <span className="font-mono">{c.vin}</span> · {c.dealer}
          {c.customer ? ` · ${c.customer}` : ""} · raised {formatDate(c.raisedAt)}
        </>
      }
      lead={
        image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="h-14 w-20 shrink-0 rounded-[10px] object-cover" style={{ background: "var(--bg)" }} />
        ) : undefined
      }
      actions={
        c.status === "Submitted" ? (
          <ActionForm action={reviewClaim.bind(null, c.id)}>
            <SubmitButton>Start review</SubmitButton>
          </ActionForm>
        ) : c.status === "Approved" ? (
          <>
            <ActionForm action={startRepair.bind(null, c.id)}>
              <SubmitButton>Start repair</SubmitButton>
            </ActionForm>
            <Hint>The dealer replaces the {c.component.toLowerCase()} under warranty.</Hint>
          </>
        ) : c.status === "In Repair" && PART_RETURN_REQUIRED.includes(c.component) && !c.partReturned ? (
          <>
            <ActionForm action={receivePart.bind(null, c.id)}>
              <SubmitButton>Failed part received</SubmitButton>
            </ActionForm>
            <Hint>Reimbursement waits for the part — the supplier needs it.</Hint>
          </>
        ) : c.status === "In Repair" ? (
          <>
            <ActionForm action={reimburseDealer.bind(null, c.id)}>
              <SubmitButton>Reimburse {formatINR(approved)}</SubmitButton>
            </ActionForm>
            <Hint>Issues a credit note to {c.dealer} and posts it to the books.</Hint>
          </>
        ) : undefined
      }
    >
      <Stepper
        label="Claim progress"
        steps={CLAIM_FLOW}
        current={stepOf(c)}
        complete={c.status === "Closed" || c.status === "Recovered"}
        reachedAt={reachedFrom(c.history ?? [])}
        stopped={c.status === "Rejected" ? { title: "Rejected.", detail: c.rejectionReason ?? "No reason was recorded." } : undefined}
      />

      <DetailColumns
        main={
          <>
            {c.adjudication && (
              <Panel
                title="Rules engine"
                description={`Ran ${formatDate(c.adjudication.at)} — every check it made, and what it found.`}
                headerExtra={<StatusPill value={c.adjudication.decision} />}
              >
                <ul className="space-y-1.5 text-[12.5px]">
                  {c.adjudication.reasons.map((r, i) => {
                    const bad = /^Outside|not a valid|not on the approved|incomplete/.test(r);
                    const open = /^No |cannot|possible duplicate|with no measured|routed for manual/.test(r);
                    const Icon = bad ? CircleX : open ? CircleAlert : CircleCheck;
                    return (
                      <li key={i} className="flex items-start gap-2">
                        <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: bad ? "var(--negative)" : open ? "var(--warning)" : "var(--positive)" }} />
                        <span>{r}</span>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            )}

            {c.status === "Info Requested" && (
              <Panel title="Waiting on the dealer" description={c.infoRequest ?? undefined}>
                <ActionForm action={supplyInfo.bind(null, c.id)} className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="field-label" htmlFor="si-odo">
                        Odometer (km)
                      </label>
                      <input id="si-odo" name="odometerKm" type="number" min={0} className="field" defaultValue={c.odometerKm ?? undefined} />
                    </div>
                    {c.component === "Battery Pack" && (
                      <>
                        <div>
                          <label className="field-label" htmlFor="si-soh">
                            Battery SoH %
                          </label>
                          <input id="si-soh" name="measuredSohPct" type="number" min={0} max={100} className="field" defaultValue={c.measuredSohPct ?? undefined} />
                        </div>
                        <div>
                          <label className="field-label" htmlFor="si-charger">
                            Charger used
                          </label>
                          <input id="si-charger" name="chargerType" list="si-chargers" maxLength={60} className="field" defaultValue={c.chargerType ?? ""} />
                          <datalist id="si-chargers">
                            {APPROVED_CHARGERS.map((x) => (
                              <option key={x} value={x} />
                            ))}
                          </datalist>
                        </div>
                      </>
                    )}
                    <div className="sm:col-span-3">
                      <label className="field-label" htmlFor="si-reply">
                        Dealer&apos;s reply
                      </label>
                      <input id="si-reply" name="reply" maxLength={500} className="field" placeholder="e.g. Photos of the swollen pack sent; customer uses the supplied charger" />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <SubmitButton>Record the answer</SubmitButton>
                    <Hint>The rules run again on the new evidence; the claim goes back to the reviewer with their verdict.</Hint>
                  </div>
                </ActionForm>
              </Panel>
            )}

            {awaitingPerson && (
              <Panel title="Decide" description={`Claimed ${formatINR(c.claimedAmount)}. Approve in full or in part, or reject with the reason the dealer will see.`}>
                <ActionForm action={decideClaim.bind(null, c.id)} className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                    <div>
                      <label className="field-label" htmlFor="d-amount">
                        Approve (₹)
                      </label>
                      <input id="d-amount" name="approvedAmount" type="number" min={1} max={c.claimedAmount} defaultValue={c.claimedAmount} className="field" />
                    </div>
                    <div>
                      <label className="field-label" htmlFor="d-note">
                        Note (required to reject)
                      </label>
                      <input id="d-note" name="note" maxLength={300} className="field" />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <SubmitButton name="decision" value="Approved">
                      Approve
                    </SubmitButton>
                    <SubmitButton tone="danger" name="decision" value="Rejected">
                      Reject
                    </SubmitButton>
                  </div>
                </ActionForm>
                {c.status !== "Info Requested" && (
                  <ActionForm action={requestInfo.bind(null, c.id)} className="mt-4 flex flex-wrap items-end gap-2 pt-4" >
                    <div className="min-w-[14rem] flex-1">
                      <label className="field-label" htmlFor="d-request">
                        Or ask the dealer for more
                      </label>
                      <input id="d-request" name="request" required minLength={5} maxLength={300} className="field" placeholder="e.g. Send the BMS log and the charger's label photo" />
                    </div>
                    <SubmitButton tone="ghost">Request info</SubmitButton>
                  </ActionForm>
                )}
              </Panel>
            )}

            {c.status === "Rejected" && (
              <Panel title="Reopen" description="For a goodwill case, or evidence the rules did not have. It goes back to a reviewer.">
                <ActionForm action={reopenClaim.bind(null, c.id)} className="flex flex-wrap items-end gap-2">
                  <input name="note" required minLength={5} maxLength={300} className="field min-w-[14rem] flex-1" placeholder="Why it is being looked at again" aria-label="Reason" />
                  <SubmitButton tone="ghost">
                    <RotateCcw className="h-3.5 w-3.5" /> Reopen
                  </SubmitButton>
                </ActionForm>
              </Panel>
            )}

            {c.status === "Reimbursed" && (
              <Panel title="Recover from the supplier" description={`The dealer has been paid ${formatINR(approved)}. Claim it back from whoever made the ${c.component.toLowerCase()}.`}>
                <ActionForm action={openRecovery.bind(null, c.id)} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
                  <div>
                    <label className="field-label" htmlFor="r-supplier">
                      Supplier
                    </label>
                    <input id="r-supplier" name="supplier" required minLength={2} maxLength={100} className="field" placeholder={`Maker of the ${c.component.toLowerCase()}`} />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="r-amount">
                      Amount (₹)
                    </label>
                    <input id="r-amount" name="amount" type="number" min={1} max={approved} defaultValue={approved} required className="field" />
                  </div>
                  <input name="notes" maxLength={300} className="field sm:col-span-2" placeholder="Notes for the supplier (optional)" aria-label="Notes" />
                  <div className="sm:col-span-2">
                    <SubmitButton>Open recovery</SubmitButton>
                  </div>
                </ActionForm>
              </Panel>
            )}

            {c.status === "Recovery" && c.recovery && (
              <Panel title={`Recovery from ${c.recovery.supplier}`} description={`${formatINR(c.recovery.amount)} claimed ${formatDate(c.recovery.openedAt)}.${c.recovery.notes ? ` ${c.recovery.notes}` : ""}`}>
                <ActionForm action={closeRecovery.bind(null, c.id)} className="grid gap-3 sm:grid-cols-2">
                  <input name="debitNote" maxLength={40} className="field" placeholder="Supplier debit note no." aria-label="Debit note" />
                  <input name="note" maxLength={300} className="field" placeholder="Note (required to write off)" aria-label="Note" />
                  <div className="flex flex-wrap gap-2 sm:col-span-2">
                    <SubmitButton name="outcome" value="Recovered">
                      Recovered
                    </SubmitButton>
                    <SubmitButton tone="danger" name="outcome" value="Written Off">
                      Write off
                    </SubmitButton>
                  </div>
                </ActionForm>
              </Panel>
            )}

            <Panel title="History" description="Every step, newest first — including what the rules engine decided.">
              <Timeline events={c.history ?? []} />
            </Panel>
          </>
        }
        side={
          <>
            <Panel title="The claim">
              <Facts
                rows={[
                  ["Claimed", formatINR(c.claimedAmount)],
                  c.approvedAmount != null && c.status !== "Rejected" && ["Approved", formatINR(c.approvedAmount)],
                  c.creditNoteNo && ["Credit note", c.creditNoteNo],
                  c.recovery && ["Recovery", `${c.recovery.status} · ${formatINR(c.recovery.amount)}`],
                  c.recoveryRef && ["Debit note", c.recoveryRef],
                  PART_RETURN_REQUIRED.includes(c.component) && ["Failed part", c.partReturned ? `Returned ${c.partReturnedAt ? formatDate(c.partReturnedAt) : ""}` : "Not yet returned"],
                ]}
              />
              {c.issue && (
                <p className="mt-3 rounded-[10px] px-3 py-2 text-[12.5px]" style={{ background: "var(--surface-subtle)" }}>
                  {c.issue}
                </p>
              )}
              {voucher && (
                <p className="mt-3 text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                  Credit note voucher {voucher.status.toLowerCase()}
                  {voucher.lastError ? ` — ${voucher.lastError}` : ""}.{" "}
                  <Link href={`/erp/accounting?q=${encodeURIComponent(c.claimNo)}`} className="underline">
                    Open in ERP / Accounting
                  </Link>
                </p>
              )}
            </Panel>

            <Panel title="Evidence" description={c.evidenceSource ? `Readings from ${c.evidenceSource === "Telematics" ? "the vehicle's telematics unit" : c.evidenceSource === "Job card" ? "the job card" : "the dealer"}.` : undefined}>
              <Facts
                rows={[
                  ["Odometer", c.odometerKm != null ? `${c.odometerKm.toLocaleString("en-IN")} km` : "Not given"],
                  c.component === "Battery Pack" && ["Battery SoH", c.measuredSohPct != null ? `${c.measuredSohPct}%` : "Not given"],
                  c.component === "Battery Pack" && ["Charger", c.chargerType ?? "Not given"],
                  ["Service records", c.serviceRecordsComplete == null ? "Not on file" : c.serviceRecordsComplete ? "Complete" : "Missed a free service"],
                  device && ["Live telematics", `${device.odometerKm.toLocaleString("en-IN")} km · SoH ${device.soh}% · ${device.status}`],
                ]}
              />
            </Panel>

            <Panel title="Cover" description={plan ? "Simulation policy, with the model's published warranty on battery and motor." : undefined}>
              {plan && c.coverStartedAt ? (
                <Facts
                  rows={[
                    ["Handed over", formatDate(c.coverStartedAt)],
                    ["Term", `${plan.termMonths} months${plan.termKm ? ` / ${plan.termKm.toLocaleString("en-IN")} km` : ""}`],
                    ["Covered until", formatDate(coverageEnds(c.coverStartedAt, plan))],
                    plan.sohFloorPct && ["SoH floor", `${plan.sohFloorPct}%`],
                  ]}
                />
              ) : (
                <p className="text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                  {c.model ? "This chassis has no handover on record in this network." : "Raised before cover was tracked on claims."}
                </p>
              )}
            </Panel>

            <Panel title="Linked">
              <ul className="space-y-1.5 text-[12.5px]">
                {job && (
                  <li>
                    <Link href={`/dms/service/jobcards/${job.id}`} className="underline">
                      Job card {job.jobNo}
                    </Link>{" "}
                    <span style={{ color: "var(--fg-muted)" }}>· {job.status}</span>
                  </li>
                )}
                {tickets.map((t) => (
                  <li key={t.id}>
                    <Link href={`/crm/support/${t.id}`} className="underline">
                      Ticket {t.ticketNo}
                    </Link>{" "}
                    <span style={{ color: "var(--fg-muted)" }}>· {t.status}</span>
                  </li>
                ))}
                {others.map((o) => (
                  <li key={o.id}>
                    <Link href={`/dms/service/warranty/${o.id}`} className="underline">
                      Claim {o.claimNo}
                    </Link>{" "}
                    <span style={{ color: "var(--fg-muted)" }}>
                      · {o.component} · {o.status}
                    </span>
                  </li>
                ))}
                <li>
                  <Link href={`/dms/service/warranty?vin=${encodeURIComponent(c.vin)}`} className="underline">
                    Coverage check for this chassis
                  </Link>
                </li>
              </ul>
            </Panel>
          </>
        }
      />
    </DetailScreen>
  );
}
