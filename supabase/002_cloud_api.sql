-- Usuários usados pela API serverless da Vercel.
-- O coletor local continua usando data/auth; esta tabela contém somente os
-- hashes necessários para o acesso remoto ao painel.
create table if not exists public.crm_users (
  id text primary key,
  name text not null,
  name_normalized text not null unique,
  role text not null check (role in ('admin', 'fiscal')),
  salt text not null,
  hash text not null,
  version integer not null default 1,
  disabled boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists crm_users_login_idx on public.crm_users (name_normalized, disabled);
alter table public.crm_users enable row level security;
revoke all on public.crm_users from anon, authenticated;
