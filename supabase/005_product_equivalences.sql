-- Equivalências revisadas para relacionar códigos de fornecedor com códigos internos.
-- A tabela pertence exclusivamente ao CRM; nada é gravado no Falco.
create table if not exists public.product_equivalences (
  id uuid primary key default gen_random_uuid(),
  company_id integer not null check (company_id between 1 and 4),
  sale_code text not null,
  sale_name text not null,
  purchase_supplier_id text not null,
  purchase_code text not null,
  purchase_name text not null,
  ncm text not null,
  unit text not null,
  approved_by text not null,
  approved_at timestamptz not null default now(),
  unique (company_id, sale_code, purchase_supplier_id, purchase_code)
);

create index if not exists product_equivalences_sale_idx
  on public.product_equivalences (company_id, sale_code);

alter table public.product_equivalences enable row level security;
revoke all on public.product_equivalences from anon, authenticated;
