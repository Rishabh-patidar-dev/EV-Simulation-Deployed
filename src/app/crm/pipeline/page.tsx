import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import Disclosure from "@/components/ui/Disclosure";
import SubmitButton from "@/components/ui/SubmitButton";
import { formatINR } from "@/components/ui/primitives";
import { VEHICLE_MODELS, vehicleImage } from "@/lib/vehicles";
import { filterRows, readQuery } from "@/lib/search";
import { advanceDealStage, createDeal, deleteDeal, revertDealStage, updateDeal } from "@/server/actions/crm";
import { readMany } from "@/server/store";
import { DEAL_STAGES } from "@/server/types";

export const dynamic = "force-dynamic";

/**
 * Board rather than a table: the question a sales head asks of a pipeline is
 * "where is everything stuck", which a stage-per-column layout answers at a
 * glance and a sortable list does not.
 *
 * Moving a deal into "Booked" is the CRM → DMS handoff — it creates a real
 * Booking row (see advanceDealStage), so the deal disappears from the open
 * board and reappears on /crm/bookings with the same customer and value.
 */
export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [{ data }, q] = await Promise.all([readMany(["deals", "dealers"] as const), readQuery(searchParams)]);
  const dealerNames = data.dealers.filter((d) => d.status === "Active").map((d) => d.name);
  const deals = filterRows(data.deals, q);

  const open = data.deals.filter((d) => d.stage !== "Booked");
  const stalled = data.deals.filter((d) => d.ageingDays > 30 && d.stage !== "Booked");

  return (
    <ModuleScreen
      href="/crm/pipeline"
      exportCollection="deals"
      searchPlaceholder="Search deals"
      stats={[
        { label: "Open deals", value: String(open.length), hint: `${deals.length} shown` },
        { label: "Open value", value: formatINR(open.reduce((s, d) => s + d.value, 0)), hint: "Everything not yet booked" },
        { label: "Booked this cycle", value: String(data.deals.filter((d) => d.stage === "Booked").length), hint: "Converted to a booking" },
        { label: "Stalled over 30 days", value: String(stalled.length), hint: "No stage movement" },
      ]}
      toolbar={
        <Disclosure label="New deal">
          <ActionForm action={createDeal} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="field-label">Customer</label>
              <input name="customer" required className="field" placeholder="Customer name" />
            </div>
            <div>
              <label className="field-label">Phone</label>
              <input name="phone" className="field" placeholder="+91 90000 00000" />
            </div>
            <div>
              <label className="field-label">Dealer</label>
              <select name="dealer" className="field" defaultValue="">
                <option value="" disabled>Choose dealer…</option>
                {dealerNames.map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Model</label>
              <select name="model" className="field" defaultValue={VEHICLE_MODELS[0]}>
                {VEHICLE_MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Est. value (₹)</label>
              <input name="value" type="number" min={0} step={1} defaultValue={150000} className="field" />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <SubmitButton>Add deal</SubmitButton>
            </div>
          </ActionForm>
        </Disclosure>
      }
    >
      <div className="overflow-x-auto p-4">
        <div className="grid min-w-[1100px] grid-cols-5 gap-3">
          {DEAL_STAGES.map((stage) => {
            const inStage = deals.filter((d) => d.stage === stage);
            const value = inStage.reduce((s, d) => s + d.value, 0);
            return (
              <div key={stage} className="min-w-0 rounded-[12px] p-2.5" style={{ background: "var(--bg)" }}>
                <div className="mb-2.5 px-1">
                  <p className="text-[12px] font-semibold">{stage}</p>
                  <p className="num text-[11px]" style={{ color: "var(--fg-muted)" }}>
                    {inStage.length} · {formatINR(value)}
                  </p>
                </div>

                <ul className="space-y-2">
                  {inStage.slice(0, 20).map((deal) => {
                    const image = vehicleImage(deal.model);
                    return (
                      <li
                        key={deal.id}
                        className="overflow-hidden rounded-[10px]"
                        style={{ background: "var(--card)", border: "1px solid var(--border)" }}
                      >
                        {image && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={image} alt={deal.model} className="h-20 w-full object-cover" style={{ background: "var(--bg)" }} />
                        )}
                        <div className="px-3 py-2.5">
                          <p className="truncate text-[12.5px] font-medium">{deal.customer}</p>
                          <p className="truncate text-[11px]" style={{ color: "var(--fg-muted)" }}>
                            {deal.model}
                          </p>
                          <p className="truncate text-[11px]" style={{ color: "var(--fg-faint)" }}>
                            {deal.dealer}
                          </p>
                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            <span className="num text-[12px] font-semibold">{formatINR(deal.value)}</span>
                            <span
                              className="num text-[10.5px]"
                              style={{ color: deal.ageingDays > 30 ? "var(--negative)" : "var(--fg-faint)" }}
                            >
                              {deal.ageingDays}d
                            </span>
                          </div>
                          {stage !== "Booked" && (
                            <div className="mt-2 flex items-center gap-1.5">
                              {stage !== "Qualified" && (
                                <ActionForm action={revertDealStage.bind(null, deal.id)}>
                                  <SubmitButton size="sm" tone="ghost" label="Move back a stage">
                                    <ArrowLeft className="h-3 w-3" />
                                  </SubmitButton>
                                </ActionForm>
                              )}
                              {(stage === "Quotation" || stage === "Negotiation") && (
                                <Link href={`/dms/quotations?deal=${deal.id}`} className="btn btn-ghost btn-sm" title="Draft a GST quotation for this deal">
                                  Quote
                                </Link>
                              )}
                              <ActionForm action={advanceDealStage.bind(null, deal.id)} className="flex-1">
                                <SubmitButton size="sm" className="w-full">
                                  {stage === "Negotiation" ? "Book" : "Advance"} <ArrowRight className="h-3 w-3" />
                                </SubmitButton>
                              </ActionForm>
                            </div>
                          )}
                          {stage !== "Booked" && (
                            <details className="mt-1.5">
                              <summary className="cursor-pointer text-[11px] font-semibold" style={{ color: "var(--brand-ink)" }}>
                                Edit…
                              </summary>
                              <div className="mt-1.5 space-y-2">
                                <ActionForm action={updateDeal.bind(null, deal.id)} className="space-y-1.5">
                                  <input name="customer" defaultValue={deal.customer} required maxLength={200} className="field text-[12px]" aria-label="Customer" />
                                  <input name="value" type="number" min={0} step={1} defaultValue={deal.value} className="field text-[12px]" aria-label="Deal value" />
                                  <input name="expectedClose" type="date" required defaultValue={deal.expectedClose.slice(0, 10)} className="field text-[12px]" aria-label="Expected close" />
                                  <SubmitButton size="sm" className="w-full">Save deal</SubmitButton>
                                </ActionForm>
                                <ActionForm action={deleteDeal.bind(null, deal.id)}>
                                  <SubmitButton size="sm" tone="danger" className="w-full">Delete deal</SubmitButton>
                                </ActionForm>
                              </div>
                            </details>
                          )}
                          {stage === "Booked" && (
                            <p className="mt-2 text-[10.5px]" style={{ color: "var(--brand-ink)" }}>
                              Booking created ✓
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                  {inStage.length === 0 && (
                    <li className="px-1 py-3 text-center text-[11.5px]" style={{ color: "var(--fg-faint)" }}>
                      Empty
                    </li>
                  )}
                  {inStage.length > 20 && (
                    <li className="px-1 pt-1 text-[11px]" style={{ color: "var(--fg-muted)" }}>
                      +{inStage.length - 20} more
                    </li>
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </ModuleScreen>
  );
}
