-- Migration 005: Australian setup + billing, purchasing, messaging, bookings, time clock.
-- Safe to run on an existing Workshop Pro database (keeps all data).
-- Run it BEFORE starting the server version that has these features.

begin;

-- ---------- Australian rules replace the earlier Indian ones ----------
alter table parts drop constraint if exists parts_unit_check;
alter table parts add constraint parts_unit_check check (unit in ('EA','SET','PAIR','L','KG','M','NOS','LTR','MTR')) not valid;
alter table parts drop constraint if exists parts_source_check;
alter table parts add constraint parts_source_check check (source in ('OEM','Aftermarket','Local')) not valid;
alter table parts drop constraint if exists parts_gst_pct_check;
alter table parts add constraint parts_gst_pct_check check (gst_pct in (0,10)) not valid;
alter table provinces alter column gst_state_code drop not null;
alter table provinces drop constraint if exists provinces_gst_state_code_check;
alter table provinces alter column country set default 'Australia';
alter table dealers drop constraint if exists dealers_gstin_check;
alter table outlets drop constraint if exists outlets_type_check;
alter table outlets add constraint outlets_type_check check (type in ('Dealership (sales, service, parts)','Service centre','Body shop','Showroom','Parts outlet','3S (Sales, Service, Spares)','Service workshop','Sales showroom','Spares outlet')) not valid;

-- dealers: the city must be in the dealer's state (the GSTIN prefix rule no longer applies)
create or replace function check_dealer() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from cities where id = new.city_id and province_id = new.province_id) then
    raise exception 'City % is not in state %', new.city_id, new.province_id;
  end if;
  return new;
end $$;

-- ---------- billing ----------
create table if not exists invoices (
  id        text primary key,               -- INV-000123 / CN-000045
  kind      text not null check (kind in ('invoice','credit')),
  job_id    text,
  payer     text not null check (payer in ('customer','insurer','manufacturer')),
  issued_at timestamptz not null,
  due_at    timestamptz,
  status    text not null check (status in ('issued','credited','void')),
  subtotal  numeric(14,2) not null,
  gst       numeric(14,2) not null,
  total     numeric(14,2) not null,
  bill_to   jsonb not null default '{}',
  lines     jsonb not null default '[]',
  extra     jsonb not null default '{}'
);
create index if not exists invoices_job_idx on invoices (job_id);
create index if not exists invoices_issued_idx on invoices (issued_at desc);

create table if not exists payments (
  id         text primary key,              -- RCT-000123
  at         timestamptz not null,
  invoice_id text not null,
  kind       text not null check (kind in ('payment','refund')),
  method     text not null,
  amount     numeric(14,2) not null check (amount > 0),
  extra      jsonb not null default '{}'
);
create index if not exists payments_invoice_idx on payments (invoice_id);
create index if not exists payments_at_idx on payments (at desc);

-- ---------- purchasing ----------
create table if not exists suppliers (
  id     text primary key,
  name   text not null,
  abn    text,
  phone  text,
  email  text,
  active boolean not null default true,
  extra  jsonb not null default '{}'
);
create unique index if not exists suppliers_name_uq on suppliers (lower(name));

create table if not exists purchase_orders (
  id          text primary key,             -- PO-000123
  supplier_id text not null,
  at          timestamptz not null,
  status      text not null check (status in ('draft','sent','part-received','received','cancelled')),
  lines       jsonb not null default '[]',
  extra       jsonb not null default '{}'
);
create table if not exists supplier_payments (
  id        text primary key,               -- SPAY-000123
  at        timestamptz not null,
  inward_id text not null,
  amount    numeric(14,2) not null check (amount > 0),
  method    text not null,
  extra     jsonb not null default '{}'
);
create table if not exists purchase_returns (
  id        text primary key,               -- PRN-000123
  at        timestamptz not null,
  inward_id text not null,
  total_inc numeric(14,2) not null,
  lines     jsonb not null default '[]',
  extra     jsonb not null default '{}'
);

-- ---------- customer messages & public links ----------
create table if not exists messages (
  id        text primary key,               -- MSG-000123
  at        timestamptz not null,
  channel   text not null check (channel in ('sms','email')),
  recipient text not null,
  status    text not null,
  job_id    text,
  body      text,
  extra     jsonb not null default '{}'
);
create index if not exists messages_at_idx on messages (at desc);
create table if not exists public_links (
  token      text primary key,              -- random, unguessable
  kind       text not null check (kind in ('estimate','invoice')),
  ref        text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  extra      jsonb not null default '{}'
);

-- ---------- bookings & time clock ----------
create table if not exists appointments (
  id            text primary key,           -- APT-000123
  at            timestamptz not null,
  vin           text,
  rego          text,
  customer_name text,
  status        text not null check (status in ('booked','confirmed','arrived','no-show','cancelled')),
  job_id        text,
  extra         jsonb not null default '{}'
);
create index if not exists appointments_at_idx on appointments (at);
create table if not exists time_entries (
  id         text primary key,              -- TE-000123
  job_id     text not null,
  user_id    text not null,
  started_at timestamptz not null,
  ended_at   timestamptz,
  extra      jsonb not null default '{}'
);
create index if not exists time_entries_job_idx on time_entries (job_id);

create or replace function ws_tables() returns text[] language sql immutable as $$
  select array['settings','rights','roles','role_rights','users','provinces','cities','dealers','outlets','insurers',
    'repair_types','fuel_types','transmission_types','parts','labour_ops','packages','package_items','campaigns',
    'stock_inwards','stock_batches','stock_adjustments','customers','vehicles','service_history','job_cards','job_concerns','job_lines',
    'stock_issues','job_activity','audit_log',
    'invoices','payments','suppliers','purchase_orders','supplier_payments','purchase_returns','messages','public_links','appointments','time_entries']
$$;
revoke all on function ws_tables() from public, anon, authenticated;
grant execute on function ws_tables() to service_role;

alter table invoices enable row level security;
alter table payments enable row level security;
alter table suppliers enable row level security;
alter table purchase_orders enable row level security;
alter table supplier_payments enable row level security;
alter table purchase_returns enable row level security;
alter table messages enable row level security;
alter table public_links enable row level security;
alter table appointments enable row level security;
alter table time_entries enable row level security;

commit;
