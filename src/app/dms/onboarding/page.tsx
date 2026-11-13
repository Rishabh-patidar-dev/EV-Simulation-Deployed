import type { ReactNode } from "react";
import Link from "next/link";
import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import DataTable, { type Column } from "@/components/ui/DataTable";
import Disclosure from "@/components/ui/Disclosure";
import SubmitButton from "@/components/ui/SubmitButton";
import { Card, CardHeader, Pill, StatusPill, formatDate } from "@/components/ui/primitives";
import { FilterChips, Hint, withParams } from "@/components/ui/workflow";
import { INDIAN_STATES } from "@/lib/gst";
import { APPLICATION_SOURCES, INVESTMENT_BANDS, ONBOARDING_STAGES, STAGE_SLA_DAYS, stageAge, stageProgress } from "@/lib/onboarding";
import { filterRows } from "@/lib/search";
import { createApplication } from "@/server/actions/onboarding";
import { assignableStaff } from "@/server/staff";
import { readMany } from "@/server/store";
import type { Application } from "@/server/types";

export const dynamic = "force-dynamic";

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

type Row = Application & { days: number; limit: number; stalled: boolean; verified: number; total: number; kycOpen: number };

const COLUMNS: Column<Row>[] = [
  {
    key: "firm",
    header: "Application",
    render: (a) => (
      <Link href={`/dms/onboarding/${a.id}`} className="block hover:underline">
        <span className="block font-medium" style={{ color: "var(--brand-ink)" }}>
          {a.firm}
        </span>
        <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
          {a.applicationNo} · {a.city}, {a.state}
        </span>
      </Link>
    ),
  },
  { key: "intent", header: "Applying as", secondary: true, render: (a) => <Pill tone="brand">{a.intent}</Pill> },
  {
    key: "stage",
    header: "Stage",
    render: (a) => (
      <span className="block">
        <span className="block">{a.stage}</span>
        {a.status === "In Progress" && (
          <span className="block text-[11.5px]" style={{ color: a.stalled ? "var(--negative)" : "var(--fg-muted)" }}>
            {a.days}d of {a.limit}
            {a.total ? ` · ${a.verified}/${a.total} docs` : ""}
            {a.stage === "Verification" && a.kycOpen ? ` · ${a.kycOpen} KYC open` : ""}
          </span>
        )}
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (a) => (
      <span className="flex flex-wrap items-center gap-1">
        <StatusPill value={a.status} />
        {a.stalled && <Pill tone="negative">Stalled</Pill>}
      </span>
    ),
  },
  { key: "owner", header: "Owner", render: (a) => a.owner, secondary: true },
  { key: "submitted", header: "Opened", align: "right", secondary: true, render: (a) => formatDate(a.submittedAt) },
];

/**
 * Onboarding Pipeline — EV-CRM's onboarding monitor: every application with
 * where it sits, how long it has been there against the stage's limit, and
 * how far through that stage's document checklist it is. Each application is
 * worked on its own page.
 */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const q = one(raw.q);
  const stageParam = one(raw.stage);
  const stage = (ONBOARDING_STAGES as string[]).includes(stageParam) ? (stageParam as Application["stage"]) : undefined;
  const stalledOnly = one(raw.stalled) === "1";

  const [{ data }, staff] = await Promise.all([readMany(["applications", "kyc_documents"] as const), assignableStaff("onboarding.manage")]);
  const rows: Row[] = data.applications.map((a) => ({
    ...a,
    ...stageAge(a),
    ...stageProgress(a),
    kycOpen: data.kyc_documents.filter((d) => d.applicationNo === a.applicationNo && d.status !== "Verified").length,
  }));
  const open = rows.filter((a) => a.status === "In Progress" || a.status === "On Hold");
  const stalled = rows.filter((a) => a.stalled);
  const shown = filterRows(rows, q)
    .filter((a) => (!stage || a.stage === stage) && (!stalledOnly || a.stalled))
    .sort((a, b) => Number(b.stalled) - Number(a.stalled) || +new Date(b.submittedAt) - +new Date(a.submittedAt));

  const onboarded = rows.filter((a) => a.status === "Approved");
  const avgDays = onboarded.length
    ? Math.round(
        onboarded.reduce((s, a) => {
          const end = (a.history ?? []).find((e) => e.status === "Onboarded")?.at;
          return s + (end ? (new Date(end).getTime() - new Date(a.submittedAt).getTime()) / 86_400_000 : 0);
        }, 0) / onboarded.length
      )
    : null;

  return (
    <ModuleScreen
      href="/dms/onboarding"
      exportCollection="applications"
      searchPlaceholder="Search firms, cities or owners"
      stats={[
        { label: "Open applications", value: String(open.length), hint: `${rows.filter((a) => a.status === "On Hold").length} on hold` },
        { label: "Stalled", value: String(stalled.length), hint: "Past the stage's time limit", tone: stalled.length ? "negative" : "neutral" },
        { label: "Onboarded", value: String(onboarded.length), hint: avgDays !== null ? `${avgDays} days from enquiry on average` : "Agreement signed, on Dealer 360" },
        { label: "Rejected", value: String(rows.filter((a) => a.status === "Rejected").length), hint: "With the reason on file" },
      ]}
      toolbar={
        <Disclosure label="New application" open={one(raw.new) === "1"}>
          <ActionForm action={createApplication} resetOnSuccess className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Firm" htmlFor="ap-firm">
                <input id="ap-firm" name="firm" required maxLength={80} className="field" />
              </Field>
              <Field label="City" htmlFor="ap-city">
                <input id="ap-city" name="city" required maxLength={60} className="field" />
              </Field>
              <Field label="State (if no GSTIN)" htmlFor="ap-state">
                <select id="ap-state" name="state" className="field" defaultValue="Maharashtra">
                  {INDIAN_STATES.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Applying as" htmlFor="ap-intent">
                <select id="ap-intent" name="intent" className="field" defaultValue="Dealer">
                  {(["Dealer", "Distributor", "Service Partner"] satisfies Application["intent"][]).map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Contact person" htmlFor="ap-contact">
                <input id="ap-contact" name="contactName" required maxLength={80} className="field" />
              </Field>
              <Field label="Phone" htmlFor="ap-phone">
                <input id="ap-phone" name="phone" type="tel" maxLength={20} className="field" />
              </Field>
              <Field label="Email" htmlFor="ap-email">
                <input id="ap-email" name="email" type="email" maxLength={120} className="field" />
              </Field>
              <Field label="GSTIN (optional)" htmlFor="ap-gstin">
                <input id="ap-gstin" name="gstin" maxLength={15} className="field font-mono uppercase" />
              </Field>
              <Field label="PAN (optional)" htmlFor="ap-pan">
                <input id="ap-pan" name="pan" maxLength={10} className="field font-mono uppercase" />
              </Field>
              <Field label="Investment capacity" htmlFor="ap-invest">
                <select id="ap-invest" name="investment" className="field" defaultValue="">
                  <option value="">Not given</option>
                  {INVESTMENT_BANDS.map((b) => (
                    <option key={b}>{b}</option>
                  ))}
                </select>
              </Field>
              <Field label="Came from" htmlFor="ap-source">
                <select id="ap-source" name="source" className="field" defaultValue="Landing Page">
                  {APPLICATION_SOURCES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Owner" htmlFor="ap-owner">
                <select id="ap-owner" name="owner" className="field" defaultValue={staff[0] ?? ""}>
                  {staff.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <SubmitButton>Open application</SubmitButton>
              <Hint>It opens at Enquiry with the screening checklist (NDA, EoI, CIBIL) and the six Digital KYC documents to collect.</Hint>
            </div>
          </ActionForm>
        </Disclosure>
      }
      aside={
        <Card>
          <CardHeader title="Pipeline by stage" subtitle="Open applications, with the stage's time limit — select one to filter" />
          <ul className="space-y-1 px-3 pb-4 pt-1">
            {ONBOARDING_STAGES.map((s, i) => {
              const here = open.filter((a) => a.stage === s);
              const late = here.filter((a) => a.stalled).length;
              const peak = Math.max(1, ...ONBOARDING_STAGES.map((x) => open.filter((a) => a.stage === x).length));
              return (
                <li key={s}>
                  <Link
                    href={withParams("/dms/onboarding", { q, stage: stage === s ? undefined : s })}
                    className="block rounded-[10px] px-2.5 py-1.5 transition-colors hover:bg-[color:var(--hover)]"
                    style={stage === s ? { background: "var(--brand-soft)" } : undefined}
                  >
                    <span className="mb-1 flex items-baseline justify-between">
                      <span className="text-[12.5px]">
                        {s} <span style={{ color: "var(--fg-faint)" }}>· {STAGE_SLA_DAYS[s]}d</span>
                      </span>
                      <span className="num text-[12.5px] font-semibold">
                        {here.length}
                        {late ? <span style={{ color: "var(--negative)" }}> ({late} stalled)</span> : null}
                      </span>
                    </span>
                    <span className="block h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--bg)" }}>
                      <span className="block h-full rounded-full" style={{ width: `${(here.length / peak) * 100}%`, background: `var(--viz-${(i % 6) + 1})` }} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      }
    >
      <FilterChips
        options={[{ value: "stalled", label: "Stalled", count: stalled.length }]}
        current={stalledOnly ? "stalled" : undefined}
        hrefFor={(v) => withParams("/dms/onboarding", { q, stage, stalled: v ? "1" : undefined })}
        total={rows.length}
      />
      <DataTable rows={shown} columns={COLUMNS} empty={q || stage || stalledOnly ? "No application matches those filters." : "No applications yet — open the first one above."} />
    </ModuleScreen>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div>
      <label className="field-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}
