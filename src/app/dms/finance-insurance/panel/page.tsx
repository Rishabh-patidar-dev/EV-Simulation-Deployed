import Link from "next/link";
import { financeTabs } from "@/components/finance/tabs";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import Disclosure from "@/components/ui/Disclosure";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, formatINR } from "@/components/ui/primitives";
import { Tabs } from "@/components/ui/workflow";
import { rupees } from "@/lib/gst";
import { createFinancier, deleteFinancier, receiveCommission, receivePayout, updateFinancier } from "@/server/actions/finance";
import { readMany } from "@/server/store";

export const dynamic = "force-dynamic";

/**
 * The lender panel luxusgreen.com publishes, with each partner's terms as
 * the dealer has them — and every payout the panel and the insurers owe the
 * dealer, to collect and reconcile.
 */
export default async function FinancierPanelPage() {
  const { data } = await readMany(["financiers", "finance_cases", "insurance_policies"] as const);
  const financiers = [...data.financiers].sort((a, b) => Number(b.active) - Number(a.active) || a.rateFrom - b.rateFrom);
  const loanPayouts = data.finance_cases.filter((c) => c.payout.status === "Accrued");
  const commissions = data.insurance_policies.filter((p) => p.status === "Issued" && p.commissionStatus === "Accrued");
  const received =
    data.finance_cases.filter((c) => c.payout.status === "Received").reduce((s, c) => s + c.payout.amount, 0) +
    data.insurance_policies.filter((p) => p.commissionStatus === "Received").reduce((s, p) => s + p.commission, 0);

  return (
    <ModuleScreen
      href="/dms/finance-insurance"
      tabs={<Tabs current="/dms/finance-insurance/panel" tabs={financeTabs({ loans: data.finance_cases.length, policies: data.insurance_policies.length, financiers: financiers.length })} />}
      stats={[
        { label: "Lenders on the panel", value: String(financiers.filter((f) => f.active).length), hint: `${financiers.length} partners` },
        { label: "Loan payouts due", value: formatINR(loanPayouts.reduce((s, c) => s + c.payout.amount, 0)), hint: `${loanPayouts.length} disbursed loans`, tone: loanPayouts.length ? "info" : "neutral" },
        { label: "Insurance commission due", value: formatINR(commissions.reduce((s, p) => s + p.commission, 0)), hint: `${commissions.length} policies` },
        { label: "Collected to date", value: formatINR(received), hint: "Payouts and commission" },
      ]}
      toolbar={
        <section className="surface overflow-hidden" aria-label="Payouts due">
          <header className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <h2 className="text-[14px] font-semibold">Payouts due to the dealer</h2>
            <p className="text-[12px]" style={{ color: "var(--fg-muted)" }}>
              Mark each one received when the remittance lands — it posts a receipt to the accounting sync.
            </p>
          </header>
          <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
            {loanPayouts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5" style={{ borderColor: "var(--border)" }}>
                <span className="min-w-0">
                  <Link href={`/dms/finance-insurance/${c.id}`} className="font-medium hover:underline">
                    {c.caseNo}
                  </Link>
                  <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                    {c.financier} · loan {rupees(c.loanAmount)} · {c.customer}
                  </span>
                </span>
                <ActionForm action={receivePayout.bind(null, c.id)} className="flex items-center gap-2">
                  <span className="num font-semibold">{rupees(c.payout.amount)}</span>
                  <input name="reference" maxLength={40} className="field w-40! py-1.5! text-[12px]" placeholder="Reference" aria-label={`Remittance reference for ${c.caseNo}`} />
                  <SubmitButton size="sm">Received</SubmitButton>
                </ActionForm>
              </li>
            ))}
            {commissions.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5" style={{ borderColor: "var(--border)" }}>
                <span className="min-w-0">
                  <span className="font-medium">{p.policyNo}</span>
                  <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                    {p.insurer} commission · {p.customer} · {p.vin}
                  </span>
                </span>
                <ActionForm action={receiveCommission.bind(null, p.id)} className="flex items-center gap-2">
                  <span className="num font-semibold">{rupees(p.commission)}</span>
                  <SubmitButton size="sm">Received</SubmitButton>
                </ActionForm>
              </li>
            ))}
            {loanPayouts.length + commissions.length === 0 && (
              <li className="px-4 py-6 text-center text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                Nothing outstanding.
              </li>
            )}
          </ul>
        </section>
      }
    >
      <div className="px-4 pt-4">
        <Disclosure label="Add financier">
          <ActionForm action={createFinancier} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="field-label">Name</label>
              <input name="name" required maxLength={80} className="field" placeholder="Bank or NBFC" />
            </div>
            <div>
              <label className="field-label">Kind</label>
              <select name="kind" className="field" defaultValue="NBFC">
                <option value="NBFC">NBFC</option>
                <option value="Bank">Bank</option>
              </select>
            </div>
            <div>
              <label className="field-label">Rate from %</label>
              <input name="rateFrom" type="number" step={0.05} defaultValue={10} className="field" />
            </div>
            <div>
              <label className="field-label">Max tenure (months)</label>
              <input name="maxTenure" type="number" step={6} min={12} max={60} defaultValue={48} className="field" />
            </div>
            <div>
              <label className="field-label">Min down payment %</label>
              <input name="minDownPct" type="number" step={1} defaultValue={15} className="field" />
            </div>
            <div>
              <label className="field-label">Processing fee %</label>
              <input name="processingFeePct" type="number" step={0.05} defaultValue={1.5} className="field" />
            </div>
            <div>
              <label className="field-label">Dealer payout %</label>
              <input name="payoutPct" type="number" step={0.05} defaultValue={2} className="field" />
            </div>
            <div className="sm:col-span-2 lg:col-span-4">
              <SubmitButton>Add to the panel</SubmitButton>
            </div>
          </ActionForm>
        </Disclosure>
      </div>

      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Financier</th>
              <th className="text-right">Rate from %</th>
              <th className="text-right">Max tenure</th>
              <th className="text-right">Min down %</th>
              <th className="text-right">Fee %</th>
              <th className="text-right">Payout %</th>
              <th>On panel</th>
              <th className="text-right">Cases</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {financiers.map((f) => {
              const formId = `fin-${f.id}`;
              const cases = data.finance_cases.filter((c) => c.financierId === f.id);
              const cell = "field w-20! py-1! text-right";
              return (
                <tr key={f.id}>
                  <td>
                    <span className="block font-medium">{f.name}</span>
                    <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
                      {f.kind}
                    </span>
                  </td>
                  <td className="text-right">
                    <input form={formId} name="rateFrom" type="number" step={0.05} defaultValue={f.rateFrom} className={cell} aria-label={`${f.name} rate`} />
                  </td>
                  <td className="text-right">
                    <input form={formId} name="maxTenure" type="number" step={6} min={12} max={60} defaultValue={f.maxTenure} className={cell} aria-label={`${f.name} tenure`} />
                  </td>
                  <td className="text-right">
                    <input form={formId} name="minDownPct" type="number" step={1} defaultValue={f.minDownPct} className={cell} aria-label={`${f.name} down payment`} />
                  </td>
                  <td className="text-right">
                    <input form={formId} name="processingFeePct" type="number" step={0.05} defaultValue={f.processingFeePct} className={cell} aria-label={`${f.name} fee`} />
                  </td>
                  <td className="text-right">
                    <input form={formId} name="payoutPct" type="number" step={0.05} defaultValue={f.payoutPct} className={cell} aria-label={`${f.name} payout`} />
                  </td>
                  <td>
                    <input form={formId} name="active" type="checkbox" defaultChecked={f.active} aria-label={`${f.name} on the panel`} />
                    {!f.active && (
                      <span className="ml-1.5">
                        <Pill tone="neutral">Off</Pill>
                      </span>
                    )}
                  </td>
                  <td className="num text-right">{cases.length}</td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <ActionForm action={updateFinancier.bind(null, f.id)} id={formId}>
                        <SubmitButton size="sm" tone="ghost">
                          Save
                        </SubmitButton>
                      </ActionForm>
                      {/* A partner that has never carried a case; the rest are taken off the panel instead. */}
                      {cases.length === 0 && (
                        <ActionForm action={deleteFinancier.bind(null, f.id)}>
                          <SubmitButton size="sm" tone="danger">
                            Remove
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ModuleScreen>
  );
}
