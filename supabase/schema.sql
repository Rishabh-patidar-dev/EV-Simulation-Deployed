-- ===========================================================================
-- EV-Simulation — Supabase schema
-- ---------------------------------------------------------------------------
-- Run this once against the SAME Supabase project the CRM and landing page
-- already use. Every table is prefixed `sim_` so the simulation can share the
-- project without touching production data.
--
-- Each table is deliberately `(id text primary key, data jsonb)`: the demo's
-- shapes are still moving with the client's feedback, and a JSON column means
-- a shape change is a code change, not a migration. If a collection later
-- graduates into the real product, it gets a proper typed table there.
--
-- `npm run db:setup` runs this file from the project folder (needs
-- DATABASE_URL in .env), or paste it into the SQL Editor. Every statement is
-- safe to repeat, so running it again never touches existing tables or rows.
-- These tables are the app's only copy of its data — there is no fallback.
-- ===========================================================================

create table if not exists sim_leads           (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_lead_remarks    (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_segments        (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_enquiries       (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_deals           (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_bookings        (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_follow_ups      (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_campaigns       (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_landing_pages   (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_applications    (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_kyc_documents   (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_dealers         (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_compliance      (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_vehicle_units   (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_spare_parts     (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_inventory_logs  (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_orders          (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_invoices        (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_warranty_claims (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_documents       (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_roles           (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_approvals       (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_users           (id text primary key, data jsonb not null, created_at timestamptz not null default now());

-- Added with the remaining CRM, DMS and ERP modules.
create table if not exists sim_products        (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_quotations      (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_tax_invoices    (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_test_drives     (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_tickets         (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_financiers      (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_finance_cases   (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_insurance_policies(id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_deliveries      (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_registrations   (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_job_cards       (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_ledger_mappings (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_sync_queue      (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_connectors      (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_messages        (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_message_templates(id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_payments        (id text primary key, data jsonb not null, created_at timestamptz not null default now());
create table if not exists sim_telematics      (id text primary key, data jsonb not null, created_at timestamptz not null default now());

-- Added with dealer spare-part orders.
create table if not exists sim_part_orders     (id text primary key, data jsonb not null, created_at timestamptz not null default now());

-- Who can reach these tables through Supabase's Data API. The app uses the
-- service-role (secret) key from server code only, so that role gets exactly
-- the four row operations: newer Supabase projects no longer grant API roles
-- anything on new tables by default, and without this every read fails with
-- "permission denied". The browser-facing anon and authenticated roles get
-- nothing, and RLS (enabled, no policies) backs that up — a leaked public key
-- cannot read the demo data. Each step is skipped where the role does not
-- exist (plain Postgres outside Supabase).
do $$
declare t text;
begin
  foreach t in array array[
    'sim_leads','sim_lead_remarks','sim_segments','sim_enquiries','sim_deals','sim_bookings','sim_follow_ups',
    'sim_campaigns','sim_landing_pages','sim_applications','sim_kyc_documents','sim_dealers',
    'sim_compliance','sim_vehicle_units','sim_spare_parts','sim_inventory_logs','sim_orders',
    'sim_invoices','sim_warranty_claims','sim_documents','sim_roles','sim_approvals','sim_users',
    'sim_products','sim_quotations','sim_tax_invoices','sim_test_drives','sim_tickets','sim_financiers',
    'sim_finance_cases','sim_insurance_policies','sim_deliveries','sim_registrations','sim_job_cards','sim_ledger_mappings',
    'sim_sync_queue','sim_connectors','sim_messages','sim_message_templates','sim_payments','sim_telematics','sim_part_orders'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    if to_regrole('service_role') is not null then
      execute format('grant select, insert, update, delete on table %I to service_role', t);
    end if;
    if to_regrole('anon') is not null then
      execute format('revoke all on table %I from anon', t);
    end if;
    if to_regrole('authenticated') is not null then
      execute format('revoke all on table %I from authenticated', t);
    end if;
  end loop;
end $$;
