import { quotationTabs } from "@/components/quotations/tabs";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import Disclosure from "@/components/ui/Disclosure";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, formatDate, formatINR } from "@/components/ui/primitives";
import { FilterChips, Tabs, withParams } from "@/components/ui/workflow";
import { pmEDriveIncentive } from "@/lib/finance";
import { GST_RATE_VEHICLE } from "@/lib/gst";
import { filterRows } from "@/lib/search";
import { vehicleImage } from "@/lib/vehicles";
import { createProduct, deleteProduct, setProductActive, updateProduct, updateVariantPrice } from "@/server/actions/quotations";
import { readMany } from "@/server/store";
import { BODY_TYPES, ORDER_VARIANTS, RTO_CLASSES } from "@/server/types";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * The catalogue quotations are priced from: every model with its published
 * specification, and per variant the customer ex-showroom price, the dealer
 * price and the battery energy the PM E-DRIVE incentive is computed on.
 */
export default async function PriceListPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const q = one(raw.q);
  const segment = one(raw.segment) || undefined;

  const { data } = await readMany(["products", "quotations", "tax_invoices"] as const);
  const products = [...data.products].sort((a, b) => a.segment.localeCompare(b.segment) || a.model.localeCompare(b.model));
  const shown = filterRows(products, q).filter((p) => !segment || p.segment === segment);
  const prices = products.flatMap((p) => p.variants.map((v) => v.exShowroom));
  const eligible = products.filter((p) => p.subsidyEligible && p.segment === "L3");

  return (
    <ModuleScreen
      href="/dms/quotations"
      exportCollection="products"
      searchPlaceholder="Search models"
      tabs={<Tabs current="/dms/quotations/price-list" tabs={quotationTabs({ quotes: data.quotations.length, invoices: data.tax_invoices.length, models: products.length })} />}
      toolbar={
        <Disclosure label="Add model" open={one(raw.new) === "1"}>
          <ActionForm action={createProduct} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="field-label">Model</label>
              <input name="model" required maxLength={60} className="field" placeholder="LX EV Cargo" />
            </div>
            <div>
              <label className="field-label">Segment</label>
              <select name="segment" className="field" defaultValue="L3">
                <option value="L3">L3</option>
                <option value="L5">L5</option>
              </select>
            </div>
            <div>
              <label className="field-label">Body type</label>
              <select name="bodyType" className="field" defaultValue="Cargo">
                {BODY_TYPES.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">RTO class</label>
              <select name="rtoClass" className="field" defaultValue="e-Cart">
                {RTO_CLASSES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Motor</label>
              <input name="motor" maxLength={60} className="field" placeholder="1200W BLDC" />
            </div>
            <div>
              <label className="field-label">Battery</label>
              <input name="battery" maxLength={60} className="field" placeholder="48V 100Ah lithium" />
            </div>
            <div>
              <label className="field-label">Range</label>
              <input name="range" maxLength={40} className="field" placeholder="110 km" />
            </div>
            <div>
              <label className="field-label">Capacity</label>
              <input name="capacity" maxLength={40} className="field" placeholder="4 + driver" />
            </div>
            <div>
              <label className="field-label">Warranty</label>
              <input name="warranty" maxLength={60} className="field" placeholder="3 years / 40,000 km" />
            </div>
            <div>
              <label className="field-label">First variant</label>
              <select name="variant" className="field" defaultValue="Standard">
                {ORDER_VARIANTS.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Ex-showroom (₹)</label>
              <input name="exShowroom" type="number" min={10000} step={1} defaultValue={165000} className="field" />
            </div>
            <div>
              <label className="field-label">Dealer price (₹)</label>
              <input name="dealerPrice" type="number" min={10000} step={1} defaultValue={140000} className="field" />
            </div>
            <div>
              <label className="field-label">Battery energy (kWh)</label>
              <input name="batteryKwh" type="number" min={1} max={30} step={0.1} defaultValue={4.8} className="field" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-[12.5px]">
                <input name="subsidyEligible" type="checkbox" defaultChecked />
                PM E-DRIVE eligible (L3 only)
              </label>
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <SubmitButton>Add model</SubmitButton>
              <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                HSN follows the body type — 8703 80 for passenger, 8704 60 for goods.
              </p>
            </div>
          </ActionForm>
        </Disclosure>
      }
      stats={[
        { label: "Models on the list", value: String(products.filter((p) => p.active).length), hint: `${products.length} in the catalogue` },
        { label: "Ex-showroom range", value: prices.length ? `${formatINR(Math.min(...prices))} – ${formatINR(Math.max(...prices))}` : "—", hint: "GST included" },
        { label: "PM E-DRIVE eligible", value: String(eligible.length), hint: "L3 e-rickshaws and e-carts" },
        { label: "L5 incentive", value: "Closed", hint: "Target met, 26 Dec 2025" },
      ]}
    >
      <FilterChips
        total={products.length}
        current={segment}
        hrefFor={(value) => withParams("/dms/quotations/price-list", { q, segment: value })}
        options={(["L3", "L5"] as const).map((s) => ({ value: s, label: `${s} segment`, count: products.filter((p) => p.segment === s).length }))}
      />
      <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
        {shown.map((p) => {
          const image = vehicleImage(p.model);
          return (
            <li key={p.id} className="grid gap-4 px-4 py-4 lg:grid-cols-[16rem_minmax(0,1fr)]" style={{ borderColor: "var(--border)" }}>
              <div className="flex gap-3">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt="" className="h-16 w-20 shrink-0 rounded-[8px] object-cover" style={{ background: "var(--bg)" }} />
                ) : null}
                <div className="min-w-0">
                  <p className="font-semibold">{p.model}</p>
                  <p className="text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                    {p.segment} {p.bodyType} · {p.rtoClass} · HSN {p.hsn}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {!p.active && <Pill tone="negative">Off the list</Pill>}
                    {p.subsidyEligible && p.segment === "L3" && <Pill tone="positive">PM E-DRIVE</Pill>}
                  </div>
                  <dl className="mt-2 space-y-0.5 text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                    <div>Motor {p.motor}</div>
                    <div>Battery {p.battery}</div>
                    <div>Range {p.range}</div>
                    <div>{p.capacity}</div>
                    <div>Warranty {p.warranty}</div>
                  </dl>
                  <ActionForm action={setProductActive.bind(null, p.id, !p.active)} className="mt-2">
                    <SubmitButton size="sm" tone="ghost">
                      {p.active ? "Take off the price list" : "Put back on the price list"}
                    </SubmitButton>
                  </ActionForm>
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11.5px] font-semibold" style={{ color: "var(--brand-ink)" }}>
                      Edit specification…
                    </summary>
                    <ActionForm action={updateProduct.bind(null, p.id)} className="mt-1.5 space-y-2">
                      <input name="model" defaultValue={p.model} required maxLength={60} className="field" aria-label="Model" />
                      <div className="flex gap-2">
                        <select name="segment" defaultValue={p.segment} className="field" aria-label="Segment">
                          <option value="L3">L3</option>
                          <option value="L5">L5</option>
                        </select>
                        <select name="bodyType" defaultValue={p.bodyType} className="field" aria-label="Body type">
                          {BODY_TYPES.map((bt) => (
                            <option key={bt} value={bt}>{bt}</option>
                          ))}
                        </select>
                      </div>
                      <select name="rtoClass" defaultValue={p.rtoClass} className="field" aria-label="RTO class">
                        {RTO_CLASSES.map((rc) => (
                          <option key={rc} value={rc}>{rc}</option>
                        ))}
                      </select>
                      <input name="motor" defaultValue={p.motor} maxLength={60} className="field" aria-label="Motor" />
                      <input name="battery" defaultValue={p.battery} maxLength={60} className="field" aria-label="Battery" />
                      <div className="flex gap-2">
                        <input name="range" defaultValue={p.range} maxLength={40} className="field" aria-label="Range" />
                        <input name="capacity" defaultValue={p.capacity} maxLength={40} className="field" aria-label="Capacity" />
                      </div>
                      <input name="warranty" defaultValue={p.warranty} maxLength={60} className="field" aria-label="Warranty" />
                      <label className="flex items-center gap-2 text-[11.5px]">
                        <input name="subsidyEligible" type="checkbox" defaultChecked={p.subsidyEligible} />
                        PM E-DRIVE eligible (L3 only)
                      </label>
                      <SubmitButton size="sm">Save specification</SubmitButton>
                    </ActionForm>
                  </details>
                  {/* Only a model nothing has been quoted, ordered or stocked against. */}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11.5px] font-semibold" style={{ color: "var(--negative)" }}>
                      Remove model…
                    </summary>
                    <ActionForm action={deleteProduct.bind(null, p.id)} className="mt-1.5 space-y-2">
                      <p className="text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                        {p.model} leaves the catalogue for good.
                      </p>
                      <SubmitButton size="sm" tone="danger">
                        Yes, remove {p.model}
                      </SubmitButton>
                    </ActionForm>
                  </details>
                </div>
              </div>

              <div className="min-w-0 overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Variant</th>
                      <th className="text-right">Ex-showroom</th>
                      <th className="text-right">Dealer price</th>
                      <th className="text-right">Battery</th>
                      <th className="text-right">Margin</th>
                      <th className="text-right">Incentive</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {p.variants.map((v) => {
                      const taxable = v.exShowroom / (1 + GST_RATE_VEHICLE / 100);
                      const margin = Math.round(((taxable - v.dealerPrice) / taxable) * 1000) / 10;
                      const formId = `price-${p.id}-${v.variant.replace(/\s/g, "")}`;
                      return (
                        <tr key={v.variant}>
                          <td className="font-medium">{v.variant}</td>
                          <td className="text-right">
                            <input form={formId} name="exShowroom" type="number" min={10000} step={1} defaultValue={v.exShowroom} className="field w-28! py-1! text-right" aria-label={`${p.model} ${v.variant} ex-showroom`} />
                          </td>
                          <td className="text-right">
                            <input form={formId} name="dealerPrice" type="number" min={10000} step={1} defaultValue={v.dealerPrice} className="field w-28! py-1! text-right" aria-label={`${p.model} ${v.variant} dealer price`} />
                          </td>
                          <td className="text-right">
                            <input form={formId} name="batteryKwh" type="number" min={1} max={30} step={0.01} defaultValue={v.batteryKwh} className="field w-20! py-1! text-right" aria-label={`${p.model} ${v.variant} battery kWh`} />
                          </td>
                          <td className="num text-right" style={margin < 5 ? { color: "var(--warning)" } : undefined}>
                            {margin}%
                          </td>
                          <td className="num text-right">{pmEDriveIncentive(p, v) ? formatINR(pmEDriveIncentive(p, v)) : "—"}</td>
                          <td className="text-right">
                            <ActionForm action={updateVariantPrice.bind(null, p.id)} id={formId}>
                              <input type="hidden" name="variant" value={v.variant} />
                              <SubmitButton size="sm" tone="ghost">
                                Save
                              </SubmitButton>
                            </ActionForm>
                          </td>
                        </tr>
                      );
                    })}
                    {/* A variant the model does not have yet — the same action, with a name it has never seen. */}
                    {(() => {
                      const missing = ORDER_VARIANTS.filter((v) => !p.variants.some((x) => x.variant === v));
                      if (!missing.length) return null;
                      const addId = `add-variant-${p.id}`;
                      return (
                        <tr>
                          <td>
                            <select form={addId} name="variant" defaultValue={missing[0]} className="field w-32! py-1!" aria-label={`New variant for ${p.model}`}>
                              {missing.map((v) => (
                                <option key={v} value={v}>{v}</option>
                              ))}
                            </select>
                          </td>
                          <td className="text-right">
                            <input form={addId} name="exShowroom" type="number" min={10000} step={1} defaultValue={p.variants[0]?.exShowroom ?? 165000} className="field w-28! py-1! text-right" aria-label={`${p.model} new variant ex-showroom`} />
                          </td>
                          <td className="text-right">
                            <input form={addId} name="dealerPrice" type="number" min={10000} step={1} defaultValue={p.variants[0]?.dealerPrice ?? 140000} className="field w-28! py-1! text-right" aria-label={`${p.model} new variant dealer price`} />
                          </td>
                          <td className="text-right">
                            <input form={addId} name="batteryKwh" type="number" min={1} max={30} step={0.01} defaultValue={p.variants[0]?.batteryKwh ?? 4.8} className="field w-20! py-1! text-right" aria-label={`${p.model} new variant battery kWh`} />
                          </td>
                          <td />
                          <td />
                          <td className="text-right">
                            <ActionForm action={updateVariantPrice.bind(null, p.id)} id={addId}>
                              <SubmitButton size="sm">Add variant</SubmitButton>
                            </ActionForm>
                          </td>
                        </tr>
                      );
                    })()}
                  </tbody>
                </table>
                <p className="mt-1.5 px-1 text-[11px]" style={{ color: "var(--fg-faint)" }}>
                  Updated {formatDate(p.updatedAt)}. Dealer margin is on the ex-showroom price before GST.
                </p>
              </div>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="px-5 py-10 text-center text-[13px]" style={{ color: "var(--fg-muted)" }}>
            No model matches.
          </li>
        )}
      </ul>
    </ModuleScreen>
  );
}
