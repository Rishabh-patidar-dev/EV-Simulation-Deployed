import Link from "next/link";
import { notFound } from "next/navigation";
import DetailScreen, { DetailColumns } from "@/components/shell/DetailScreen";
import ActionForm from "@/components/ui/ActionForm";
import { Panel } from "@/components/ui/cards";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill, formatDate } from "@/components/ui/primitives";
import { Facts, Hint, Stepper, Timeline, reachedFrom } from "@/components/ui/workflow";
import { rupees } from "@/lib/gst";
import { TP_WARNING_DAYS } from "@/lib/rto";
import { daysUntilIso } from "@/lib/time";
import { approveRegistration, issueRc, raiseObjection, recordHsrp, resolveObjection, submitToRto, updateRtoDocuments } from "@/server/actions/rto";
import { readMany } from "@/server/store";
import { RTO_FLOW } from "@/server/types";

export const dynamic = "force-dynamic";

export default async function RegistrationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await readMany(["registrations", "deliveries", "insurance_policies"] as const);
  const r = data.registrations.find((x) => x.id === id);
  if (!r) notFound();

  const delivery = r.deliveryId ? data.deliveries.find((d) => d.id === r.deliveryId) : undefined;
  const policy = data.insurance_policies.find((p) => p.vehicleUnitId === r.vehicleUnitId && p.status === "Issued");
  const done = r.status === "Approved" || r.status === "RC Issued";
  const tpDays = daysUntilIso(r.tpValidUntil);
  const step = r.status === "Objection" ? 2 : (RTO_FLOW as readonly string[]).indexOf(r.status);
  const [statePart] = r.rtoOffice.split(" ");

  const actions =
    r.status === "Documents Ready" ? (
      <>
        <ActionForm action={submitToRto.bind(null, r.id)}>
          <SubmitButton>File on Vahan</SubmitButton>
        </ActionForm>
        <Hint>Submits Form 20 with the file to {r.rtoOffice}.</Hint>
      </>
    ) : r.status === "Approved" && !r.hsrpFittedAt ? (
      <ActionForm action={recordHsrp.bind(null, r.id)}>
        <SubmitButton>HSRP plates fitted</SubmitButton>
      </ActionForm>
    ) : r.status === "Approved" ? (
      <ActionForm action={issueRc.bind(null, r.id)}>
        <SubmitButton>RC issued</SubmitButton>
      </ActionForm>
    ) : null;

  return (
    <DetailScreen
      moduleHref="/dms/rto"
      title={<span className="num">{r.registrationNo ?? r.tpNo}</span>}
      badges={
        <>
          <StatusPill value={r.status} />
          {!done && <Pill tone={tpDays < 0 ? "negative" : tpDays <= TP_WARNING_DAYS ? "warning" : "neutral"}>{tpDays < 0 ? `TP lapsed ${-tpDays}d ago` : `TP ${tpDays}d left`}</Pill>}
        </>
      }
      subtitle={`${r.customer} · ${r.model} · chassis ${r.vin} · ${r.rtoOffice}`}
      actions={actions}
    >
      <Stepper
        label="Registration progress"
        steps={RTO_FLOW}
        current={Math.max(0, step)}
        complete={r.status === "RC Issued"}
        reachedAt={reachedFrom(r.history)}
      />

      <DetailColumns
        main={
          <>
            {r.status === "Objection" && (
              <Panel title="RTO objection" description="Answer it, then re-submit the file.">
                <p className="mb-3 rounded-[10px] px-3 py-2 text-[12.5px]" style={{ background: "var(--warning-surface)", color: "var(--warning)" }}>
                  {r.objection}
                </p>
                <ActionForm action={resolveObjection.bind(null, r.id)} className="flex flex-wrap gap-2">
                  <input name="note" required minLength={3} maxLength={300} className="field min-w-0 flex-1" placeholder="How it was answered" aria-label="Response" />
                  <SubmitButton size="sm">Re-submit</SubmitButton>
                </ActionForm>
              </Panel>
            )}

            {(r.status === "TP Issued" || r.status === "Documents Ready" || r.status === "Objection") && (
              <Panel title="Document file" description="Form 20 application, Form 21 sale certificate, Form 22 roadworthiness, insurance, invoice and address proof.">
                <ActionForm action={updateRtoDocuments.bind(null, r.id)} className="space-y-3">
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {r.documents.map((d) => (
                      <li key={d.name}>
                        <label className="flex items-center gap-2 text-[12.5px]">
                          <input type="checkbox" name="doc" value={d.name} defaultChecked={d.ready} />
                          {d.name}
                          {d.name === "Insurance" && policy && <span style={{ color: "var(--fg-faint)" }}>· {policy.policyNo}</span>}
                        </label>
                      </li>
                    ))}
                  </ul>
                  <SubmitButton size="sm" tone="ghost">
                    Save documents
                  </SubmitButton>
                </ActionForm>
              </Panel>
            )}

            {r.status === "Submitted" && (
              <div className="grid gap-4 md:grid-cols-2">
                <Panel title="RTO approved" description="Enter the number the RTO allotted.">
                  <ActionForm action={approveRegistration.bind(null, r.id)} className="space-y-2.5">
                    <div className="flex items-end gap-2">
                      <span className="num pb-2 text-[13px] font-semibold">{statePart.replace("-", " ")}</span>
                      <div className="w-20">
                        <label className="field-label" htmlFor="reg-series">
                          Series
                        </label>
                        <input id="reg-series" name="series" required maxLength={3} className="field uppercase" defaultValue="EV" />
                      </div>
                      <div className="w-28">
                        <label className="field-label" htmlFor="reg-number">
                          Number
                        </label>
                        <input id="reg-number" name="number" type="number" min={1} max={9999} required className="field" />
                      </div>
                    </div>
                    <SubmitButton size="sm">Record approval</SubmitButton>
                  </ActionForm>
                </Panel>
                <Panel title="RTO objected" description="Record what the RTO came back with.">
                  <ActionForm action={raiseObjection.bind(null, r.id)} className="space-y-2.5">
                    <input name="objection" required minLength={3} maxLength={300} className="field" placeholder="e.g. Address proof unclear" aria-label="Objection" />
                    <SubmitButton size="sm" tone="danger">
                      Record objection
                    </SubmitButton>
                  </ActionForm>
                </Panel>
              </div>
            )}

            <Panel title="History" description="Every step, newest first.">
              <Timeline events={r.history} />
            </Panel>
          </>
        }
        side={
          <>
            <Panel title="Registration">
              <Facts
                rows={[
                  ["Application", r.appNo],
                  ["Class", r.vehicleClass],
                  ["RTO", r.rtoOffice],
                  ["TP", r.tpNo],
                  ["TP valid until", formatDate(r.tpValidUntil)],
                  r.vahanAppNo && ["Vahan application", r.vahanAppNo],
                  r.registrationNo && ["Registration", r.registrationNo],
                  r.hsrpFittedAt && ["HSRP fitted", formatDate(r.hsrpFittedAt)],
                  r.rcIssuedAt && ["RC issued", formatDate(r.rcIssuedAt)],
                ]}
              />
            </Panel>
            <Panel title="Fees">
              <Facts
                rows={[
                  ["Registration", r.fees.registration ? rupees(r.fees.registration) : "Exempt (battery vehicle)"],
                  ["Road tax", r.fees.roadTax ? rupees(r.fees.roadTax) : "EV exemption"],
                  ["HSRP", rupees(r.fees.hsrp)],
                ]}
              />
            </Panel>
            <Panel title="Vehicle">
              <Facts
                rows={[
                  ["Chassis", r.vin],
                  ["Model", r.model],
                  ["Owner", r.customer],
                  ["Dealer", r.dealer],
                  delivery && ["Delivery", <Link key="d" href={`/dms/orders/delivery/${delivery.id}`} className="underline">{delivery.deliveryNo}</Link>],
                  ["Insurance", policy ? `${policy.insurer} · ${policy.policyNo}` : "Not on record"],
                ]}
              />
            </Panel>
          </>
        }
      />
    </DetailScreen>
  );
}
