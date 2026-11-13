import Link from "next/link";
import { accountingTabs } from "@/components/erp/tabs";
import ModuleScreen from "@/components/shell/ModuleScreen";
import { Pill, formatINR } from "@/components/ui/primitives";
import { SimulatedNote, Tabs } from "@/components/ui/workflow";
import { readMany } from "@/server/store";

export const dynamic = "force-dynamic";

/**
 * Dealer balances two ways: what the DMS says each dealer owes (its invoices
 * less receipts), and what the finance system holds (the sales and receipt
 * vouchers that actually posted). Any difference is vouchers still queued or
 * failed — listed, so the books can be brought level.
 */
export default async function ReconciliationPage() {
  const { data } = await readMany(["invoices", "sync_queue", "dealers", "ledger_mappings"] as const);

  const rows = data.dealers
    .map((d) => {
      const invoices = data.invoices.filter((i) => i.dealer === d.name);
      const dms = invoices.reduce((s, i) => s + i.amount - i.received, 0);
      const vouchers = data.sync_queue.filter((q) => q.party === d.name && (q.source === "Dealer Invoice" || q.source === "Dealer Payment"));
      const posted = vouchers.filter((q) => q.status === "Synced");
      const erp = posted.reduce((s, q) => s + (q.voucherType === "Sales" ? q.amount : -q.amount), 0);
      // Invoices raised before the sync existed sit in the books as opening
      // balances — their amount less what was received before any receipt
      // voucher was tracked, so a later tracked receipt is not counted twice.
      const tracked = new Set(vouchers.filter((q) => q.source === "Dealer Invoice").map((q) => q.sourceId));
      const trackedReceipts = (invoiceId: string) => vouchers.filter((q) => q.source === "Dealer Payment" && q.sourceId === invoiceId).reduce((s, q) => s + q.amount, 0);
      const opening = invoices.filter((i) => !tracked.has(i.id)).reduce((s, i) => s + i.amount - (i.received - trackedReceipts(i.id)), 0);
      const pending = vouchers.filter((q) => q.status !== "Synced");
      return { dealer: d, dms, erp: erp + opening, pending, difference: dms - (erp + opening) };
    })
    .filter((r) => r.dms !== 0 || r.erp !== 0 || r.pending.length)
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

  const outOfStep = rows.filter((r) => r.difference !== 0);

  return (
    <ModuleScreen
      href="/erp/accounting"
      tabs={<Tabs current="/erp/accounting/reconciliation" tabs={accountingTabs({ queue: data.sync_queue.length, ledgers: data.ledger_mappings.length, dealers: data.dealers.length })} />}
      stats={[
        { label: "Dealers with a balance", value: String(rows.length), hint: "Receivable in either system" },
        { label: "Out of step", value: String(outOfStep.length), hint: "DMS and books disagree", tone: outOfStep.length ? "warning" : "positive" },
        { label: "Receivable in the DMS", value: formatINR(rows.reduce((s, r) => s + r.dms, 0)), hint: "Invoices less receipts" },
        { label: "Receivable in the books", value: formatINR(rows.reduce((s, r) => s + r.erp, 0)), hint: "Posted vouchers plus opening balances" },
      ]}
    >
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Dealer</th>
              <th className="text-right">DMS says</th>
              <th className="text-right">Books say</th>
              <th className="text-right">Difference</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.dealer.id}>
                <td>
                  <span className="block font-medium">{r.dealer.name}</span>
                  <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                    {r.dealer.code} · {r.dealer.state}
                  </span>
                </td>
                <td className="num text-right">{formatINR(r.dms)}</td>
                <td className="num text-right">{formatINR(r.erp)}</td>
                <td className="num text-right" style={r.difference ? { color: "var(--warning)", fontWeight: 600 } : undefined}>
                  {r.difference ? formatINR(r.difference) : "—"}
                </td>
                <td>
                  {r.pending.length ? (
                    <Link href={`/erp/accounting?q=${encodeURIComponent(r.dealer.name)}`} className="text-[12px] underline">
                      {r.pending.length} voucher{r.pending.length === 1 ? "" : "s"} not posted ({r.pending.map((p) => p.status.toLowerCase()).filter((v, i, a) => a.indexOf(v) === i).join(", ")})
                    </Link>
                  ) : (
                    <Pill tone="positive">In step</Pill>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-8 text-center" style={{ color: "var(--fg-muted)" }}>
                  No dealer balances.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="p-4">
        <SimulatedNote>The books&apos; side is built from vouchers the sync marked posted — a live integration would pull the ledger balances back from the finance system instead.</SimulatedNote>
      </div>
    </ModuleScreen>
  );
}
