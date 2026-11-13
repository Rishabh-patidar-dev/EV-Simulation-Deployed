import ModuleScreen from "@/components/shell/ModuleScreen";
import ActionForm from "@/components/ui/ActionForm";
import Disclosure from "@/components/ui/Disclosure";
import SubmitButton from "@/components/ui/SubmitButton";
import DataTable, { type Column } from "@/components/ui/DataTable";
import { StatusPill, formatDate } from "@/components/ui/primitives";
import { filterRows, readQuery } from "@/lib/search";
import { createLandingPage } from "@/server/actions/campaigns";
import { deleteLandingPage, updateLandingPage, updateLandingPageStatus } from "@/server/actions/crm";
import Link from "next/link";
import FlashToast from "@/components/ui/FlashToast";
import { Pill } from "@/components/ui/primitives";
import { readCollection } from "@/server/store";
import type { LandingPage } from "@/server/types";

export const dynamic = "force-dynamic";

const conversion = (p: LandingPage) => (p.views > 0 ? (p.submissions / p.views) * 100 : 0);

const NEXT_ACTION: Record<LandingPage["status"], { label: string; status: LandingPage["status"] } | null> = {
  Draft: { label: "Publish", status: "Live" },
  Live: { label: "Archive", status: "Archived" },
  Archived: null,
};

export default async function LandingPagesPage({ searchParams }: { searchParams: Promise<{ q?: string; deleted?: string }> }) {
  const [{ rows }, q, params] = await Promise.all([readCollection("landing_pages"), readQuery(searchParams), searchParams]);
  const shown = filterRows(rows, q);

  const views = rows.reduce((s, p) => s + p.views, 0);
  const subs = rows.reduce((s, p) => s + p.submissions, 0);

  const columns: Column<LandingPage>[] = [
    {
      key: "name",
      header: "Page",
      render: (p) => (
        <Link href={`/crm/campaigns/landing-pages/${p.id}`} className="block hover:underline">
          <span className="block font-medium" style={{ color: "var(--brand-ink)" }}>
            {p.name}
          </span>
          <span className="block text-[11.5px]" style={{ color: "var(--fg-muted)" }}>
            /{p.slug}
            {p.intent ? ` · ${p.intent}` : ""}
          </span>
        </Link>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (p) => (
        <span className="flex flex-wrap items-center gap-1">
          <StatusPill value={p.status} />
          {p.campaignId && <Pill tone="brand">Campaign</Pill>}
        </span>
      ),
    },
    { key: "views", header: "Views", align: "right", render: (p) => p.views.toLocaleString("en-IN") },
    { key: "subs", header: "Submissions", align: "right", render: (p) => p.submissions.toLocaleString("en-IN") },
    {
      key: "conv",
      header: "Conversion",
      align: "right",
      render: (p) => <span style={{ color: conversion(p) >= 3 ? "var(--positive)" : undefined }}>{conversion(p).toFixed(2)}%</span>,
    },
    { key: "updated", header: "Updated", align: "right", secondary: true, render: (p) => formatDate(p.updatedAt) },
    {
      key: "actions",
      header: "Actions",
      render: (p) => {
        const next = NEXT_ACTION[p.status];
        // Nothing came through it and it is not live, so it can go.
        const removable = p.status !== "Live" && p.submissions === 0;
        return (
          <div className="flex items-center gap-1.5">
            {next && (
              <ActionForm action={updateLandingPageStatus.bind(null, p.id)}>
                <input type="hidden" name="status" value={next.status} />
                <SubmitButton size="sm" tone={next.label === "Archive" ? "ghost" : "primary"}>{next.label}</SubmitButton>
              </ActionForm>
            )}
            {removable && (
              <ActionForm action={deleteLandingPage.bind(null, p.id)}>
                <SubmitButton size="sm" tone="danger">Delete</SubmitButton>
              </ActionForm>
            )}
            <details className="relative">
              <summary className="cursor-pointer text-[12px] font-semibold" style={{ color: "var(--brand-ink)" }}>
                Edit…
              </summary>
              <div className="surface absolute right-0 z-10 mt-1 w-64 rounded-[10px] p-3 text-left">
                <ActionForm action={updateLandingPage.bind(null, p.id)} className="space-y-2">
                  <p className="field-label">Page details</p>
                  <input name="name" defaultValue={p.name} required maxLength={200} className="field" aria-label="Page name" />
                  <input name="slug" defaultValue={p.slug} required maxLength={80} className="field" aria-label="Slug" />
                  <SubmitButton size="sm">Save page</SubmitButton>
                </ActionForm>
              </div>
            </details>
          </div>
        );
      },
    },
  ];

  return (
    <ModuleScreen
      href="/crm/campaigns/landing-pages"
      exportCollection="landing_pages"
      searchPlaceholder="Search pages"
      stats={[
        { label: "Pages", value: String(rows.length), hint: `${rows.filter((p) => p.status === "Live").length} live` },
        { label: "Views", value: views.toLocaleString("en-IN"), hint: "All time" },
        { label: "Submissions", value: subs.toLocaleString("en-IN"), hint: "Forms completed" },
        { label: "Blended conversion", value: views > 0 ? `${((subs / views) * 100).toFixed(2)}%` : "—", hint: "Submissions ÷ views" },
      ]}
      toolbar={
        <Disclosure label="New landing page">
          <ActionForm action={createLandingPage} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="field-label">Page name</label>
              <input name="name" required className="field" placeholder="e.g. Winter Cargo Offer" />
            </div>
            <div>
              <label className="field-label">Slug</label>
              <input name="slug" required className="field" placeholder="winter-cargo-offer" />
            </div>
            <div>
              <label className="field-label">Captures</label>
              <select name="intent" className="field" defaultValue="Retail">
                <option value="Retail">Retail enquiries</option>
                <option value="Dealership">Dealership applications</option>
                <option value="Both">Both — the visitor chooses</option>
              </select>
            </div>
            <div>
              <label className="field-label">GTM container (optional)</label>
              <input name="gtmContainerId" maxLength={20} className="field uppercase" placeholder="GTM-XXXXXXX" />
            </div>
            <div className="flex items-end">
              <SubmitButton>Create (Draft)</SubmitButton>
            </div>
          </ActionForm>
        </Disclosure>
      }
    >
      {params.deleted && <FlashToast param="deleted" message={`Landing page deleted — ${params.deleted.slice(0, 80)}`} />}
      <DataTable rows={shown} columns={columns} empty="No pages match that search." />
    </ModuleScreen>
  );
}
