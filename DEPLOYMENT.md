# Implantação do CRM MaxCompany

## Estado atual

O projeto roda localmente com Node.js 20+ (`npm run dev` para desenvolvimento, `npm start` para execução normal). `server/server.js` serve o frontend, autentica usuários e consulta XMLs de NF-e em `FALCO_NFE_PATH` (por padrão, o compartilhamento Falco). O serviço lê entradas da SEFAZ em `SEFAZ_DATA_PATH`; `scripts/sync-sefaz.ps1` usa os certificados instalados no Windows e grava documentos e cursor NSU nesse diretório. O frontend consulta a API a cada 10 segundos. A checagem do trabalho SEFAZ ocorre a cada `SEFAZ_CHECK_SECONDS` (padrão 300); o próprio cursor respeita a próxima janela permitida pela SEFAZ. A API de saúde autenticada é `/api/health`.

O SQL Server Falco é uma integração opcional e local para os módulos legados de consulta; o dashboard fiscal e a classificação de vendas/devoluções atuais vêm de XMLs. Nenhuma credencial SQL deve ir ao navegador. O servidor local precisa manter acesso de leitura ao compartilhamento, aos certificados e, para os módulos legados, ao banco privado. O SQL Server não deve ser exposto na internet.

Arquivos operacionais e sensíveis ficam em `data/`, ignorado pelo Git: XMLs arquivados, índice de busca, estado SEFAZ, catálogo de clientes, usuários com hashes de senha e chave de sessão. Faça backup desse diretório fora do frontend. O catálogo de clientes original foi movido para `data/customer-catalog.json`; pode-se apontar outro arquivo com `CUSTOMER_CATALOG_PATH`. Se o catálogo faltar, o CRM inicia com agrupamento limitado aos dados dos XMLs.

## Como os números são calculados

`vNF` dos XMLs de saída autorizados e não cancelados compõe **Total das NF-e emitidas**. A classificação fiscal centralizada usa `finNFe`, natureza da operação e CFOP de cada item. Só documentos inteiramente classificados como venda entram em **Vendas faturadas** e nos rankings comerciais. CFOP 6902 é retorno de industrialização, não venda nem devolução de cliente. NF-e de devolução emitida a fornecedor representa devolução de compra e não reduz vendas.

As entradas da SEFAZ são mostradas como entradas, sem presumir que toda entrada é compra. Uma devolução recebida só reduz o saldo de vendas verificáveis se o XML completo referenciar uma NF-e de venda autorizada da mesma empresa e do mesmo CNPJ. Entradas apenas em resumo, notas sem referência e operações mistas ficam fora desse abatimento. O saldo é gerencial e documental: não substitui conciliação contábil, receita líquida, lucro, margem ou markup. Para essas últimas medidas, serão necessários custo, pedido, tributos efetivamente apurados e regras de negócio validadas.

## GitHub privado e Vercel: divisão necessária

O diretório `frontend-vercel/` é uma cópia estática de `public/`, gerada por `npm run sync:frontend`. Ele pode ser publicado como frontend estático após existir uma API cloud autenticada. A configuração atual usa API na mesma origem (`baseUrl` vazio). A autenticação, documentos e indicadores **não** funcionam em Vercel estática sem essa API. Não aponte `baseUrl` para o IP privado da empresa nem exponha `server/server.js` diretamente na internet.

O servidor Node atual depende de compartilhamento UNC, filesystem persistente, certificados Windows, trabalho contínuo SEFAZ, arquivo de sessão local e, opcionalmente, SQL privado. Essas funções devem ficar no serviço local 24/7 ou migrar para um coletor persistente próximo ao Falco. Funções serverless da Vercel não dão acesso natural a esses recursos e não substituem esse coletor.

Arquitetura planejada, ainda **não implementada**:

