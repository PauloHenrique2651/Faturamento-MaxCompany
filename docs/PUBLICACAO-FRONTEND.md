# Publicação do frontend

O domínio atual usa as funções de `api/` na raiz e os arquivos estáticos de `public/`. `frontend-vercel/` permanece como raiz alternativa, sincronizada a partir de `public/` por `npm run sync:frontend`. As rotas explícitas são mantidas nas duas raízes. `data/`, arquivos `.env`, credenciais e XMLs não são arquivos públicos.

1. O servidor MaxCompany lê as pastas do Falco e sincroniza os documentos para o Supabase usando apenas a chave secreta local.
2. Os SQLs em `supabase/001_fiscal_documents.sql`, `002_cloud_api.sql` e `003_fiscal_document_sync_status.sql` criam e evoluem de forma aditiva o banco privado e o bucket `fiscal-documents`.
3. A API HTTPS pública consulta o Supabase e aplica autenticação. A chave secreta permanece somente no servidor/coletor ou na API.
4. Em `frontend-vercel/config.js`, definir `baseUrl` com a URL HTTPS dessa API, sem token embutido.
5. Autorizar CORS somente para o domínio definitivo e os previews realmente necessários.

No localhost, `baseUrl` permanece vazio e as chamadas usam a ponte Node local. O frontend Vercel só deve ser disponibilizado aos usuários depois que a API cloud estiver ligada ao Supabase.
