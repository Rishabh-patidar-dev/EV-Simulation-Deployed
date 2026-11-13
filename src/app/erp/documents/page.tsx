import ModuleScreen from "@/components/shell/ModuleScreen";
import DonutChart from "@/components/charts/DonutChart";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import Disclosure from "@/components/ui/Disclosure";
import SubmitButton from "@/components/ui/SubmitButton";
import { Card, CardHeader, Pill, StatusPill, formatDate } from "@/components/ui/primitives";
import { filterRows, readQuery } from "@/lib/search";
import { registerDocument, setDocumentStatus } from "@/server/actions/network";
import { readCollection } from "@/server/store";
import type { DocumentRecord } from "@/server/types";

export const dynamic = "force-dynamic";

const COLUMNS: Column<DocumentRecord>[] = [
  { key: "name", header: "Document", render: (d) => <span className="font-medium">{d.name}</span> },
  { key: "kind", header: "Type", render: (d) => <Pill tone="brand">{d.kind}</Pill> },
  { key: "linked", header: "Linked to", render: (d) => d.linkedTo, secondary: true },
  { key: "owner", header: "Owner", render: (d) => d.owner, secondary: true },
  { key: "size", header: "Size", align: "right", render: (d) => `${(d.sizeKb / 1024).toFixed(1)} MB`, secondary: true },
  { key: "status", header: "Status", render: (d) => <StatusPill value={d.status} /> },
  { key: "uploaded", header: "Uploaded", align: "right", render: (d) => formatDate(d.uploadedAt) },
  {
    key: "act",
    header: "",
    align: "right",
    render: (d) => (
      <span className="flex justify-end gap-1.5">
        {d.status === "Pending" && (
          <ActionForm action={setDocumentStatus.bind(null, d.id, "Verified")}>
            <SubmitButton size="sm">Verify</SubmitButton>
          </ActionForm>
        )}
        {d.status !== "Archived" ? (
          <ActionForm action={setDocumentStatus.bind(null, d.id, "Archived")}>
            <SubmitButton size="sm" tone="ghost">
              Archive
            </SubmitButton>
          </ActionForm>
        ) : (
          <ActionForm action={setDocumentStatus.bind(null, d.id, "Pending")}>
            <SubmitButton size="sm" tone="ghost">
              Restore
            </SubmitButton>
          </ActionForm>
        )}
      </span>
    ),
  },
];

/**
 * The client's "all the docs and invoices will be organised here" — one
 * register over every file the other modules produce, rather than a separate
 * upload area of its own.
 */
export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [{ rows }, q] = await Promise.all([readCollection("documents"), readQuery(searchParams)]);
  const ordered = [...rows].sort((a, b) => +new Date(b.uploadedAt) - +new Date(a.uploadedAt));
  const shown = filterRows(ordered, q);

  const byKind = ["KYC", "Agreement", "Invoice", "Compliance", "Claim"]
    .map((kind) => ({ label: kind, value: rows.filter((d) => d.kind === kind).length }))
    .filter((s) => s.value > 0);

  const totalMb = rows.reduce((s, d) => s + d.sizeKb, 0) / 1024;

  return (
    <ModuleScreen
      href="/erp/documents"
      exportCollection="documents"
      searchPlaceholder="Search documents"
      stats={[
        { label: "Documents", value: String(rows.length), hint: `${shown.length} shown` },
        { label: "Awaiting verification", value: String(rows.filter((d) => d.status === "Pending").length), hint: "Not yet checked" },
        { label: "Verified", value: String(rows.filter((d) => d.status === "Verified").length), hint: "Signed off" },
        { label: "Storage used", value: `${totalMb.toFixed(1)} MB`, hint: "Across every module" },
      ]}
      toolbar={
        <Disclosure label="Register a document">
          <ActionForm action={registerDocument} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <input name="name" required minLength={3} maxLength={120} className="field lg:col-span-2" placeholder="e.g. Trade licence renewal — Joshi Motors.pdf" aria-label="Document name" />
            <select name="kind" required className="field" defaultValue="" aria-label="Kind">
              <option value="" disabled>
                Kind
              </option>
              {["KYC", "Agreement", "Invoice", "Compliance", "Claim"].map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <input name="linkedTo" required maxLength={80} className="field" placeholder="Belongs to (dealer, application, invoice)" aria-label="Linked to" />
            <input name="sizeKb" type="number" min={1} max={51200} className="field" placeholder="Size, KB" aria-label="Size in KB" />
            <div className="sm:col-span-2 lg:col-span-5">
              <SubmitButton>Register</SubmitButton>
            </div>
          </ActionForm>
        </Disclosure>
      }
      aside={
        <Card>
          <CardHeader title="By document type" subtitle="What the modules are filing" />
          <div className="px-5 pb-6 pt-1">
            <DonutChart data={byKind} centerLabel="Documents" />
          </div>
        </Card>
      }
    >
      <DataTable rows={shown} columns={COLUMNS} empty="No documents match that search." maxHeight={620} />
    </ModuleScreen>
  );
}
