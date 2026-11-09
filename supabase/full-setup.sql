-- Workshop Pro: complete setup for a NEW, EMPTY Supabase database (schema + migrations 002-006).
-- Run once in the Supabase SQL editor. Do NOT run on a database that already has data.

-- Workshop Pro: Postgres schema for Supabase
-- Run in the Supabase SQL editor (or psql -f schema.sql). Re-running it DROPS and recreates all tables.
--
-- Access model: Row Level Security is on for every table with no policies, so the
-- public anon key can neither read nor write. The Node API talks to the database
-- with the service-role key (server side only) through two functions:
--   ws_dump()        -> every table as JSON (used at server start)
--   ws_sync(changes) -> upserts + deletes in one transaction (used after each change)
-- Foreign keys and the one-open-job-card rule are DEFERRABLE, so a sync can apply
-- rows in any order and is checked once at commit.

begin;

drop function if exists ws_sync(jsonb), ws_dump();
drop table if exists audit_log, job_activity, job_lines, job_concerns, job_cards,
  service_history, vehicles, customers, campaigns, package_items, packages,
  labour_ops, parts, insurers, outlets, dealers, cities, provinces, users,
  role_rights, roles, rights, settings, stock_issues, stock_adjustments, stock_batches, stock_inwards,
  repair_types, fuel_types, transmission_types cascade;
drop view if exists stock_on_hand;

-- ---------- settings (workshop profile, lookups, counters) ----------
create table settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------- roles & rights ----------
create table rights (
  code        text primary key check (code ~ '^[a-z][a-z0-9_.-]*$'),
  module      text not null,
  name        text not null,
  description text,
  system      boolean not null default false,  -- built-in: checked by the API
  active      boolean not null default true,
  pos         int not null default 0,
  extra       jsonb not null default '{}'
);
create unique index rights_name_uq on rights (lower(name));

create table roles (
  id          text primary key,
  name        text not null unique,
  description text,
  system      boolean not null default false,  -- Administrator: always every right
  active      boolean not null default true,
  extra       jsonb not null default '{}'
);

create table role_rights (
  role_id    text not null references roles(id) on delete cascade deferrable initially deferred,
  right_code text not null references rights(code) on delete cascade deferrable initially deferred,
  primary key (role_id, right_code)
);
create index role_rights_right_idx on role_rights (right_code);

-- ---------- masters ----------
create table users (
  id     text primary key,
  name   text not null,
  role   text not null references roles(name) deferrable initially deferred,
  phone  text,
  email  text,
  active boolean not null default true,
  extra  jsonb not null default '{}'
);
create unique index users_name_uq on users (lower(name));

create table provinces (
  id             text primary key,
  name           text not null,
  code           text not null,
  gst_state_code text not null check (gst_state_code ~ '^[0-9]{2}$'),
  country        text not null default 'India',
  active         boolean not null default true,
  extra          jsonb not null default '{}'
);
create unique index provinces_name_uq on provinces (lower(name));
create unique index provinces_code_uq on provinces (upper(code));
create unique index provinces_gst_uq  on provinces (gst_state_code);

create table cities (
  id          text primary key,
  name        text not null,
  province_id text not null references provinces(id) deferrable initially deferred,
  active      boolean not null default true,
  extra       jsonb not null default '{}'
);
create unique index cities_name_uq on cities (province_id, lower(name));

create table dealers (
  id             text primary key,
  name           text not null,
  code           text not null,
  gstin          text check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$'),
  province_id    text not null references provinces(id) deferrable initially deferred,
  city_id        text not null references cities(id) deferrable initially deferred,
  address        text,
  contact_person text,
  phone          text,
  email          text,
  active         boolean not null default true,
  extra          jsonb not null default '{}'
);
create unique index dealers_code_uq  on dealers (upper(code));
create unique index dealers_gstin_uq on dealers (gstin) where gstin is not null;

create table outlets (
  id        text primary key,
  name      text not null,
  code      text not null,
  dealer_id text not null references dealers(id) deferrable initially deferred,
  type      text not null check (type in ('3S (Sales, Service, Spares)','Service workshop','Body shop','Sales showroom','Spares outlet')),
  city_id   text not null references cities(id) deferrable initially deferred,
  address   text,
  phone     text,
  bays      int  not null default 0 check (bays >= 0),
  active    boolean not null default true,
  extra     jsonb not null default '{}'
);
create unique index outlets_code_uq on outlets (upper(code));

