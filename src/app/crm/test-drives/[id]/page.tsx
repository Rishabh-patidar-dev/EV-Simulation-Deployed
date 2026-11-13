import Link from "next/link";
import { notFound } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import DetailScreen, { DetailColumns } from "@/components/shell/DetailScreen";
import ActionForm from "@/components/ui/ActionForm";
import { Panel } from "@/components/ui/cards";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill } from "@/components/ui/primitives";
import { Facts, Hint, SimulatedNote, Stepper, fullDate } from "@/components/ui/workflow";
import { isPast } from "@/lib/time";
import { vehicleImage } from "@/lib/vehicles";
import { cancelTestDrive, checkInTestDrive, completeTestDrive, markNoShow, rescheduleTestDrive, verifyLicence } from "@/server/actions/testDrives";
import { readMany } from "@/server/store";

export const dynamic = "force-dynamic";

const STEPS = ["Scheduled", "Checked In", "Completed"] as const;

export default async function TestDrivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await readMany(["test_drives", "leads", "quotations"] as const);
  const d = data.test_drives.find((x) => x.id === id);
  if (!d) notFound();

  const lead = d.leadId ? data.leads.find((l) => l.id === d.leadId) : undefined;
  const step = (STEPS as readonly string[]).indexOf(d.status);
  const image = vehicleImage(d.model);
  const slotPassed = isPast(d.slotAt);

  const actions =
    d.status === "Scheduled" ? (
      <>
        <ActionForm action={checkInTestDrive.bind(null, d.id)}>
          <SubmitButton>Customer is here — hand over the keys</SubmitButton>
        </ActionForm>
        <Hint>{d.licenceVerified ? "Licence verified." : "Verify the driving licence first."}</Hint>
      </>
    ) : d.status === "Completed" && lead && d.feedback?.interest !== "Cold" ? (
      <Link href={`/dms/quotations?new=1${lead.dealId ? `&deal=${lead.dealId}` : ""}`} className="btn btn-primary">
        Draft a quotation
      </Link>
    ) : null;

  return (
    <DetailScreen
      moduleHref="/crm/test-drives"
      title={d.driveNo}
      badges={
        <>
          <StatusPill value={d.status} />
          {d.licenceVerified ? <Pill tone="positive">Licence verified</Pill> : <Pill tone="warning">Licence not checked</Pill>}
        </>
      }
      subtitle={`${d.customer} · ${d.model} · ${d.dealer} · ${fullDate(d.slotAt)} for ${d.durationMin} min`}
      actions={actions}
    >
      <Stepper
        label="Test drive progress"
        steps={STEPS}
        current={Math.max(0, step)}
        complete={d.status === "Completed"}
        reachedAt={{ Scheduled: d.createdAt, Completed: d.completedAt ?? undefined }}
        stopped={
          d.status === "Cancelled" ? { title: "Cancelled.", detail: d.cancelReason ?? "" } : d.status === "No Show" ? { title: "No show.", detail: "The customer didn't come — reschedule if they call back." } : undefined
        }
      />

      <DetailColumns
        main={
          <>
            {(d.status === "Scheduled" || d.status === "Checked In") && !d.licenceVerified && (
              <Panel title="Driving licence" description="Checked before the keys are handed over.">
                <ActionForm action={verifyLicence.bind(null, d.id)} className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[14rem] flex-1">
                    <label className="field-label" htmlFor="td-dl">
                      Licence number
                    </label>
                    <input id="td-dl" name="licenceNo" required maxLength={20} className="field num uppercase" defaultValue={d.licenceNo ?? ""} placeholder="MH14 2011 0062821" />
                  </div>
                  <SubmitButton>Verify</SubmitButton>
                </ActionForm>
                <div className="mt-3">
                  <SimulatedNote>Checked for shape and year of issue here; a live system would confirm it against Sarathi, the national licence register.</SimulatedNote>
                </div>
              </Panel>
            )}

            {d.status === "Checked In" && (
              <Panel title="Feedback" description="Goes onto the lead: a note on its timeline, a nudge to its score, and a follow-up if they are keen.">
                <ActionForm action={completeTestDrive.bind(null, d.id)} className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <fieldset>
                      <legend className="field-label">How was the drive?</legend>
                      <div className="flex gap-3">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <label key={n} className="flex items-center gap-1 text-[13px]">
                            <input type="radio" name="rating" value={n} required defaultChecked={n === 4} /> {n}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                    <fieldset>
                      <legend className="field-label">How keen are they?</legend>
                      <div className="flex gap-3">
                        {(["Hot", "Warm", "Cold"] as const).map((v) => (
                          <label key={v} className="flex items-center gap-1 text-[13px]">
                            <input type="radio" name="interest" value={v} required defaultChecked={v === "Warm"} /> {v}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </div>
                  <textarea name="comments" maxLength={500} rows={3} className="field" placeholder="What they liked, what worried them — range, payload, price…" aria-label="Comments" />
                  <SubmitButton>Complete the drive</SubmitButton>
                </ActionForm>
              </Panel>
            )}

            {d.feedback && (
              <Panel title="Feedback">
                <Facts
                  rows={[
                    ["Rating", `${d.feedback.rating} / 5`],
                    ["Interest", d.feedback.interest],
                    d.feedback.comments && ["Comments", d.feedback.comments],
                    d.completedAt && ["Completed", fullDate(d.completedAt)],
                  ]}
                />
              </Panel>
            )}
          </>
        }
        side={
          <>
            <Panel title="Drive">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="" className="mb-3 h-28 w-full rounded-[10px] object-cover" style={{ background: "var(--bg)" }} />
              ) : null}
              <Facts
                rows={[
                  ["Customer", d.customer],
                  ["Mobile", d.phone],
                  ["Demo vehicle", `${d.model} at ${d.dealer}`],
                  ["Slot", fullDate(d.slotAt)],
                  ["Booked via", d.bookedVia],
                  ["Booked by", d.createdBy],
                  d.licenceNo && ["Licence", d.licenceNo],
                ]}
              />
            </Panel>

            <Panel title="Lead" action={lead ? { href: `/crm/leads/${lead.id}`, label: "Open the lead" } : undefined}>
              {lead ? (
                <Facts
                  rows={[
                    ["Lead", lead.name],
                    ["Status", <StatusPill key="s" value={lead.status} />],
                    ["Score", String(lead.score)],
                    ["Owner", lead.assignedTo ?? "Unassigned"],
                    ["Next", lead.nextAction],
                  ]}
                />
              ) : (
                <p className="text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                  A walk-in — not linked to a lead.
                </p>
              )}
            </Panel>

            {(d.status === "Scheduled" || d.status === "No Show") && (
              <details className="disclosure surface" open={d.status === "No Show"}>
                <summary className="px-4 py-3 text-[12.5px] font-semibold" style={{ color: "var(--brand-ink)" }}>
                  Reschedule…
                </summary>
                <ActionForm action={rescheduleTestDrive.bind(null, d.id)} className="space-y-2 px-4 pb-4">
                  <input name="slotAt" type="datetime-local" required className="field" aria-label="New slot (IST)" />
                  <SubmitButton size="sm">Move the slot</SubmitButton>
                </ActionForm>
              </details>
            )}

            {d.status === "Scheduled" && slotPassed && (
              <ActionForm action={markNoShow.bind(null, d.id)}>
                <SubmitButton size="sm" tone="ghost" className="w-full">
                  Mark as no-show
                </SubmitButton>
              </ActionForm>
            )}

            {(d.status === "Scheduled" || d.status === "Checked In") && (
              <details className="disclosure surface">
                <summary className="flex items-center gap-2 px-4 py-3 text-[12.5px] font-semibold" style={{ color: "var(--negative)" }}>
                  <TriangleAlert className="h-4 w-4" />
                  Cancel the drive…
                </summary>
                <ActionForm action={cancelTestDrive.bind(null, d.id)} className="space-y-2 px-4 pb-4">
                  <input name="reason" required minLength={3} maxLength={200} className="field" placeholder="Reason" aria-label="Reason" />
                  <SubmitButton size="sm" tone="danger">
                    Cancel
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
