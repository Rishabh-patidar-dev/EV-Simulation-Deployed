import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, X } from "lucide-react";
import DetailScreen, { DetailColumns } from "@/components/shell/DetailScreen";
import ActionForm from "@/components/ui/ActionForm";
import { Panel } from "@/components/ui/cards";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill, formatDate } from "@/components/ui/primitives";
import { Facts, Hint, SimulatedNote, Stepper, Timeline, fullDate, reachedFrom } from "@/components/ui/workflow";
import { vehicleImage } from "@/lib/vehicles";
import { allocateVehicles, completeHandover, dispatchDelivery, recordPdi, releaseVehicle, rescheduleDelivery } from "@/server/actions/delivery";
import { readMany } from "@/server/store";
import { DELIVERY_FLOW, PDI_CHECKS } from "@/server/types";

export const dynamic = "force-dynamic";

export default async function DeliveryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await readMany(["deliveries", "vehicle_units", "insurance_policies", "bookings", "registrations", "tax_invoices", "finance_cases"] as const);
  const d = data.deliveries.find((x) => x.id === id);
  if (!d) notFound();

  const booking = data.bookings.find((b) => b.id === d.bookingId);
  const policies = data.insurance_policies.filter((p) => p.status === "Issued");
  const insuredUnit = (unitId: string) => policies.find((p) => p.vehicleUnitId === unitId);
  const available = data.vehicle_units
    .filter((u) => u.model === d.model && (u.status === "In Stock" || (u.status === "Allocated" && !u.bookingId)))
    .sort((a, b) => b.ageingDays - a.ageingDays);
  const needed = d.quantity - d.vehicles.length;
  const uninsured = d.vehicles.filter((v) => !insuredUnit(v.vehicleUnitId));
  const registrations = data.registrations.filter((r) => r.deliveryId === d.id);
  const invoice = d.taxInvoiceId ? data.tax_invoices.find((i) => i.id === d.taxInvoiceId) : undefined;
  const loan = data.finance_cases.find((c) => c.bookingId === d.bookingId && c.status === "Disbursed");
  const step = (DELIVERY_FLOW as readonly string[]).indexOf(d.status);
  const image = vehicleImage(d.model);

  const actions =
    d.status === "PDI Done" ? (
      <>
        <ActionForm action={dispatchDelivery.bind(null, d.id)}>
          <SubmitButton>Dispatch — gate pass &amp; e-way bill</SubmitButton>
        </ActionForm>
        <Hint>{uninsured.length ? `${uninsured.length} vehicle${uninsured.length === 1 ? "" : "s"} still need insurance.` : "Sends the customer the handover OTP."}</Hint>
      </>
    ) : d.status === "Scheduled" ? (
      <Hint>
        {needed > 0 ? `${needed} vehicle${needed === 1 ? "" : "s"} to allocate, then` : "Next:"} the PDI on each chassis.
      </Hint>
    ) : null;

  return (
    <DetailScreen
      moduleHref="/dms/orders/delivery"
      title={d.deliveryNo}
      badges={<StatusPill value={d.status} />}
      subtitle={`${d.customer} · ${d.quantity} × ${d.model} · ${d.dealer} · ${d.status === "Handed Over" && d.handover ? `handed over ${formatDate(d.handover.at)}` : `scheduled ${formatDate(d.scheduledFor)}`}`}
      actions={actions}
    >
      <Stepper
        label="Delivery progress"
        steps={DELIVERY_FLOW}
        current={Math.max(0, step)}
        complete={d.status === "Handed Over"}
        reachedAt={reachedFrom(d.history)}
        stopped={d.status === "Cancelled" ? { title: "Cancelled.", detail: [...d.history].reverse().find((e) => e.status === "Cancelled")?.note ?? "" } : undefined}
      />

      <DetailColumns
        main={
          <>
            {d.status === "Scheduled" && needed > 0 && (
              <Panel title="Allocate vehicles" description={`${needed} of ${d.quantity} still to allocate — oldest stock first.`}>
                {available.length ? (
                  <ActionForm action={allocateVehicles.bind(null, d.id)} className="space-y-3">
                    <ul className="grid max-h-64 gap-1.5 overflow-y-auto sm:grid-cols-2">
                      {available.map((u) => (
                        <li key={u.id}>
                          <label className="flex items-center gap-2 rounded-[8px] px-2 py-1.5 text-[12.5px] hover:bg-[color:var(--hover)]">
                            <input type="checkbox" name="unit" value={u.id} />
                            <span className="num font-medium">{u.vin}</span>
                            <span style={{ color: "var(--fg-muted)" }}>
                              {u.variant} · {u.location} · {u.ageingDays}d
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap gap-2">
                      <SubmitButton size="sm">Allocate ticked</SubmitButton>
                      <SubmitButton size="sm" tone="ghost" name="auto" value="1">
                        Allocate the {Math.min(needed, available.length)} oldest
                      </SubmitButton>
                    </div>
                  </ActionForm>
                ) : (
                  <p className="text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                    No {d.model} in stock.{" "}
                    <Link href="/dms/orders?new=1" className="underline">
                      Place a dealer order
                    </Link>{" "}
                    — vehicles land in stock when the order is received.
                  </p>
                )}
              </Panel>
            )}

            <Panel title="Vehicles & PDI" description={`${PDI_CHECKS.length}-point pre-delivery inspection, signed off per chassis.`} bodyClassName="p-0!">
              {d.vehicles.length ? (
                <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
                  {d.vehicles.map((v) => {
                    const policy = insuredUnit(v.vehicleUnitId);
                    const reg = registrations.find((r) => r.vehicleUnitId === v.vehicleUnitId);
                    return (
                      <li key={v.vehicleUnitId} className="px-4 py-3" style={{ borderColor: "var(--border)" }}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="flex items-center gap-2">
                            <span className="num font-semibold">{v.vin}</span>
                            <span className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
                              {v.variant}
                            </span>
                          </span>
                          <span className="flex flex-wrap items-center gap-1">
                            {v.pdiAt ? <Pill tone="positive">PDI passed</Pill> : <Pill tone="warning">{v.pdi.filter(Boolean).length}/{PDI_CHECKS.length} checks</Pill>}
                            {policy ? <Pill tone="positive">Insured · {policy.insurer}</Pill> : <Pill tone="negative">Uninsured</Pill>}
                            {reg && (
                              <Link href={`/dms/rto/${reg.id}`}>
                                <Pill tone="info">{reg.registrationNo ?? reg.tpNo}</Pill>
                              </Link>
                            )}
                          </span>
                        </div>
                        {d.status === "Scheduled" ? (
                          <ActionForm action={recordPdi.bind(null, d.id)} className="mt-2 space-y-2">
                            <input type="hidden" name="vehicleUnitId" value={v.vehicleUnitId} />
                            <ul className="grid gap-1 sm:grid-cols-2">
                              {PDI_CHECKS.map((check, i) => (
                                <li key={check}>
                                  <label className="flex items-center gap-2 text-[12px]">
                                    <input type="checkbox" name="check" value={i} defaultChecked={v.pdi[i]} />
                                    {check}
                                  </label>
                                </li>
                              ))}
                            </ul>
                            <div className="flex flex-wrap gap-2">
                              <SubmitButton size="sm" tone="ghost">
                                Save PDI
                              </SubmitButton>
                            </div>
                          </ActionForm>
                        ) : (
                          <p className="mt-1 text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                            {v.pdiAt ? `PDI signed off ${fullDate(v.pdiAt)} by ${v.pdiBy}` : "PDI not recorded"}
                          </p>
                        )}
                        {d.status === "Scheduled" && (
                          <ActionForm action={releaseVehicle.bind(null, d.id, v.vehicleUnitId)} className="mt-1">
                            <SubmitButton size="sm" tone="ghost">
                              Release back to stock
                            </SubmitButton>
                          </ActionForm>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="px-4 py-6 text-center text-[13px]" style={{ color: "var(--fg-muted)" }}>
                  No vehicles allocated yet.
                </p>
              )}
            </Panel>

            {d.status === "Dispatched" && (
              <Panel title="Handover" description="At the customer: confirm the OTP they received, who took the vehicles, and the handover photo.">
                <ActionForm action={completeHandover.bind(null, d.id)} className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className="field-label" htmlFor="handover-otp">
                      Customer&apos;s OTP
                    </label>
                    <input id="handover-otp" name="otp" required inputMode="numeric" maxLength={6} className="field num tracking-[0.3em]" placeholder="••••••" />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="handover-by">
                      Received by
                    </label>
                    <input id="handover-by" name="acknowledgedBy" required maxLength={120} className="field" defaultValue={d.customer} />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="handover-km">
                      Odometer (km)
                    </label>
                    <input id="handover-km" name="odometerKm" type="number" min={0} max={500} defaultValue={2} className="field" />
                  </div>
                  <label className="flex items-center gap-2 text-[12.5px] sm:col-span-3">
                    <input type="checkbox" name="photo" /> Handover photo taken with the customer and the vehicles
                  </label>
                  <div className="sm:col-span-3">
                    <SubmitButton>Complete handover</SubmitButton>
                  </div>
                  <div className="sm:col-span-3">
                    <SimulatedNote>
                      The OTP went out as a WhatsApp message — in this simulation you can read it in API Integrations → Messages. Completing the handover books the
                      stock out, issues the GST invoice, opens the RTO files and activates telematics.
                    </SimulatedNote>
                  </div>
                </ActionForm>
              </Panel>
            )}

            <Panel title="History" description="Every step, newest first.">
              <Timeline events={d.history} />
            </Panel>
          </>
        }
        side={
          <>
            <Panel title="Booking" action={booking ? { href: `/crm/bookings?q=${encodeURIComponent(booking.bookingNo)}`, label: "Open in Bookings" } : undefined}>
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="" className="mb-3 h-28 w-full rounded-[10px] object-cover" style={{ background: "var(--bg)" }} />
              ) : null}
              <Facts
                rows={[
                  ["Booking", d.bookingNo],
                  ["Customer", d.customer],
                  d.phone && ["Mobile", d.phone],
                  ["Vehicles", `${d.quantity} × ${d.model}`],
                  booking && ["Booking status", <StatusPill key="b" value={booking.status} />],
                  loan && ["Loan", <Link key="l" href={`/dms/finance-insurance/${loan.id}`} className="underline">{loan.caseNo} · disbursed</Link>],
                ]}
              />
            </Panel>

            <Panel title="Insurance" action={{ href: `/dms/finance-insurance/insurance?booking=${d.bookingId}`, label: "Compare and issue" }}>
              <p className="text-[12.5px]">
                {d.vehicles.length === 0
                  ? "Policies are issued per chassis once vehicles are allocated."
                  : uninsured.length
                    ? `${uninsured.length} of ${d.vehicles.length} vehicles still need a policy — required before dispatch.`
                    : `All ${d.vehicles.length} vehicles are insured.`}
              </p>
            </Panel>

            {(d.gatePassNo || d.handover) && (
              <Panel title="Dispatch & handover">
                <Facts
                  rows={[
                    d.gatePassNo && ["Gate pass", d.gatePassNo],
                    d.ewayBillNo && ["E-way bill", d.ewayBillNo],
                    d.dispatchedAt && ["Dispatched", fullDate(d.dispatchedAt)],
                    d.handover && ["Handed over", fullDate(d.handover.at)],
                    d.handover && ["Received by", d.handover.acknowledgedBy],
                    d.handover && ["Odometer", `${d.handover.odometerKm} km`],
                    d.handover && ["Photo", d.handover.photoRef],
                    invoice && ["Tax invoice", <Link key="i" href={`/dms/quotations/invoices/${invoice.id}`} className="underline">{invoice.invoiceNo}</Link>],
                  ]}
                />
              </Panel>
            )}

            {registrations.length > 0 && (
              <Panel title="Registration" action={{ href: `/dms/rto?q=${encodeURIComponent(d.bookingNo)}`, label: "Open in RTO & Registration" }}>
                <ul className="space-y-1.5 text-[12.5px]">
                  {registrations.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-2">
                      <Link href={`/dms/rto/${r.id}`} className="num underline">
                        {r.registrationNo ?? r.tpNo}
                      </Link>
                      <StatusPill value={r.status} />
                    </li>
                  ))}
                </ul>
              </Panel>
            )}

            {(d.status === "Scheduled" || d.status === "PDI Done") && (
              <details className="disclosure surface">
                <summary className="px-4 py-3 text-[12.5px] font-semibold" style={{ color: "var(--brand-ink)" }}>
                  Reschedule…
                </summary>
                <ActionForm action={rescheduleDelivery.bind(null, d.id)} className="flex gap-2 px-4 pb-4">
                  <input name="scheduledFor" type="date" required className="field" aria-label="New delivery date" />
                  <SubmitButton size="sm">Save</SubmitButton>
                </ActionForm>
              </details>
            )}

            {d.status === "Handed Over" && (
              <p className="flex items-center justify-center gap-1.5 text-[12px]" style={{ color: "var(--positive)" }}>
                <Check className="h-4 w-4" /> Delivered and invoiced
              </p>
            )}
            {d.status === "Cancelled" && (
              <p className="flex items-center justify-center gap-1.5 text-[12px]" style={{ color: "var(--negative)" }}>
                <X className="h-4 w-4" /> Cancelled with its booking
              </p>
            )}
          </>
        }
      />
    </DetailScreen>
  );
}