create table insurers (
  id             text primary key,
  name           text not null,
  code           text not null,
  contact_person text,
  phone          text,
  email          text,
  address        text,
  gstin          text,
  cashless       boolean not null default false,
  active         boolean not null default true,
  extra          jsonb not null default '{}'
);
create unique index insurers_name_uq on insurers (lower(name));
create unique index insurers_code_uq on insurers (upper(code));

create table parts (
  part_no        text primary key,
  description    text not null,
  unit           text not null default 'NOS' check (unit in ('NOS','SET','LTR','KG','MTR','PAIR')),
  category       text,
  brand          text,
  source         text not null default 'OEM' check (source in ('OEM','Local')),
  mrp            numeric(12,2) not null check (mrp >= 0),
  hsn            text check (hsn ~ '^[0-9]{4,8}$'),
  gst_pct        numeric(4,1) not null default 18 check (gst_pct in (0,5,12,18,28)),
  stock          numeric(12,2) not null default 0 check (stock >= 0),
  reorder_level  numeric(12,2) not null default 0 check (reorder_level >= 0),
  superseded_by  text references parts(part_no) deferrable initially deferred,
  alternate_for  text references parts(part_no) deferrable initially deferred,
  active         boolean not null default true,
  extra          jsonb not null default '{}',
  check (superseded_by is distinct from part_no and alternate_for is distinct from part_no)
);

create table labour_ops (
  code        text primary key,
  op_group    text,
  description text not null,
  minutes     int not null check (minutes >= 0),
  rate        numeric(12,2) not null check (rate >= 0),
  sac_code    text check (sac_code ~ '^[0-9]{4,8}$'),
  active      boolean not null default true,
  extra       jsonb not null default '{}'
);

create table packages (
  code      text primary key,
  name      text not null,
  pkg_group text,
  extra     jsonb not null default '{}'
);

create table package_items (
  package_code text not null references packages(code) on delete cascade deferrable initially deferred,
  kind         text not null check (kind in ('part','labour')),
  item_code    text not null,
  qty          numeric(10,2) not null default 1 check (qty > 0),
  pos          int not null default 0,
  primary key (package_code, kind, item_code)
);

create table campaigns (
  id           text primary key,
  name         text not null,
  type         text,
  valid_till   timestamptz,
  discount_pct numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  extra        jsonb not null default '{}'
);

-- ---------- customers & vehicles ----------
create table customers (
  id       text primary key,
  name     text not null,
  phone    text,
  phone2   text,
  email    text,
  email2   text,
  address  text,
  type     text,
  entity   text,
  vip      boolean not null default false,
  extra    jsonb not null default '{}'
);
create index customers_phone_idx on customers (phone);

create table vehicles (
  vin                  text primary key check (length(vin) = 17),
  reg                  text,
  customer_id          text references customers(id) deferrable initially deferred,
  model                text,
  variant              text,
  color                text,
  hex                  text,
  engine               text,
  fuel                 text,
  transmission         text,
  sale_date            timestamptz,
  warranty_till        timestamptz,
  selling_dealer       text,
  insurer_id           text references insurers(id) deferrable initially deferred,
  insurance_company    text,
  policy_no            text,
  insurance_valid_till timestamptz,
  alerts               jsonb not null default '[]',
  plans                jsonb not null default '[]',
  tickets              jsonb not null default '[]',
  extra                jsonb not null default '{}'
);
create unique index vehicles_reg_uq on vehicles (upper(replace(reg,' ',''))) where reg is not null;
create index vehicles_engine_idx on vehicles (engine);

create table service_history (
  vin         text not null references vehicles(vin) on delete cascade deferrable initially deferred,
  job_number  text not null,
  pos         int not null default 0,
  dealer      text,
  location    text,
  type        text,
  odometer    int,
  opened_at   timestamptz,
  closed_at   timestamptz,
  advisor     text,
  rating      numeric(3,1),
  amount      numeric(12,2),
  parts       jsonb not null default '[]',
  labour      jsonb not null default '[]',
  remarks     text,
  extra       jsonb not null default '{}',
  primary key (vin, job_number)
);

