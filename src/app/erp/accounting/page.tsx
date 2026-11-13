import Link from "next/link";
import { accountingTabs } from "@/components/erp/tabs";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, StatusPill, formatINR, relativeTime } from "@/components/ui/primitives";
import { FilterChips, SimulatedNote, Tabs, withParams } from "@/components/ui/workflow";
import { ACCOUNTING_SYSTEMS } from "@/lib/accounting";
import { filterRows } from "@/lib/search";
import { isToday } from "@/lib/time";
import { configureAccounting, replayFailed, replayOne, syncQueued } from "@/server/actions/accounting";
import { readMany } from "@/server/store";
import type { LedgerMapping, SyncItem } from "@/server/types";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const STATUSES = ["Queued", "Synced", "Failed"] as const;

function columns(mappings: LedgerMapping[]): Column<SyncItem>[] {
  const label = (key: string) => mappings.find((m) => m.key === key)?.label ?? key;
  return [
    {
      key: "voucher",
      header: "Voucher",
      render: (q) => (
        <span className="block">
          <span className="block font-medium">
            {q.voucherType} · {q.reference}
          </span>
          <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
            {q.source} · {q.party}
          </span>
        </span>
      ),
    },
    { key: "amount", header: "Amount", align: "right", render: (q) => <span className="whitespace-nowrap">{formatINR(q.amount)}</span> },
    {
      key: "ledgers",
      header: "Posts to",
      secondary: true,
      render: (q) => <span className="block max-w-[18rem] truncate text-[12px]" title={q.ledgers.map(label).join(", ")}>{q.ledgers.map(label).join(", ")}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (q) => (
        <span className="block">
          <StatusPill value={q.status === "Synced" ? "Posted" : q.status} />
          {q.lastError && (
            <span className="mt-0.5 block max-w-[16rem] text-[11px]" style={{ color: "var(--negative)" }}>
              {q.lastError}
            </span>
          )}
        </span>
      ),
    },
    { key: "ref", header: "ERP voucher", secondary: true, render: (q) => <span className="num">{q.externalRef ?? "—"}</span> },
    { key: "when", header: "Queued", align: "right", secondary: true, render: (q) => <span className="whitespace-nowrap">{relativeTime(q.queuedAt)}</span> },
    {
      key: "act",
      header: "",
      align: "right",
      render: (q) =>
        q.status !== "Synced" ? (
          <ActionForm action={replayOne.bind(null, q.id)}>
            <SubmitButton size="sm" tone="ghost">
              {q.status === "Failed" ? "Replay" : "Post"}
            </SubmitButton>
          </ActionForm>
        ) : null,
    },
  ];
}

/**
 * ERP / accounting integration — every voucher the platform raises, posted
 * to the finance system of record, with the failures held for replay.
 */
export default async function AccountingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const q = one(raw.q);
  const statusParam = one(raw.status);
  const status = (STATUSES as readonly string[]).includes(statusParam) ? (statusParam as SyncItem["status"]) : undefined;

  const { data } = await readMany(["sync_queue", "ledger_mappings", "connectors", "dealers"] as const);
  const rows = [...data.sync_queue].sort((a, b) => +new Date(b.queuedAt) - +new Date(a.queuedAt));
  const shown = filterRows(rows, q).filter((x) => !status || x.status === status);
  const connector = data.connectors.find((c) => c.key === "accounting");
  const queued = rows.filter((x) => x.status === "Queued");
  const failures = rows.filter((x) => x.status === "Failed");
  const postedToday = rows.filter((x) => x.status === "Synced" && x.syncedAt && isToday(x.syncedAt));
  const lastPosted = rows.filter((x) => x.syncedAt).sort((a, b) => +new Date(b.syncedAt!) - +new Date(a.syncedAt!))[0];
  const unmapped = data.ledger_mappings.filter((m) => !m.ledgerName);

  return (
    <ModuleScreen
      href="/erp/accounting"
      exportCollection="sync_queue"
      searchPlaceholder="Search vouchers, parties or references"
      tabs={<Tabs current="/erp/accounting" tabs={accountingTabs({ queue: rows.length, ledgers: data.ledger_mappings.length, dealers: data.dealers.length })} />}
      stats={[
        { label: "Queued", value: String(queued.length), hint: connector?.status === "Connected" ? "Waiting for the next run" : "Connector is down", tone: queued.length ? "info" : "neutral" },
        { label: "Failed", value: String(failures.length), hint: unmapped.length ? `${unmapped.length} ledger${unmapped.length === 1 ? "" : "s"} unmapped` : "Replay once fixed", tone: failures.length ? "negative" : "neutral" },
        { label: "Posted today", value: String(postedToday.length), hint: formatINR(postedToday.reduce((s, x) => s + x.amount, 0)) },
        { label: "Last posted", value: lastPosted?.syncedAt ? relativeTime(lastPosted.syncedAt) : "—", hint: lastPosted ? lastPosted.reference : "Nothing yet" },
      ]}
      toolbar={
        <section className="surface grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto]" aria-label="Finance system">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[14px] font-semibold">{connector?.name ?? "Finance system"}</h2>
              <StatusPill value={connector?.status ?? "Disconnected"} />
              {connector && <Pill tone="neutral">{connector.environment}</Pill>}
              <Link href="/erp/integrations" className="text-[12px] underline" style={{ color: "var(--brand-ink)" }}>
                {connector?.status === "Connected" ? "Disconnect" : "Connect"} under API Integrations
              </Link>
            </div>
            {connector && (
              <ActionForm action={configureAccounting} className="flex flex-wrap items-end gap-2">
                <div>
                  <label className="field-label" htmlFor="acc-system">
                    System
                  </label>
                  <select id="acc-system" name="system" className="field" defaultValue={connector.provider}>
                    {ACCOUNTING_SYSTEMS.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[14rem] flex-1">
                  <label className="field-label" htmlFor="acc-company">
                    Company in the books
                  </label>
                  <input id="acc-company" name="company" className="field" defaultValue={connector.config.company} />
                </div>
                <div>
                  <label className="field-label" htmlFor="acc-series">
                    Voucher series
                  </label>
                  <input id="acc-series" name="voucherSeries" maxLength={20} className="field w-28!" defaultValue={connector.config.voucherSeries} />
                </div>
                <SubmitButton size="sm" tone="ghost">
                  Save
                </SubmitButton>
              </ActionForm>
            )}
            <SimulatedNote>
              Simulated: no finance system is called. A voucher posts when the connector is up and every ledger it touches is mapped — sales, output GST
              and debtors for invoices; bank and debtors for receipts.
            </SimulatedNote>
          </div>
          <div className="flex flex-wrap items-start gap-2 lg:flex-col">
            <ActionForm action={syncQueued}>
              <SubmitButton>Post {queued.length} queued</SubmitButton>
            </ActionForm>
            <ActionForm action={replayFailed}>
              <SubmitButton tone="ghost">Replay {failures.length} failed</SubmitButton>
            </ActionForm>
          </div>
        </section>
      }
    >
      <FilterChips
        total={rows.length}
        current={status}
        hrefFor={(value) => withParams("/erp/accounting", { q, status: value })}
        options={STATUSES.map((s) => ({ value: s, label: s === "Synced" ? "Posted" : s, count: rows.filter((x) => x.status === s).length }))}
      />
      <DataTable rows={shown} columns={columns(data.ledger_mappings)} empty={q || status ? "No voucher matches those filters." : "No vouchers yet — invoices, receipts and payouts queue here as they happen."} />
    </ModuleScreen>
  );
}
