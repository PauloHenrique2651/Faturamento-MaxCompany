-- Metas comerciais pertencem ao CRM, nunca ao ERP Falco.
create table if not exists public.sales_targets (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('group', 'company', 'seller')),
  scope_key text not null,
  scope_name text not null,
  period_kind text not null check (period_kind in ('month', 'quarter', 'year')),
  period_start date not null,
  amount numeric(18, 2) not null check (amount >= 0),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (scope_type, scope_key, period_kind, period_start)
);

create index if not exists sales_targets_period_idx
  on public.sales_targets (period_start, period_kind, scope_type);

alter table public.sales_targets enable row level security;
revoke all on public.sales_targets from anon, authenticated;