-- ---------- job cards ----------
create table job_cards (
  id               text primary key,
  vin              text not null references vehicles(vin) deferrable initially deferred,
  status           text not null default 'active' check (status in ('active','on_hold','closed')),
  stage            text not null default 'checked_in' check (stage in ('checked_in','in_progress','ready_invoice','ready_delivery','delivered')),
  job_type         text,
  odometer         int check (odometer >= 0),
  odometer_faulty  boolean not null default false,
  fuel_level       int check (fuel_level between 0 and 100),
  driven_by        text,
  customer_waiting boolean not null default false,
  repeat_repair    boolean not null default false,
  lift             boolean not null default false,
  service_van      text,
  advisor          text,
  advisor_id       text references users(id) deferrable initially deferred,
  technician       text,
  technician_id    text references users(id) deferrable initially deferred,
  bay              text,
  arrived_at       timestamptz not null default now(),
  promised_at      timestamptz,
  extras           jsonb not null default '{}',
  campaigns        jsonb not null default '[]',
  inspection       jsonb not null default '{}',
  damages          jsonb not null default '[]',
  feedback         jsonb,
  proforma         jsonb,
  invoice          jsonb,
  invoice_no       text generated always as (invoice->>'number') stored,
  approval         jsonb,
  extra            jsonb not null default '{}',
  updated_at       timestamptz not null default now(),
  -- Business rule: only one open (not closed) job card per vehicle; checked at commit
  constraint job_cards_one_open_per_vehicle exclude using btree (vin with =) where (status <> 'closed') deferrable initially deferred
);
create index job_cards_stage_idx on job_cards (status, stage);
create index job_cards_arrived_idx on job_cards (arrived_at desc);

create table job_concerns (
  job_id      text not null references job_cards(id) on delete cascade deferrable initially deferred,
  id          int  not null,
  kind        text not null check (kind in ('voice','advice')),
  text        text not null,
  observation text,
  extra       jsonb not null default '{}',
  primary key (job_id, id)
);

create table job_lines (
  job_id       text not null references job_cards(id) on delete cascade deferrable initially deferred,
  id           int  not null,
  kind         text not null check (kind in ('part','labour')),
  code         text not null,
  description  text not null,
  qty          numeric(10,2) not null check (qty > 0),
  rate         numeric(12,2) not null check (rate >= 0),
  discount_pct numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  status       text not null default 'pending' check (status in ('pending','approved','declined')),
  blocked      boolean not null default false,
  remarks      text,
  reason       text,
  concern_id   int,
  issued_qty   numeric(12,3) not null default 0,
  issue_cost   numeric(14,2),
  extra        jsonb not null default '{}',
  primary key (job_id, id)
);
create index job_lines_status_idx on job_lines (status);

create table job_activity (
  id     text primary key,
  job_id text not null references job_cards(id) on delete cascade deferrable initially deferred,
  at     timestamptz not null default now(),
  by     text,
  text   text not null,
  extra  jsonb not null default '{}'
);
create index job_activity_job_idx on job_activity (job_id, at desc);

create table audit_log (
  id    text primary key,
  at    timestamptz not null default now(),
  by    text,
  text  text not null,
  extra jsonb not null default '{}'
);
create index audit_log_at_idx on audit_log (at desc);

-- ---------- service setup masters & parts inventory ----------
create table repair_types (
  id          text primary key,
  name        text not null,
  code        text not null,
  description text,
  active      boolean not null default true,
  extra       jsonb not null default '{}'
);
create unique index repair_types_name_uq on repair_types (lower(name));
create unique index repair_types_code_uq on repair_types (upper(code));

create table fuel_types (
  id     text primary key,
  name   text not null,
  active boolean not null default true,
  extra  jsonb not null default '{}'
);
create unique index fuel_types_name_uq on fuel_types (lower(name));

create table transmission_types (
  id          text primary key,
  name        text not null,
  description text,
  active      boolean not null default true,
  extra       jsonb not null default '{}'
);
create unique index transmission_types_name_uq on transmission_types (lower(name));

