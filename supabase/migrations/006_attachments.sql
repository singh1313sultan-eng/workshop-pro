-- Migration 006: photos & documents on job cards.
-- The files themselves live in the private Storage bucket "attachments" (the server creates it on first upload);
-- this table holds what each file is and which job card it belongs to.
begin;

create table if not exists attachments (
  id     text primary key,
  job_id text not null,
  vin    text,
  name   text not null,
  type   text not null,
  size   bigint not null,
  path   text not null,
  at     timestamptz not null,
  extra  jsonb not null default '{}'
);
create index if not exists attachments_job_idx on attachments (job_id);

create or replace function ws_tables() returns text[] language sql immutable as $$
  select array['settings','rights','roles','role_rights','users','provinces','cities','dealers','outlets','insurers',
    'repair_types','fuel_types','transmission_types','parts','labour_ops','packages','package_items','campaigns',
    'stock_inwards','stock_batches','stock_adjustments','customers','vehicles','service_history','job_cards','job_concerns','job_lines',
    'stock_issues','job_activity','audit_log',
    'invoices','payments','suppliers','purchase_orders','supplier_payments','purchase_returns','messages','public_links','appointments','time_entries',
    'attachments']
$$;
revoke all on function ws_tables() from public, anon, authenticated;
grant execute on function ws_tables() to service_role;

alter table attachments enable row level security;

commit;
