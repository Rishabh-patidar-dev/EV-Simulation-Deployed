import ModuleScreen from "@/components/shell/ModuleScreen";
import DonutChart from "@/components/charts/DonutChart";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import SubmitButton from "@/components/ui/SubmitButton";
import { Card, CardHeader, StatusPill, formatDate } from "@/components/ui/primitives";
import { filterRows, readQuery } from "@/lib/search";
import { markKycUploaded, verifyKyc } from "@/server/actions/network";
import { readCollection } from "@/server/store";
import type { KycDocument } from "@/server/types";

export const dynamic = "force-dynamic";

const COLUMNS: Column<KycDocument>[] = [
  { key: "app", header: "Application", render: (d) => <span className="font-medium">{d.applicationNo}</span> },
  { key: "firm", header: "Firm", render: (d) => d.firm },
  { key: "doc", header: "Document", render: (d) => d.docType },
  { key: "status", header: "Status", render: (d) => <StatusPill value={d.status} /> },
  {
    key: "verified",
    header: "Verified by",
    secondary: true,
    render: (d) => d.verifiedBy ?? <span style={{ color: "var(--fg-faint)" }}>—</span>,
  },
  {
    key: "uploaded",
    header: "Uploaded",
    align: "right",
    secondary: true,
    render: (d) => (d.uploadedAt ? formatDate(d.uploadedAt) : <span style={{ color: "var(--fg-faint)" }}>—</span>),
  },
  {
    key: "act",
    header: "",
    align: "right",
    render: (d) =>
      d.status === "Pending" ? (
        <ActionForm action={verifyKyc.bind(null, d.id)} className="flex justify-end gap-1.5">
          <SubmitButton size="sm" name="decision" value="Verified">
            Verify
          </SubmitButton>
          <SubmitButton size="sm" tone="danger" name="decision" value="Rejected">
            Reject
          </SubmitButton>
        </ActionForm>
      ) : d.status === "Not Uploaded" || d.status === "Rejected" ? (
        <ActionForm action={markKycUploaded.bind(null, d.id)}>
          <SubmitButton size="sm" tone="ghost">
            {d.status === "Rejected" ? "Re-uploaded" : "Received"}
          </SubmitButton>
        </ActionForm>
      ) : null,
  },
];

export default async function KycPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const [{ rows }, q] = await Promise.all([readCollection("kyc_documents"), readQuery(searchParams)]);

  // Anything needing a human first — verified documents are the ones nobody
  // has to look at again.
  const ordered = [...rows].sort((a, b) => rank(a) - rank(b));
  const shown = filterRows(ordered, q);

  const verified = rows.filter((d) => d.status === "Verified").length;
  const mix = ["Verified", "Pending", "Not Uploaded", "Rejected"].map((status) => ({
    label: status,
    value: rows.filter((d) => d.status === status).length,
  }));

  return (
    <ModuleScreen
      href="/dms/onboarding/kyc"
      exportCollection="kyc_documents"
      searchPlaceholder="Search KYC documents"
      stats={[
        { label: "Documents tracked", value: String(rows.length), hint: `${shown.length} shown` },
        { label: "Verified", value: String(verified), hint: `${Math.round((verified / Math.max(1, rows.length)) * 100)}% of the pack` },
        { label: "Awaiting verification", value: String(rows.filter((d) => d.status === "Pending").length), hint: "Uploaded, not yet checked" },
        { label: "Not uploaded", value: String(rows.filter((d) => d.status === "Not Uploaded").length), hint: "Chase the applicant" },
      ]}
      aside={
        <Card>
          <CardHeader title="KYC completeness" subtitle="Every document across every application" />
          <div className="px-5 pb-6 pt-1">
            <DonutChart data={mix} centerLabel="Documents" />
          </div>
        </Card>
      }
    >
      <DataTable rows={shown} columns={COLUMNS} empty="No documents match that search." maxHeight={620} />
    </ModuleScreen>
  );
}

function rank(d: KycDocument) {
  return { Rejected: 0, "Not Uploaded": 1, Pending: 2, Verified: 3 }[d.status];
}
