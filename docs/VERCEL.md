# Publicação do CRM na Vercel

O domínio atual publica as rotas de `api/` da raiz do repositório e o frontend de `public/`. A raiz alternativa `frontend-vercel/` também contém os mesmos pontos de entrada. Toda nova rota deve existir nos dois diretórios; somente acrescentar um caso ao handler compartilhado não registra a rota no deploy. O deploy precisa ter estas variáveis privadas:

- `SUPABASE_URL`: `https://blpzdxrjgnhootiiethu.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY`: a chave `service_role` do projeto Supabase, guardada somente nas variáveis privadas da Vercel
- `CRM_SESSION_SECRET`: uma string aleatória longa, usada para assinar as sessões

Execute, na ordem, as migrations `supabase/001_fiscal_documents.sql`, `supabase/002_cloud_api.sql` e `supabase/003_fiscal_document_sync_status.sql`. O sincronizador local envia usuários, metadados e os documentos fiscais validados. Os originais continuam nas pastas do Falco, e o CRM publicado recebe cópias no bucket privado `fiscal-documents`.

O coletor independente pode ser executado com `node scripts/collect-fiscal.mjs`. Ele completa o histórico em lotes e depois consulta alterações a cada cinco minutos. Não inicia distribuição SEFAZ nem altera o DEPLOY. Os usuários locais são cadastrados na nuvem apenas quando ainda não existem; mudanças de senha, perfil e desativação na nuvem não são sobrescritas pelo coletor.

Validação: `npm run check` verifica estrutura, classificação, contratos das rotas e renderização das telas. `node scripts/validate-cloud.mjs` consulta o período de validação definido no script e os arquivos privados usando a configuração local, sem imprimir credenciais. A rota `/api/falco/documento` deve retornar 401 sem sessão, nunca 404 da plataforma. Com sessão, o detalhe, XML e DANFE devem responder conforme disponibilidade sincronizada.

A classificação gerencial usa o módulo comum `public/lib/fiscal-operation.js`; o catálogo visual dos CFOPs fornecidos pela empresa está em `public/lib/cfop-catalog.js`. A presença de um CNPJ em cadastro de clientes não torna uma remessa ou retorno uma venda. Rankings comerciais aceitam somente NF-e de venda autorizadas e não canceladas. Dados de cadastro e arquivos fiscais continuam fora do Git.
