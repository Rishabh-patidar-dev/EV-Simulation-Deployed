import Link from "next/link";
import { notFound } from "next/navigation";
import DetailScreen, { DetailColumns } from "@/components/shell/DetailScreen";
import ActionForm from "@/components/ui/ActionForm";
import { MetricTiles, Panel } from "@/components/ui/cards";
import PrintButton from "@/components/ui/PrintButton";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill, formatDate, formatINR } from "@/components/ui/primitives";
import { Hint } from "@/components/ui/workflow";
import { DEFAULT_CREDIT_DAYS, ageing, balance, creditPosition, invoiceState } from "@/lib/receivables";
import { recordDealerReceipt, setCreditTerms } from "@/server/actions/invoices";
import { readMany } from "@/server/store";

export const dynamic = "force-dynamic";

interface Entry {
  at: string;
  kind: "Invoice" | "Receipt" | "Credit note";
  ref: string;
  href: string;
  detail: string;
  debit: number;
  credit: number;
}

/**
 * A dealer's account statement — every invoice, receipt and credit note in
 * date order with the running balance, ageing, its credit limit and terms,
 * and on-account receipts spread across its invoices oldest first.
 */
export default async function DealerStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await readMany(["dealers", "invoices", "orders"] as const);
  const dealer = data.dealers.find((d) => d.id === id);
  if (!dealer) notFound();

  const invoices = data.invoices.filter((i) => i.dealer === dealer.name);
  const entries: Entry[] = [];
  for (const i of invoices) {
    const href = `/dms/orders/invoices/${i.id}`;
    entries.push({ at: i.issuedAt, kind: "Invoice", ref: i.invoiceNo, href, detail: `${i.type} · due ${formatDate(i.dueOn)}`, debit: i.amount, credit: 0 });
    for (const p of i.payments ?? []) entries.push({ at: p.at, kind: "Receipt", ref: p.reference, href, detail: `${p.mode} against ${i.invoiceNo}`, debit: 0, credit: p.amount });
    for (const c of i.creditNotes ?? []) entries.push({ at: c.at, kind: "Credit note", ref: c.no, href, detail: `${c.reason} — ${i.invoiceNo}`, debit: 0, credit: c.amount });
  }
  entries.sort((a, b) => +new Date(a.at) - +new Date(b.at));
  let running = 0;
  const statement = entries.map((e) => ({ ...e, balance: (running += e.debit - e.credit) }));

  const open = invoices.reduce((s, i) => s + balance(i), 0);
  const overdue = invoices.filter((i) => invoiceState(i) === "Overdue");
  const buckets = ageing(invoices);
  const credit = creditPosition(dealer);
  const held = data.orders.filter((o) => o.dealer === dealer.name && o.creditHold);

  return (
    <DetailScreen
      moduleHref="/dms/orders/invoices"
      title={`${dealer.name} — statement`}
      badges={
        <>
          <StatusPill value={dealer.status} />
          {credit.limit !== null && (credit.available ?? 0) < 0 && <Pill tone="negative">Over limit</Pill>}
        </>
      }
      subtitle={
        <>
          {dealer.code} · {dealer.city}, {dealer.state} ·{" "}
          <Link href={`/dms/dealers/${dealer.id}`} className="underline">
            Dealer 360
          </Link>
        </>
      }
      actions={<PrintButton label="Print statement" />}
    >
      <DetailColumns
        main={
          <>
            <Panel title="Account statement" description="Every invoice, receipt and credit note, oldest first, with the running balance." bodyClassName={statement.length ? "p-0!" : ""}>
              {statement.length ? (
                <div className="overflow-x-auto">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Entry</th>
                        <th className="text-right">Debit</th>
                        <th className="text-right">Credit</th>
                        <th className="text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statement.map((e, n) => (
                        <tr key={n}>
                          <td className="whitespace-nowrap">{formatDate(e.at)}</td>
                          <td>
                            <Link href={e.href} className="font-medium hover:underline">
                              {e.kind} {e.ref}
                            </Link>
                            <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                              {e.detail}
                            </span>
                          </td>
                          <td className="num text-right">{e.debit ? formatINR(e.debit) : ""}</td>
                          <td className="num text-right">{e.credit ? formatINR(e.credit) : ""}</td>
                          <td className="num text-right font-semibold">{formatINR(e.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-[13px]" style={{ color: "var(--fg-muted)" }}>
                  Nothing billed to {dealer.name} yet.
                </p>
              )}
            </Panel>

            {held.length > 0 && (
              <Panel title="Orders on credit hold" description="Waiting for the Finance Controller in the approvals queue.">
                <ul className="space-y-1.5 text-[12.5px]">
                  {held.map((o) => (
                    <li key={o.id}>
                      <Link href={`/dms/orders/${o.id}`} className="font-medium underline">
                        {o.orderNo}
                      </Link>{" "}
                      — {formatINR(o.value)} · would take the dealer to {formatINR(o.creditHold?.exposure ?? 0)}
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </>
        }
        side={
          <>
            <Panel title="Position">
              <MetricTiles
                items={[
                  { label: "Open on invoices", value: formatINR(open) },
                  { label: "Overdue", value: `${overdue.length} · ${formatINR(overdue.reduce((s, i) => s + balance(i), 0))}` },
                  { label: "Up to 30 days", value: formatINR(buckets.current) },
                  { label: "31–60 days", value: formatINR(buckets.d30) },
                  { label: "61–90 days", value: formatINR(buckets.d60) },
                  { label: "Over 90 days", value: formatINR(buckets.d90plus) },
                ]}
              />
              {Math.abs(open - dealer.outstanding) > 1 && (
                <p className="mt-3 text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                  Dealer 360 carries {formatINR(dealer.outstanding)} outstanding, which includes balances from before invoices were tracked here.
                </p>
              )}
            </Panel>

            <Panel title="Credit terms" description={credit.limit === null ? "No limit set — orders are never held." : `${formatINR(credit.used)} owed of a ${formatINR(credit.limit)} limit (${credit.utilisation}%).`}>
              <ActionForm action={setCreditTerms.bind(null, dealer.id)} className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="field-label" htmlFor="ct-limit">
                      Credit limit (₹)
                    </label>
                    <input id="ct-limit" name="creditLimit" type="number" min={0} step={1} defaultValue={dealer.creditLimit ?? undefined} className="field" placeholder="No limit" />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="ct-days">
                      Days to pay
                    </label>
                    <input id="ct-days" name="creditDays" type="number" min={0} max={180} required defaultValue={dealer.creditDays ?? DEFAULT_CREDIT_DAYS} className="field" />
                  </div>
                </div>
                <SubmitButton size="sm">Save terms</SubmitButton>
                <Hint>An order that would take the dealer over its limit is held for a Credit Limit approval. Days to pay set the due date on new invoices.</Hint>
              </ActionForm>
            </Panel>

            {open > 0 && (
              <Panel title="Receipt on account" description="A lump payment not tied to one invoice — applied oldest invoice first.">
                <ActionForm action={recordDealerReceipt.bind(null, dealer.id)} resetOnSuccess className="space-y-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <input name="amount" type="number" min={1} max={open} required className="field" placeholder={`Up to ${formatINR(open)}`} aria-label="Amount" />
                    <select name="mode" className="field" defaultValue="NEFT/RTGS" aria-label="Mode">
                      <option>NEFT/RTGS</option>
                      <option>UPI</option>
                      <option>Cheque</option>
                    </select>
                  </div>
                  <input name="reference" required minLength={4} maxLength={40} className="field" placeholder="UTR / cheque no." aria-label="Reference" />
                  <SubmitButton size="sm">Record and allocate</SubmitButton>
                </ActionForm>
              </Panel>
            )}
          </>
        }
      />
    </DetailScreen>
  );
}
