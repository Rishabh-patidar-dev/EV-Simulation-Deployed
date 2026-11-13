import Link from "next/link";
import { notFound } from "next/navigation";
import DealerAvatar from "@/components/dms/DealerAvatar";
import DealerImageField from "@/components/dms/DealerImageField";
import DetailScreen, { DetailColumns } from "@/components/shell/DetailScreen";
import ActionForm from "@/components/ui/ActionForm";
import { MetricTiles, Panel } from "@/components/ui/cards";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill, formatDate, formatINR } from "@/components/ui/primitives";
import { Facts } from "@/components/ui/workflow";
import { derivedGstin } from "@/lib/gst";
import { balance, invoiceState } from "@/lib/receivables";
import { isOpenTicket } from "@/lib/sla";
import { dealerCompliance } from "@/lib/compliance";
import { daysUntilIso } from "@/lib/time";
import { setDealerLogo, updateDealer } from "@/server/actions/network";
import { readMany } from "@/server/store";

export const dynamic = "force-dynamic";

/**
 * One dealer across every module: its standing and targets, what it owes,
 * its compliance file, and its live orders, bookings, deliveries, workshop
 * jobs and tickets.
 */
export default async function DealerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await readMany(["dealers", "compliance", "orders", "invoices", "bookings", "deliveries", "job_cards", "tickets", "test_drives"] as const);
  const d = data.dealers.find((x) => x.id === id);
  if (!d) notFound();

  const mine = <T extends { dealer: string | null }>(rows: T[]) => rows.filter((r) => r.dealer === d.name);
  const compliance = mine(data.compliance).sort((a, b) => +new Date(a.expiresOn) - +new Date(b.expiresOn));
  const orders = mine(data.orders).filter((o) => o.status !== "Received" && o.status !== "Cancelled");
  const invoices = mine(data.invoices).filter((i) => balance(i) > 0);
  const bookings = mine(data.bookings).filter((b) => b.status !== "Delivered" && b.status !== "Cancelled");
  const deliveries = mine(data.deliveries).filter((x) => x.status !== "Handed Over" && x.status !== "Cancelled");
  const jobs = mine(data.job_cards).filter((j) => j.status !== "Closed" && j.status !== "Cancelled");
  const tickets = mine(data.tickets).filter(isOpenTicket);
  const pct = d.targetUnits ? Math.round((d.ytdUnits / d.targetUnits) * 100) : 0;

  const lists: Array<{ title: string; href: string; items: Array<{ key: string; href: string; label: string; detail: string; status: string }> }> = [
    { title: "Open orders", href: `/dms/orders?q=${encodeURIComponent(d.name)}`, items: orders.map((o) => ({ key: o.id, href: `/dms/orders/${o.id}`, label: o.orderNo, detail: `${o.units} units · ${formatINR(o.value)}`, status: o.status })) },
    { title: "Unpaid invoices", href: `/dms/orders/invoices/dealers/${d.id}`, items: invoices.map((i) => ({ key: i.id, href: `/dms/orders/invoices/${i.id}`, label: i.invoiceNo, detail: `${formatINR(balance(i))} due ${formatDate(i.dueOn)}`, status: invoiceState(i) })) },
    { title: "Live bookings", href: `/crm/bookings?q=${encodeURIComponent(d.name)}`, items: bookings.map((b) => ({ key: b.id, href: `/crm/bookings?q=${encodeURIComponent(b.bookingNo)}`, label: b.bookingNo, detail: `${b.customer} · ${b.quantity ?? 1} × ${b.model}`, status: b.status })) },
    { title: "Deliveries in progress", href: `/dms/orders/delivery?q=${encodeURIComponent(d.name)}`, items: deliveries.map((x) => ({ key: x.id, href: `/dms/orders/delivery/${x.id}`, label: x.deliveryNo, detail: `${x.customer} · ${x.quantity} × ${x.model}`, status: x.status })) },
    { title: "In the workshop", href: `/dms/service/jobcards?q=${encodeURIComponent(d.name)}`, items: jobs.map((j) => ({ key: j.id, href: `/dms/service/jobcards/${j.id}`, label: j.jobNo, detail: `${j.customer} · ${j.serviceType}`, status: j.status })) },
    { title: "Open tickets", href: `/crm/support?q=${encodeURIComponent(d.name)}`, items: tickets.map((t) => ({ key: t.id, href: `/crm/support/${t.id}`, label: t.ticketNo, detail: t.subject, status: t.status })) },
  ];

  return (
    <DetailScreen
      moduleHref="/dms/dealers"
      title={d.name}
      badges={
        <>
          <StatusPill value={d.status} />
          <Pill tone="brand">{d.tier}</Pill>
          {dealerCompliance(d.name, data.compliance).blocking.length > 0 && <Pill tone="negative">Compliance hold — no new orders</Pill>}
        </>
      }
      subtitle={`${d.code} · ${d.city}, ${d.state} · GSTIN ${d.gstin ?? derivedGstin(d.name, d.state)}`}
      lead={<DealerAvatar name={d.name} logo={d.logo} />}
    >
      <DetailColumns
        main={
          <>
            <MetricTiles
              columns={4}
              items={[
                { label: "YTD units", value: `${d.ytdUnits} of ${d.targetUnits} (${pct}%)` },
                { label: "Outstanding", value: formatINR(d.outstanding) },
                { label: "Account health", value: `${d.health} / 100` },
                { label: "Test drives booked", value: String(mine(data.test_drives).length) },
              ]}
            />
            <div className="grid gap-4 md:grid-cols-2">
              {lists.map((list) => (
                <Panel key={list.title} title={list.title} headerExtra={<span className="num text-[12.5px]">{list.items.length}</span>} action={{ href: list.href, label: "See all" }}>
                  {list.items.length ? (
                    <ul className="space-y-2">
                      {list.items.slice(0, 5).map((item) => (
                        <li key={item.key} className="flex items-baseline justify-between gap-2">
                          <Link href={item.href} className="min-w-0 hover:underline">
                            <span className="block truncate text-[12.5px] font-medium">{item.label}</span>
                            <span className="block truncate text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                              {item.detail}
                            </span>
                          </Link>
                          <StatusPill value={item.status} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                      None.
                    </p>
                  )}
                </Panel>
              ))}
            </div>
          </>
        }
        side={
          <>
            <Panel title="Image" description="Shown on the dealer card.">
              <ActionForm action={setDealerLogo.bind(null, d.id)} className="space-y-2">
                <DealerImageField field="logo" dealerName={d.name} />
                <div className="flex flex-wrap gap-2">
                  <SubmitButton size="sm">Save image</SubmitButton>
                  {d.logo && (
                    <SubmitButton size="sm" tone="danger" name="intent" value="clear">
                      Remove
                    </SubmitButton>
                  )}
                </div>
              </ActionForm>
            </Panel>

            <Panel title="Account" description="Tier, status, annual target and GST registration.">
              <ActionForm action={updateDealer.bind(null, d.id)} className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="field-label" htmlFor="dl-tier">
                      Tier
                    </label>
                    <select id="dl-tier" name="tier" className="field" defaultValue={d.tier}>
                      {["Platinum", "Gold", "Silver", "Bronze"].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="dl-status">
                      Status
                    </label>
                    <select id="dl-status" name="status" className="field" defaultValue={d.status}>
                      {["Active", "Onboarding", "Suspended"].map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="field-label" htmlFor="dl-target">
                    Annual target (units)
                  </label>
                  <input id="dl-target" name="targetUnits" type="number" min={0} max={10000} defaultValue={d.targetUnits} className="field" />
                </div>
                <div>
                  <label className="field-label" htmlFor="dl-gstin">
                    GSTIN
                  </label>
                  <input id="dl-gstin" name="gstin" maxLength={15} defaultValue={d.gstin ?? ""} className="field num uppercase" placeholder={derivedGstin(d.name, d.state)} />
                </div>
                <SubmitButton size="sm">Save account</SubmitButton>
              </ActionForm>
            </Panel>

            <Panel title="Compliance" action={{ href: `/dms/dealers/compliance?q=${encodeURIComponent(d.name)}`, label: "Renew in Compliance & Renewals" }}>
              {compliance.length ? (
                <Facts
                  rows={compliance.map((c) => {
                    const days = daysUntilIso(c.expiresOn);
                    return [
                      c.docType,
                      <span key={c.id} style={{ color: days < 0 ? "var(--negative)" : days <= 30 ? "var(--warning)" : undefined }}>
                        {days < 0 ? `expired ${formatDate(c.expiresOn)}` : `to ${formatDate(c.expiresOn)}`}
                      </span>,
                    ] as const;
                  })}
                />
              ) : (
                <p className="text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                  No compliance documents on file.
                </p>
              )}
            </Panel>
          </>
        }
      />
    </DetailScreen>
  );
}
