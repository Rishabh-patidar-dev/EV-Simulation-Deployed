import { accountingTabs } from "@/components/erp/tabs";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import SubmitButton from "@/components/ui/SubmitButton";
import { Pill, relativeTime } from "@/components/ui/primitives";
import { Tabs } from "@/components/ui/workflow";
import { updateLedgerMapping } from "@/server/actions/accounting";
import { readMany } from "@/server/store";

export const dynamic = "force-dynamic";

/**
 * The chart-of-accounts mapping: where each of the platform's accounts lands
 * in the finance system. An unmapped account makes every voucher that needs
 * it fail — map it, then replay.
 */
export default async function LedgerMappingPage() {
  const { data } = await readMany(["ledger_mappings", "sync_queue", "dealers"] as const);
  const mappings = [...data.ledger_mappings].sort((a, b) => a.group.localeCompare(b.group) || a.label.localeCompare(b.label));
  const unmapped = mappings.filter((m) => !m.ledgerName);
  const blocked = data.sync_queue.filter((q) => q.status === "Failed");

  return (
    <ModuleScreen
      href="/erp/accounting"
      tabs={<Tabs current="/erp/accounting/ledgers" tabs={accountingTabs({ queue: data.sync_queue.length, ledgers: mappings.length, dealers: data.dealers.length })} />}
      stats={[
        { label: "Accounts", value: String(mappings.length), hint: "Sales, taxes, debtors, bank, income" },
        { label: "Unmapped", value: String(unmapped.length), hint: unmapped.length ? unmapped.map((m) => m.label).join(", ") : "Every account has a ledger", tone: unmapped.length ? "negative" : "positive" },
        { label: "Vouchers failing", value: String(blocked.length), hint: "Replay from the sync queue once mapped", tone: blocked.length ? "warning" : "neutral" },
        { label: "Cost centres", value: String(new Set(mappings.map((m) => m.costCentre).filter(Boolean)).size), hint: "In use across the mapping" },
      ]}
    >
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Account in the platform</th>
              <th>Group</th>
              <th>Ledger in the finance system</th>
              <th>Cost centre</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {mappings.map((m) => {
              const formId = `map-${m.id}`;
              return (
                <tr key={m.id}>
                  <td>
                    <span className="block font-medium">{m.label}</span>
                    <span className="num block text-[11px]" style={{ color: "var(--fg-faint)" }}>
                      {m.key}
                    </span>
                  </td>
                  <td>{m.group}</td>
                  <td>
                    <input form={formId} name="ledgerName" maxLength={80} defaultValue={m.ledgerName ?? ""} className="field min-w-[14rem] py-1!" placeholder="Not mapped" aria-label={`Ledger for ${m.label}`} />
                    {!m.ledgerName && (
                      <span className="mt-1 block">
                        <Pill tone="negative">Unmapped</Pill>
                      </span>
                    )}
                  </td>
                  <td>
                    <input form={formId} name="costCentre" maxLength={60} defaultValue={m.costCentre ?? ""} className="field w-40! py-1!" placeholder="—" aria-label={`Cost centre for ${m.label}`} />
                  </td>
                  <td className="whitespace-nowrap text-[12px]" style={{ color: "var(--fg-muted)" }}>
                    {relativeTime(m.updatedAt)}
                  </td>
                  <td className="text-right">
                    <ActionForm action={updateLedgerMapping.bind(null, m.id)} id={formId}>
                      <SubmitButton size="sm" tone="ghost">
                        Save
                      </SubmitButton>
                    </ActionForm>
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
