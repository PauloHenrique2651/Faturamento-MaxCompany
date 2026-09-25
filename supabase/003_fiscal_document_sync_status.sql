-- Migration aditiva para auditoria e disponibilidade de XML/DANFE.
-- Pode ser executada mais de uma vez com segurança no SQL Editor do Supabase.

alter table if exists public.fiscal_documents
  add column if not exists danfe_storage_path text,
  add column if not exists document_status text not null default 'AUTHORIZED',
  add column if not exists xml_status text not null default 'PENDING',
  add column if not exists danfe_status text not null default 'PENDING',
  add column if not exists sync_status text not null default 'PENDING',
  add column if not exists sync_attempts integer not null default 0,
  add column if not exists last_sync_error text,
  add column if not exists last_sync_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fiscal_documents_document_status_check'
  ) then
    alter table public.fiscal_documents add constraint fiscal_documents_document_status_check
      check (document_status in ('AUTHORIZED', 'CANCELED', 'DENIED', 'VOIDED', 'REJECTED', 'UNKNOWN'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'fiscal_documents_xml_status_check'
  ) then
    alter table public.fiscal_documents add constraint fiscal_documents_xml_status_check
      check (xml_status in ('PENDING', 'AVAILABLE', 'MISSING', 'ERROR'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'fiscal_documents_danfe_status_check'
  ) then
    alter table public.fiscal_documents add constraint fiscal_documents_danfe_status_check
      check (danfe_status in ('PENDING', 'AVAILABLE', 'MISSING', 'ERROR'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'fiscal_documents_sync_status_check'
  ) then
    alter table public.fiscal_documents add constraint fiscal_documents_sync_status_check
      check (sync_status in ('PENDING', 'SYNCED', 'ERROR'));
  end if;
end
$$;

update public.fiscal_documents
set
  document_status = case
    when is_canceled then 'CANCELED'
    when is_authorized then 'AUTHORIZED'
    else 'UNKNOWN'
  end,
  xml_status = case when xml_storage_path is not null then 'AVAILABLE' else xml_status end,
  danfe_status = case
    when pdf_storage_path is not null or danfe_storage_path is not null then 'AVAILABLE'
    else danfe_status
  end,
  sync_status = case
    when xml_storage_path is not null then 'SYNCED'
    else sync_status
  end;

create index if not exists fiscal_documents_document_status_idx
  on public.fiscal_documents (document_status, issued_on desc);
create index if not exists fiscal_documents_artifact_status_idx
  on public.fiscal_documents (sync_status, xml_status, danfe_status);

alter table public.fiscal_documents enable row level security;
revoke all on public.fiscal_documents from anon, authenticated;
