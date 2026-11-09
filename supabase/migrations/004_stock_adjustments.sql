-- Migration 004: stock adjustments (physical stock counts and write-offs).
-- Safe to run on an existing Workshop Pro database (keeps all data).
-- Run it BEFORE starting a server version that has stock adjustments.

begin;

create table if not exists stock_adjustments (
  id      text primary key,
  at      timestamptz not null default now(),
  type    text not null check (type in ('count','writeoff')),
  reason  text not null,
  remarks text,
  by      text,
  value   numeric(14,2) not null default 0,   -- net value change at FIFO batch cost (negative = loss)
  lines   jsonb not null default '[]',         -- [{ partNo, systemQty, countedQty, qty, value, allocations: [{ batchId, qty, unitCost }] }]
  extra   jsonb not null default '{}'
);
create index if not exists stock_adjustments_at_idx on stock_adjustments (at desc);

create or replace function ws_tables() returns text[] language sql immutable as $$
  select array['settings','rights','roles','role_rights','users','provinces','cities','dealers','outlets','insurers',
    'repair_types','fuel_types','transmission_types','parts','labour_ops','packages','package_items','campaigns',
    'stock_inwards','stock_batches','stock_adjustments','customers','vehicles','service_history','job_cards','job_concerns','job_lines',
    'stock_issues','job_activity','audit_log']
$$;
revoke all on function ws_tables() from public, anon, authenticated;
grant execute on function ws_tables() to service_role;

alter table stock_adjustments enable row level security;

commit;