1. Coletor local de somente leitura recebe dados do Falco e mantém cursor por fonte (NSU, timestamp/ID de alteração ou hash, conforme a origem).
2. Coletor envia alterações por HTTPS de saída para uma API de ingestão autenticada, com repetição segura e registro de último sucesso. Não faz cópia integral em cada ciclo.
3. Banco analítico cloud guarda dados normalizados; object storage privado guarda XML e DANFE. Os links para documentos são temporários e autorizados por usuário/perfil.
4. API cloud aplica autenticação, sessões, RBAC, busca e indicadores. O frontend Vercel fala apenas com essa API por origem controlada.
5. Quando o coletor parar, o CRM consulta o último conjunto sincronizado e mostra horário/estado de atraso. O banco cloud não deve depender do servidor local para cada visualização.

O provedor de banco/storage, domínio, política de retenção de documentos, identidade dos usuários, frequência por fonte e método de ingestão ainda precisam ser definidos antes da implementação cloud. Nunca abrir a porta SQL 1433 para a internet.

## Configuração e segredos

`.env.example` contém somente nomes. Em ambiente local, configurar conforme necessário: `PORT`, `HOST`, `FALCO_NFE_PATH`, `FALCO_NFE_ARCHIVE`, `SEFAZ_DATA_PATH`, `CUSTOMER_CATALOG_PATH`, `MASERP_REFRESH_SECONDS`, `SEFAZ_CHECK_SECONDS` e as variáveis `MASERP_SQL_*` para os módulos SQL. O Node não carrega `.env` automaticamente; use variáveis do processo ou uma configuração de serviço protegida.

O frontend Vercel atual não precisa de senha de Falco. Uma implantação cloud futura exigirá variáveis próprias do provedor escolhido para banco, storage, chave de autenticação e ingestão, somente no backend/coletor. Não colocar segredos em `public/config.js`, `frontend-vercel/`, GitHub, URLs ou logs. `data/auth/secret.key` e `data/auth/users.json` são locais e não devem ser copiados ao build. O repositório ainda não foi inicializado nesta pasta; portanto, não há histórico Git local para auditar. Se um segredo tiver sido publicado em outro histórico, removê-lo do arquivo atual não basta: a credencial deve ser rotacionada.

`.gitignore` exclui `data/`, backups, logs, `.env` e variações, certificados, chaves e documentos XML/PDF. Antes do primeiro commit, executar inspeção dos arquivos preparados para Git, incluindo novos artefatos. O catálogo de clientes contém dados comerciais e permanece fora do repositório.

## Segurança de acesso

Hoje a API exige sessão assinada em cookie HttpOnly/SameSite Strict e restringe o perfil fiscal no servidor. O login e os documentos são servidos no mesmo host local. O acesso LAN por HTTP não criptografa o tráfego. Para acesso externo, colocar TLS, configurar cookie Secure atrás do proxy, política de CORS/origem, limitação de tentativas de login, recuperação de contas e trilha de auditoria. A sessão e revogações hoje são arquivos locais; uma API cloud distribuída precisará de armazenamento compartilhado ou serviço de identidade. Não publicar o frontend antes de isso existir.

Os endpoints de XML/DANFE exigem autenticação hoje, mas o storage é filesystem local. Na nuvem, o armazenamento de documentos fiscais deve ser privado, com checagem de perfil e URL temporária. XML, DANFE, certificado e backup não devem ficar no diretório público nem no repositório.

## Passos restantes

1. Escolher repositório GitHub **privado**, domínio, banco cloud, storage privado e provedor de identidade.
2. Definir quais dados operacionais do Falco terão sincronização incremental e respectivos cursores; validar regras de custo/lucro/margem com o fiscal e comercial.
3. Implementar coletor local persistente, API de ingestão, banco analítico, storage de documentos e health do pipeline.
4. Implementar autenticação cloud com TLS, sessão e RBAC; testar reconexão e consulta ao último dado sincronizado.
5. Configurar build do frontend Vercel apontando para a API cloud na mesma origem ou gateway autorizado. Só então publicar.

Validação local: `npm run sync:frontend` e `npm run check`. O comando `npm run dev` mantém o CRM acessível na LAN enquanto o processo e o Windows estiverem ativos e o firewall privado permitir TCP 3100. Para serviço contínuo, instalar uma execução supervisionada no servidor local, com logs e reinício automático; o watcher de desenvolvimento não é um serviço de produção.
