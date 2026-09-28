-- Regras do CRM; não altera cadastros nem lançamentos do Falco.
create table if not exists public.seller_commission_rules (
  id uuid primary key default gen_random_uuid(),
  seller_key text not null unique,
  seller_name text not null,
  rate_percent numeric(7, 4) not null check (rate_percent >= 0 and rate_percent <= 100),
  updated_by text not null,
  updated_at timestamptz not null default now()
);

alter table public.seller_commission_rules enable row level security;
revoke all on public.seller_commission_rules from anon, authenticated;
