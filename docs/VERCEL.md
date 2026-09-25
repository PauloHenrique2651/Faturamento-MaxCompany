# Publicação do CRM na Vercel

O projeto usa `frontend-vercel` como Root Directory. O deploy precisa ter estas variáveis privadas:

- `SUPABASE_URL`: `https://blpzdxrjgnhootiiethu.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`: a chave `service_role` do projeto Supabase, guardada somente nas variáveis privadas da Vercel
- `CRM_SESSION_SECRET`: uma string aleatória longa, usada para assinar as sessões

Execute, na ordem, as migrations `supabase/001_fiscal_documents.sql`, `supabase/002_cloud_api.sql` e `supabase/003_fiscal_document_sync_status.sql`. O sincronizador local envia usuários, metadados e os documentos fiscais validados. Os originais continuam nas pastas do Falco, e o CRM publicado recebe cópias no bucket privado `fiscal-documents`.
