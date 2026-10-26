-- Limite de tentativas de login por IP (além do bloqueio por conta): cada senha errada vira uma linha.
-- Linhas com mais de 1 dia são apagadas pela rotina horária da API.
create table login_failures (
  id bigserial primary key,
  ip text not null,
  at timestamptz not null default now()
);
create index login_failures_ip_at on login_failures (ip, at);
