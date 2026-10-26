-- Links de juiz: credencial limitada a UMA quadra de UM torneio (SPEC_JUIZ.md). O token nunca é guardado em claro.
create table referee_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tournament_id text not null,
  court_id text not null,
  token_hash text not null unique,
  label text not null default '',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz
);
create index referee_links_tournament_idx on referee_links(organization_id, tournament_id);
