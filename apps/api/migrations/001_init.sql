-- playTorneios: esquema inicial. Cada migração roda uma vez, em transação, e é registrada em schema_migrations.
create extension if not exists citext;

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  email citext not null unique,
  password_hash text not null,
  role text not null default 'owner' check (role in ('owner')),
  failed_logins int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

create table sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text
);
create index sessions_user_idx on sessions(user_id);

-- Agregado do torneio (estado reconstruído pelo domínio). O servidor reaplica os mesmos comandos do cliente.
create table tournament_states (
  tournament_id text primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  state jsonb not null,
  cursor bigint not null default 0,
  updated_at timestamptz not null default now()
);
create index tournament_states_org_idx on tournament_states(organization_id);

create table applied_operations (
  device_id text not null,
  op_id text not null,
  tournament_id text not null,
  result jsonb not null,
  applied_at timestamptz not null default now(),
  primary key (device_id, op_id)
);

create table entity_versions (
  key text primary key,
  version int not null
);

create table entity_changes (
  key text not null,
  version int not null,
  fields text[] not null,
  device_id text not null,
  primary key (key, version)
);

create table sync_halts (
  device_id text not null,
  key text not null,
  op_id text not null,
  primary key (device_id, key)
);

create table sync_conflicts (
  id text primary key,
  tournament_id text not null,
  entity_key text not null,
  status text not null check (status in ('open','resolved_device','resolved_server')),
  record jsonb not null,
  created_at timestamptz not null default now()
);
create index sync_conflicts_open_idx on sync_conflicts(tournament_id) where status = 'open';

create table tournament_slugs (
  slug text primary key,
  tournament_id text not null unique
);

create table public_snapshots (
  slug text primary key references tournament_slugs(slug) on delete cascade on update cascade,
  tournament_id text not null,
  snapshot jsonb not null,
  etag text not null,
  updated_at timestamptz not null default now()
);
