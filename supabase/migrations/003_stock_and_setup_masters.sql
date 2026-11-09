-- Migration 003: parts inventory (stock inward, FIFO batches, issues/returns)
-- and the repair type / fuel type / transmission type masters.
-- Safe to run on an existing Workshop Pro database (keeps all data). The Node
-- server fills the new tables (opening stock, default types) on its next start.

begin;

create table if not exists repair_types (
  id          text primary key,
  name        text not null,
  code        text not null,
  description text,
  active      boolean not null default true,
  extra       jsonb not null default '{}'
);
create unique index if not exists repair_types_name_uq on repair_types (lower(name));
create unique index if not exists repair_types_code_uq on repair_types (upper(code));

create table if not exists fuel_types (
  id     text primary key,
  name   text not null,
  active boolean not null default true,
  extra  jsonb not null default '{}'
);
create unique index if not exists fuel_types_name_uq on fuel_types (lower(name));

create table if not exists transmission_types (
  id          text primary key,
  name        text not null,
  description text,
  active      boolean not null default true,
  extra       jsonb not null default '{}'
);
create unique index if not exists transmission_types_name_uq on transmission_types (lower(name));

-- goods receipt (one per supplier invoice)
create table if not exists stock_inwards (
  id           text primary key,
  at           timestamptz not null default now(),
  supplier     text not null,
  invoice_no   text not null,
  invoice_date timestamptz,
  by           text,
  remarks      text,
  total        numeric(14,2) not null default 0,
  extra        jsonb not null default '{}'
);
create unique index if not exists stock_inwards_invoice_uq on stock_inwards (lower(supplier), invoice_no);

-- one batch per inward line; issued oldest-first (FIFO)
create table if not exists stock_batches (
  id          text primary key,
  part_no     text not null references parts(part_no) deferrable initially deferred,
  inward_id   text references stock_inwards(id) deferrable initially deferred,
  received_at timestamptz not null,
  qty         numeric(12,3) not null check (qty >= 0),
  remaining   numeric(12,3) not null check (remaining >= 0),
  unit_cost   numeric(12,2) not null check (unit_cost >= 0),
  supplier    text,
  extra       jsonb not null default '{}',
  check (remaining <= qty)
);
create index if not exists stock_batches_fifo_idx on stock_batches (part_no, received_at, id);

-- parts issued to / returned from job cards, with the batches used
create table if not exists stock_issues (
  id          text primary key,
  at          timestamptz not null default now(),
  kind        text not null check (kind in ('issue','return')),
  job_id      text not null references job_cards(id) on delete cascade deferrable initially deferred,
  line_id     int not null,
  part_no     text not null references parts(part_no) deferrable initially deferred,
  qty         numeric(12,3) not null check (qty > 0),
  cost        numeric(14,2) not null default 0,
  by          text,
  reason      text,
  allocations jsonb not null default '[]',
  extra       jsonb not null default '{}'
);
create index if not exists stock_issues_job_idx on stock_issues (job_id, line_id);
create index if not exists stock_issues_part_idx on stock_issues (part_no, at desc);

alter table job_lines add column if not exists issued_qty numeric(12,3) not null default 0;
alter table job_lines add column if not exists issue_cost numeric(14,2);

-- stock value per part (FIFO batches still on hand)
create or replace view stock_on_hand with (security_invoker = true) as
select p.part_no, p.description, coalesce(sum(b.remaining), 0) as on_hand,
       coalesce(sum(b.remaining * b.unit_cost), 0)::numeric(14,2) as value,
       min(b.received_at) filter (where b.remaining > 0) as oldest_batch
from parts p left join stock_batches b on b.part_no = p.part_no
group by p.part_no, p.description;

create or replace function ws_tables() returns text[] language sql immutable as $$
  select array['settings','rights','roles','role_rights','users','provinces','cities','dealers','outlets','insurers',
    'repair_types','fuel_types','transmission_types','parts','labour_ops','packages','package_items','campaigns',
    'stock_inwards','stock_batches','customers','vehicles','service_history','job_cards','job_concerns','job_lines',
    'stock_issues','job_activity','audit_log']
$$;
revoke all on function ws_tables() from public, anon, authenticated;
grant execute on function ws_tables() to service_role;

alter table repair_types enable row level security;
alter table fuel_types enable row level security;
alter table transmission_types enable row level security;
alter table stock_inwards enable row level security;
alter table stock_batches enable row level security;
alter table stock_issues enable row level security;

commit;
