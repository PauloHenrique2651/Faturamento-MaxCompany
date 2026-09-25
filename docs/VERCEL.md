# Publicação do CRM na Vercel

O projeto usa `frontend-vercel` como Root Directory. O deploy precisa ter estas variáveis privadas:

- `SUPABASE_URL`: `https://blpzdxrjgnhootiiethu.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`: a chave `service_role` do projeto Supabase, guardada somente nas variáveis privadas da Vercel
- `CRM_SESSION_SECRET`: uma string aleatória longa, usada para assinar as sessões

Depois de executar a migração `supabase/002_cloud_api.sql`, o sincronizador local envia os usuários de `data/auth/users.json` para `crm_users`. O frontend da Vercel consulta somente o Supabase; os XMLs continuam nas pastas do Falco.