-- goods receipt (one per supplier invoice)
create table stock_inwards (
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
create unique index stock_inwards_invoice_uq on stock_inwards (lower(supplier), invoice_no);

-- one batch per inward line; issued oldest-first (FIFO)
create table stock_batches (
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
create index stock_batches_fifo_idx on stock_batches (part_no, received_at, id);

-- stock counts and write-offs
create table stock_adjustments (
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
create index stock_adjustments_at_idx on stock_adjustments (at desc);

-- parts issued to / returned from job cards, with the batches used
create table stock_issues (
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
create index stock_issues_job_idx on stock_issues (job_id, line_id);
create index stock_issues_part_idx on stock_issues (part_no, at desc);

-- stock value per part (FIFO batches still on hand)
create or replace view stock_on_hand with (security_invoker = true) as
select p.part_no, p.description, coalesce(sum(b.remaining), 0) as on_hand,
       coalesce(sum(b.remaining * b.unit_cost), 0)::numeric(14,2) as value,
       min(b.received_at) filter (where b.remaining > 0) as oldest_batch
from parts p left join stock_batches b on b.part_no = p.part_no
group by p.part_no, p.description;


-- ---------- triggers ----------
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger job_cards_touch before update on job_cards for each row execute function touch_updated_at();

-- Dealer rules: city must be in the dealer's province; GSTIN must start with the province GST state code
create or replace function check_dealer() returns trigger language plpgsql as $$
declare st text;
begin
  if not exists (select 1 from cities where id = new.city_id and province_id = new.province_id) then
    raise exception 'City % is not in province %', new.city_id, new.province_id;
  end if;
  select gst_state_code into st from provinces where id = new.province_id;
  if new.gstin is not null and left(new.gstin, 2) <> st then
    raise exception 'GSTIN must start with state code % for this province', st;
  end if;
  return new;
end $$;
create trigger dealers_check before insert or update on dealers for each row execute function check_dealer();

-- ---------- reporting views ----------
create or replace view job_card_totals with (security_invoker = true) as
select j.id as job_id,
  coalesce(sum(l.qty * l.rate * (1 - l.discount_pct/100)) filter (where l.status <> 'declined'), 0)::numeric(12,2) as estimate_net,
  coalesce(sum(l.qty * l.rate * (1 - l.discount_pct/100)) filter (where l.status = 'approved'), 0)::numeric(12,2)  as billing_net,
  count(l.id) filter (where l.status = 'pending') as pending_lines
from job_cards j left join job_lines l on l.job_id = j.id
group by j.id;

create or replace view low_stock_parts with (security_invoker = true) as
select part_no, description, stock, reorder_level from parts where active and stock <= reorder_level;

-- ---------- API functions (service role only) ----------
create or replace function ws_tables() returns text[] language sql immutable as $$
  select array['settings','rights','roles','role_rights','users','provinces','cities','dealers','outlets','insurers',
    'repair_types','fuel_types','transmission_types','parts','labour_ops','packages','package_items','campaigns',
    'stock_inwards','stock_batches','stock_adjustments','customers','vehicles','service_history','job_cards','job_concerns','job_lines',
    'stock_issues','job_activity','audit_log']
$$;

create or replace function ws_dump() returns jsonb language plpgsql stable set search_path = public as $$
declare t text; r jsonb; out jsonb := '{}';
begin
  foreach t in array ws_tables() loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from %I x', t) into r;
    out := out || jsonb_build_object(t, r);
  end loop;
  return out;
end $$;

-- changes = {"upserts": {"table": [rows]}, "deletes": {"table": [key objects]}}
create or replace function ws_sync(changes jsonb) returns jsonb language plpgsql set search_path = public as $$
declare
  t text; rows jsonb; pk text[]; cols text; upd text; cond text; n int; total int := 0; i int;
  tbls text[] := ws_tables();
begin
  set constraints all deferred;
  foreach t in array tbls loop
    rows := changes->'upserts'->t;
    continue when rows is null or jsonb_array_length(rows) = 0;
    select array_agg(a.attname::text order by a.attnum) into pk
      from pg_index ix join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = any(ix.indkey)
      where ix.indrelid = format('public.%I', t)::regclass and ix.indisprimary;
    select string_agg(quote_ident(k), ', ') into cols from jsonb_object_keys(rows->0) k;
    select string_agg(format('%1$I = excluded.%1$I', k), ', ') into upd from jsonb_object_keys(rows->0) k where k <> all(pk);
    execute format('insert into %1$I (%2$s) select %2$s from jsonb_populate_recordset(null::%1$I, $1) on conflict (%3$s) do %4$s',
      t, cols, (select string_agg(quote_ident(c), ', ') from unnest(pk) c),
      case when upd is null then 'nothing' else 'update set ' || upd end) using rows;
    get diagnostics n = row_count; total := total + n;
  end loop;
  for i in reverse array_length(tbls, 1) .. 1 loop
    t := tbls[i];
    rows := changes->'deletes'->t;
    continue when rows is null or jsonb_array_length(rows) = 0;
    select array_agg(a.attname::text order by a.attnum) into pk
      from pg_index ix join pg_attribute a on a.attrelid = ix.indrelid and a.attnum = any(ix.indkey)
      where ix.indrelid = format('public.%I', t)::regclass and ix.indisprimary;
    select string_agg(format('t.%1$I = d.%1$I', c), ' and ') into cond from unnest(pk) c;
    execute format('delete from %1$I t using jsonb_populate_recordset(null::%1$I, $1) d where %2$s', t, cond) using rows;
    get diagnostics n = row_count; total := total + n;
  end loop;
  return jsonb_build_object('rows', total);
end $$;

revoke all on function ws_dump() from public, anon, authenticated;
revoke all on function ws_sync(jsonb) from public, anon, authenticated;
revoke all on function ws_tables() from public, anon, authenticated;
grant execute on function ws_dump(), ws_sync(jsonb), ws_tables() to service_role;

-- ---------- security: RLS on, no anon/authenticated policies ----------
do $$ declare t text;
begin
  foreach t in array ws_tables() loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

commit;

-- ===== supabase/migrations/002_roles_rights.sql =====
-- Migration 002: roles & rights masters.
-- Safe to run on an existing Workshop Pro database (keeps all data).
-- The Node server fills these tables with the default roles and rights on its next start.

begin;

create table if not exists rights (
  code        text primary key check (code ~ '^[a-z][a-z0-9_.-]*$'),
  module      text not null,
  name        text not null,
  description text,
  system      boolean not null default false,
  active      boolean not null default true,
  pos         int not null default 0,
  extra       jsonb not null default '{}'
);
create unique index if not exists rights_name_uq on rights (lower(name));

create table if not exists roles (
  id          text primary key,
  name        text not null unique,
  description text,
  system      boolean not null default false,
  active      boolean not null default true,
  extra       jsonb not null default '{}'
);

create table if not exists role_rights (
  role_id    text not null references roles(id) on delete cascade deferrable initially deferred,
  right_code text not null references rights(code) on delete cascade deferrable initially deferred,
  primary key (role_id, right_code)
);
create index if not exists role_rights_right_idx on role_rights (right_code);

-- users.role now points at the roles master (by name) instead of a fixed list
alter table users drop constraint if exists users_role_check;
alter table users drop constraint if exists users_role_fk;
alter table users add constraint users_role_fk foreign key (role) references roles(name)
  deferrable initially deferred not valid;  -- validated once the roles are loaded

create or replace function ws_tables() returns text[] language sql immutable as $$
  select array['settings','rights','roles','role_rights','users','provinces','cities','dealers','outlets','insurers','parts','labour_ops',
    'packages','package_items','campaigns','customers','vehicles','service_history','job_cards',
    'job_concerns','job_lines','job_activity','audit_log']
$$;
revoke all on function ws_tables() from public, anon, authenticated;
grant execute on function ws_tables() to service_role;

alter table rights enable row level security;
alter table roles enable row level security;
alter table role_rights enable row level security;

commit;

-- ===== supabase/migrations/003_stock_and_setup_masters.sql =====
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

-- ===== supabase/migrations/004_stock_adjustments.sql =====
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

-- ===== supabase/migrations/005_australia_billing_purchasing.sql =====
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

-- ===== supabase/migrations/006_attachments.sql =====
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
