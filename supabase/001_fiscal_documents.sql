-- Execute este arquivo no SQL Editor do projeto Supabase.
-- As tabelas permanecem privadas: somente o coletor local usa a chave secreta.

create table if not exists public.crm_companies (
  id smallint primary key,
  name text not null unique,
  cnpj text,
  created_at timestamptz not null default now()
);

insert into public.crm_companies (id, name) values
  (1, 'MaxPlast'),
  (2, 'MaxSafety'),
  (3, 'MaxSupply'),
  (4, 'MaxSupply · Filial ES')
on conflict (id) do update set name = excluded.name;

create table if not exists public.fiscal_documents (
  company_id smallint not null references public.crm_companies(id),
  direction text not null check (direction in ('outgoing', 'incoming')),
  access_key text not null check (access_key ~ '^[0-9]{44}$'),
  issued_on date not null,
  document_number text not null,
  series text not null,
  amount numeric(18, 2) not null,
  counterparty_id text,
  counterparty_name text not null,
  seller text,
  operation_name text,
  purpose text,
  fiscal_operation jsonb,
  referenced_keys jsonb not null default '[]'::jsonb,
  items jsonb,
  taxes jsonb,
  freight jsonb,
  is_full_xml boolean not null default false,
  is_authorized boolean not null default true,
  is_canceled boolean not null default false,
  xml_storage_path text,
  pdf_storage_path text,
  source_payload jsonb not null,
  source_updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  primary key (company_id, direction, access_key)
);

create index if not exists fiscal_documents_period_idx
  on public.fiscal_documents (company_id, direction, issued_on desc);
create index if not exists fiscal_documents_counterparty_idx
  on public.fiscal_documents (counterparty_id);
create index if not exists fiscal_documents_number_idx
  on public.fiscal_documents (document_number, series);
create index if not exists fiscal_documents_fiscal_operation_idx
  on public.fiscal_documents ((fiscal_operation ->> 'type'));

create table if not exists public.crm_sync_runs (
  id bigint generated always as identity primary key,
  source text not null,
  status text not null check (status in ('running', 'success', 'error')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  outgoing_count integer not null default 0,
  incoming_count integer not null default 0,
  artifact_count integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  error_message text
);

alter table public.crm_companies enable row level security;
alter table public.fiscal_documents enable row level security;
alter table public.crm_sync_runs enable row level security;

-- Não há política para anon/authenticated. A chave secreta do coletor ignora RLS.
revoke all on public.crm_companies, public.fiscal_documents, public.crm_sync_runs from anon, authenticated;

insert into storage.buckets (id, name, public)
values ('fiscal-documents', 'fiscal-documents', false)
on conflict (id) do update set public = false;

