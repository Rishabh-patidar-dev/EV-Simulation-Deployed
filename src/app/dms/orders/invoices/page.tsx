import Link from "next/link";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import SubmitButton from "@/components/ui/SubmitButton";
import { Card, CardHeader, Pill, StatusPill, formatDate, formatINR } from "@/components/ui/primitives";
import { FilterChips, withParams } from "@/components/ui/workflow";
import { ageing, balance, creditPosition, daysPastDue, invoiceState } from "@/lib/receivables";
import { filterRows } from "@/lib/search";
import { remindAllOverdue } from "@/server/actions/invoices";
import { readMany } from "@/server/store";
import type { Dealer, Invoice } from "@/server/types";

export const dynamic = "force-dynamic";

const STATES: Array<Invoice["status"]> = ["Overdue", "Unpaid", "Part Paid", "Paid"];
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

type Row = Invoice & { state: Invoice["status"]; open: number; late: number };

function columns(dealers: Map<string, Dealer>): Column<Row>[] {
  return [
    {
      key: "no",
      header: "Invoice",
      render: (i) => (
        <Link href={`/dms/orders/invoices/${i.id}`} className="block hover:underline">
          <span className="block font-medium" style={{ color: "var(--brand-ink)" }}>
            {i.invoiceNo}
          </span>
          <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
            {i.type} · issued {formatDate(i.issuedAt)}
          </span>
        </Link>
      ),
    },
    {
      key: "dealer",
      header: "Dealer",
      render: (i) => {
        const d = dealers.get(i.dealer);
        return d ? (
          <Link href={`/dms/orders/invoices/dealers/${d.id}`} className="hover:underline">
            {i.dealer}
          </Link>
        ) : (
          i.dealer
        );
      },
    },
    { key: "amount", header: "Amount", align: "right", secondary: true, render: (i) => formatINR(i.amount) },
    {
      key: "open",
      header: "Balance",
      align: "right",
      render: (i) => <span style={i.state === "Overdue" ? { color: "var(--negative)" } : undefined}>{formatINR(i.open)}</span>,
    },
    {
      key: "state",
      header: "Status",
      render: (i) => (
        <span className="flex flex-wrap items-center gap-1">
          <StatusPill value={i.state} />
          {i.state === "Overdue" && <span className="text-[11.5px]" style={{ color: "var(--negative)" }}>{i.late}d</span>}
          {(i.creditNotes?.length ?? 0) > 0 && <Pill tone="info">CN</Pill>}
        </span>
      ),
    },
    {
      key: "due",
      header: "Due",
      align: "right",
      render: (i) => (
        <span className="block whitespace-nowrap">
          <span className="block">{formatDate(i.dueOn)}</span>
          {i.reminders?.length ? (
            <span className="block text-[11px]" style={{ color: "var(--fg-faint)" }}>
              {i.reminders.length} reminder{i.reminders.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </span>
      ),
    },
  ];
}

/**
 * Billing & Invoices — the receivables desk, as EV-CRM's finance module runs
 * it: every dealer invoice with its state computed from balance and due date,
 * ageing by bucket, each dealer's credit position, and reminders. Each
 * invoice and each dealer's statement opens on its own page.
 */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const q = one(raw.q);
  const stateParam = one(raw.status);
  const state = (STATES as string[]).includes(stateParam) ? (stateParam as Invoice["status"]) : undefined;

  const { data } = await readMany(["invoices", "dealers", "orders"] as const);
  const dealers = new Map(data.dealers.map((d) => [d.name, d]));
  const rows: Row[] = data.invoices.map((i) => ({ ...i, state: invoiceState(i), open: balance(i), late: daysPastDue(i) }));

  // Overdue first, longest overdue at the top — a collections screen before a ledger.
  const ordered = [...rows].sort((a, b) => STATES.indexOf(a.state) - STATES.indexOf(b.state) || b.late - a.late || +new Date(a.dueOn) - +new Date(b.dueOn));
  const shown = filterRows(ordered, q).filter((i) => !state || i.state === state);

  const billed = rows.reduce((s, i) => s + i.amount, 0);
  const received = rows.reduce((s, i) => s + i.received, 0);
  const outstanding = rows.reduce((s, i) => s + i.open, 0);
  const overdue = rows.filter((i) => i.state === "Overdue");
  const buckets = ageing(data.invoices);
  const bucketTotal = buckets.current + buckets.d30 + buckets.d60 + buckets.d90plus;
  const holds = data.orders.filter((o) => o.creditHold);

  // Dealers by what they owe, with their room under the credit limit.
  const exposure = data.dealers
    .map((d) => ({ d, owed: rows.filter((i) => i.dealer === d.name).reduce((s, i) => s + i.open, 0), credit: creditPosition(d) }))
    .filter((x) => x.owed > 0 || x.d.creditLimit != null)
    .sort((a, b) => b.owed - a.owed)
    .slice(0, 8);

  return (
    <ModuleScreen
      href="/dms/orders/invoices"
      exportCollection="invoices"
      searchPlaceholder="Search invoices or dealers"
      stats={[
        { label: "Outstanding", value: formatINR(outstanding), hint: `${formatINR(billed)} billed, ${Math.round((received / Math.max(1, billed)) * 100)}% collected` },
        {
          label: "Overdue",
          value: formatINR(overdue.reduce((s, i) => s + i.open, 0)),
          hint: `${overdue.length} invoice${overdue.length === 1 ? "" : "s"} past due`,
          tone: overdue.length ? "negative" : "neutral",
        },
        { label: "Over 90 days", value: formatINR(buckets.d90plus), hint: "Since issue — the hardest to collect", tone: buckets.d90plus ? "warning" : "neutral" },
        { label: "Orders on credit hold", value: String(holds.length), hint: "Waiting for a credit approval", tone: holds.length ? "warning" : "neutral" },
      ]}
      actions={
        overdue.length ? (
          <ActionForm action={remindAllOverdue}>
            <SubmitButton tone="ghost">Remind all overdue</SubmitButton>
          </ActionForm>
        ) : undefined
      }
      toolbar={
        bucketTotal > 0 ? (
          <section className="surface px-5 py-4" aria-label="Receivables ageing">
            <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--fg-muted)" }}>
              Receivables ageing — open balances by days since issue
            </p>
            <div className="flex h-3 w-full overflow-hidden rounded-full" style={{ background: "var(--chart-track)" }}>
              {(
                [
                  [buckets.current, "var(--positive)"],
                  [buckets.d30, "var(--warning)"],
                  [buckets.d60, "var(--viz-3)"],
                  [buckets.d90plus, "var(--negative)"],
                ] as const
              ).map(([value, color], n) => (value > 0 ? <span key={n} style={{ width: `${(value / bucketTotal) * 100}%`, background: color }} /> : null))}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-[12.5px] sm:grid-cols-4">
              {(
                [
                  ["Up to 30 days", buckets.current, "var(--positive)"],
                  ["31–60 days", buckets.d30, "var(--warning)"],
                  ["61–90 days", buckets.d60, "var(--viz-3)"],
                  ["Over 90 days", buckets.d90plus, "var(--negative)"],
                ] as const
              ).map(([label, value, color]) => (
                <div key={label}>
                  <dt className="flex items-center gap-1.5" style={{ color: "var(--fg-muted)" }}>
                    <span className="h-2 w-2 rounded-full" style={{ background: color }} /> {label}
                  </dt>
                  <dd className="num font-semibold">{formatINR(value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : undefined
      }
      aside={
        <Card>
          <CardHeader title="Dealer receivables" subtitle="What each dealer owes, against its credit limit — open one for its statement" />
          <ul className="space-y-1 px-3 pb-4 pt-1">
            {exposure.map(({ d, owed, credit }) => (
              <li key={d.id}>
                <Link href={`/dms/orders/invoices/dealers/${d.id}`} className="block rounded-[10px] px-2.5 py-1.5 transition-colors hover:bg-[color:var(--hover)]">
                  <span className="flex items-baseline justify-between gap-2 text-[12.5px]">
                    <span className="truncate font-medium">{d.name}</span>
                    <span className="num font-semibold">{formatINR(owed)}</span>
                  </span>
                  {credit.limit !== null ? (
                    <>
                      <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--chart-track)" }}>
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${Math.min(100, credit.utilisation ?? 0)}%`, background: (credit.utilisation ?? 0) > 100 ? "var(--negative)" : (credit.utilisation ?? 0) > 80 ? "var(--warning)" : "var(--brand)" }}
                        />
                      </span>
                      <span className="mt-0.5 block text-[11px]" style={{ color: "var(--fg-muted)" }}>
                        {credit.utilisation}% of {formatINR(credit.limit)} limit
                      </span>
                    </>
                  ) : (
                    <span className="block text-[11px]" style={{ color: "var(--fg-faint)" }}>
                      No credit limit set
                    </span>
                  )}
                </Link>
              </li>
            ))}
            {exposure.length === 0 && (
              <li className="py-3 text-center text-[12.5px]" style={{ color: "var(--fg-muted)" }}>
                No dealer owes anything.
              </li>
            )}
          </ul>
        </Card>
      }
    >
      <FilterChips
        options={STATES.map((s) => ({ value: s, count: rows.filter((i) => i.state === s).length }))}
        current={state}
        hrefFor={(s) => withParams("/dms/orders/invoices", { q, status: s })}
        total={rows.length}
      />
      <DataTable rows={shown} columns={columns(dealers)} empty={q || state ? "No invoice matches those filters." : "No invoices yet — dispatching a dealer order raises one."} maxHeight={620} />
    </ModuleScreen>
  );
}
