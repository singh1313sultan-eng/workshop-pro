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
