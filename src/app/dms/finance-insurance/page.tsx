import Link from "next/link";
import { financeTabs } from "@/components/finance/tabs";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import Disclosure from "@/components/ui/Disclosure";
import SubmitButton from "@/components/ui/SubmitButton";
import { Card, CardHeader, Pill, StatusPill, formatINR, relativeTime } from "@/components/ui/primitives";
import { FilterChips, Hint, Tabs, withParams } from "@/components/ui/workflow";
import { LOAN_LIMITS, SANCTION_SLA_HOURS } from "@/lib/finance";
import { filterRows } from "@/lib/search";
import { daysSinceIso, hoursSince } from "@/lib/time";
import { openLoanCase } from "@/server/actions/finance";
import { readMany } from "@/server/store";
import { LOAN_FLOW, type FinanceCase } from "@/server/types";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const STATUSES = [...LOAN_FLOW, "Rejected", "Withdrawn"] as const;
const OPEN: ReadonlyArray<FinanceCase["status"]> = ["Applied", "Under Review", "Sanctioned"];

const stalled = (c: FinanceCase) => c.status === "Under Review" && hoursSince([...c.history].reverse().find((e) => e.status === "Under Review")?.at ?? c.appliedAt) > SANCTION_SLA_HOURS;

const COLUMNS: Column<FinanceCase>[] = [
  {
    key: "case",
    header: "Loan case",
    render: (c) => (
      <Link href={`/dms/finance-insurance/${c.id}`} className="block hover:underline">
        <span className="block font-medium" style={{ color: "var(--brand-ink)" }}>
          {c.caseNo}
        </span>
        <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
          {c.customer} · {c.bookingNo}
        </span>
      </Link>
    ),
  },
  { key: "financier", header: "Financier", secondary: true, render: (c) => c.financier },
  {
    key: "loan",
    header: "Loan",
    align: "right",
    render: (c) => (
      <span className="block whitespace-nowrap">
        <span className="block">{formatINR(c.loanAmount)}</span>
        <span className="block text-[11.5px]" style={{ color: "var(--fg-faint)" }}>
          {formatINR(c.emi)} × {c.tenureMonths} @ {c.ratePct}%
        </span>
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (c) => (
      <span className="flex flex-wrap items-center gap-1">
        <StatusPill value={c.status} />
        {stalled(c) && <Pill tone="negative">Over {SANCTION_SLA_HOURS}h</Pill>}
        {c.status === "Applied" && <Pill tone="warning">{c.documents.filter((d) => !d.received).length} docs due</Pill>}
      </span>
    ),
  },
  { key: "applied", header: "Applied", align: "right", secondary: true, render: (c) => <span className="whitespace-nowrap">{relativeTime(c.appliedAt)}</span> },
];

/**
 * Finance & Insurance — loan cases against bookings with the dealer's NBFC
 * panel, from application through sanction to disbursal.
 */
export default async function FinancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const q = one(raw.q);
  const statusParam = one(raw.status);
  const status = (STATUSES as readonly string[]).includes(statusParam) ? (statusParam as FinanceCase["status"]) : undefined;

  const { data } = await readMany(["finance_cases", "financiers", "bookings", "insurance_policies"] as const);
  const rows = data.finance_cases;
  const shown = filterRows(rows, q).filter((c) => !status || c.status === status);
  const open = rows.filter((c) => OPEN.includes(c.status));
  const decided = rows.filter((c) => c.status === "Sanctioned" || c.status === "Disbursed" || c.status === "Rejected");
  const approved = decided.filter((c) => c.status !== "Rejected");
  const disbursed30 = rows.filter((c) => c.status === "Disbursed" && c.disbursedAt && daysSinceIso(c.disbursedAt) <= 30);
  const sanctionHours = rows
    .filter((c) => c.sanctionedAt)
    .map((c) => (new Date(c.sanctionedAt!).getTime() - new Date(c.appliedAt).getTime()) / 3_600_000);

  const withLoan = new Set(rows.filter((c) => OPEN.includes(c.status) || c.status === "Disbursed").map((c) => c.bookingId));
  const eligible = data.bookings.filter((b) => (b.status === "Confirmed" || b.status === "Awaiting Finance") && !withLoan.has(b.id));
  const financiers = data.financiers.filter((f) => f.active).sort((a, b) => a.rateFrom - b.rateFrom);

  return (
    <ModuleScreen
      href="/dms/finance-insurance"
      exportCollection="finance_cases"
      searchPlaceholder="Search loans, customers or lenders"
      tabs={<Tabs current="/dms/finance-insurance" tabs={financeTabs({ loans: rows.length, policies: data.insurance_policies.length, financiers: data.financiers.length })} />}
      stats={[
        { label: "Open loan cases", value: String(open.length), hint: formatINR(open.reduce((s, c) => s + c.loanAmount, 0)) },
        { label: `Under review over ${SANCTION_SLA_HOURS}h`, value: String(rows.filter(stalled).length), hint: "Chase the lender", tone: rows.some(stalled) ? "negative" : "neutral" },
        { label: "Disbursed, last 30 days", value: formatINR(disbursed30.reduce((s, c) => s + c.loanAmount, 0)), hint: `${disbursed30.length} loans` },
        {
          label: "Approval rate",
          value: decided.length ? `${Math.round((approved.length / decided.length) * 100)}%` : "—",
          hint: sanctionHours.length ? `${Math.round(sanctionHours.reduce((s, h) => s + h, 0) / sanctionHours.length)}h to sanction on average` : "No decisions yet",
        },
      ]}
      toolbar={
        <Disclosure label="Open a loan case" open={one(raw.new) === "1"}>
          {eligible.length === 0 ? (
            <p className="text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
              Every confirmed booking already has a loan case, or is paying cash. New bookings appear here.
            </p>
          ) : (
            <ActionForm action={openLoanCase} resetOnSuccess className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="lg:col-span-2">
                  <label className="field-label" htmlFor="loan-booking">
                    Booking
                  </label>
                  <select id="loan-booking" name="bookingId" required className="field" defaultValue={one(raw.booking)}>
                    <option value="" disabled>
                      Choose a booking
                    </option>
                    {eligible.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.bookingNo} · {b.customer} · {b.quantity ?? 1} × {b.model} · {formatINR(b.total)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="lg:col-span-3">
                  <label className="field-label" htmlFor="loan-financier">
                    Financier
                  </label>
                  <select id="loan-financier" name="financierId" required className="field" defaultValue="">
                    <option value="" disabled>
                      Choose from the panel
                    </option>
                    {financiers.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name} — from {f.rateFrom}% · up to {f.maxTenure} months · {Math.max(LOAN_LIMITS.minDownPct, f.minDownPct)}% down
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="loan-down">
                    Down payment (₹)
                  </label>
                  <input id="loan-down" name="downPayment" type="number" min={0} step={1} required className="field" placeholder="At least 10%" />
                </div>
                <div>
                  <label className="field-label" htmlFor="loan-tenure">
                    Tenure
                  </label>
                  <select id="loan-tenure" name="tenure" className="field" defaultValue="36">
                    {[12, 18, 24, 36, 48, 60].map((m) => (
                      <option key={m} value={m}>
                        {m} months
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="loan-rate">
                    Rate (% a year)
                  </label>
                  <input id="loan-rate" name="rate" type="number" min={LOAN_LIMITS.minRate} max={LOAN_LIMITS.maxRate} step={0.05} defaultValue={11} required className="field" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <SubmitButton>Open loan case</SubmitButton>
                <Hint>The booking moves to Awaiting Finance. The EMI is worked out on the reducing balance; the dealer&apos;s payout accrues on disbursal.</Hint>
              </div>
            </ActionForm>
          )}
        </Disclosure>
      }
      aside={
        <Card>
          <CardHeader title="Lender panel" subtitle="Cheapest first — manage it under Financier panel" />
          <ul className="space-y-2 px-5 pb-5 pt-1">
            {financiers.map((f) => {
              const theirs = rows.filter((c) => c.financierId === f.id);
              return (
                <li key={f.id} className="flex items-baseline justify-between gap-3 text-[12.5px]">
                  <span className="min-w-0 truncate">{f.name}</span>
                  <span className="shrink-0 whitespace-nowrap" style={{ color: "var(--fg-muted)" }}>
                    {f.rateFrom}% · {theirs.length} case{theirs.length === 1 ? "" : "s"}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      }
    >
      <FilterChips
        total={rows.length}
        current={status}
        hrefFor={(value) => withParams("/dms/finance-insurance", { q, status: value })}
        options={STATUSES.map((s) => ({ value: s, count: rows.filter((c) => c.status === s).length }))}
      />
      <DataTable rows={shown} columns={COLUMNS} empty={q || status ? "No loan case matches those filters." : "No loan cases yet — open one against a booking above."} />
    </ModuleScreen>
  );
}
