# API do servidor do CRM

A API dedicada usa a mesma implementação de consultas do CRM e escuta apenas em `127.0.0.1:3101` no servidor. A tarefa Windows `MaxCompany CRM Server API` mantém o processo independente do computador do usuário e do navegador. O coletor permanece separado.

## Proteção

- Cada consulta exige `x-crm-api-key`; a chave aleatória fica em `data/api/config.json`, fora do Git e do frontend.
- Só GET/HEAD de rotas explicitamente permitidas são aceitos. Login, usuários, alterações, arquivos estáticos e caminhos internos não são publicados.
- Na Vercel, o usuário continua autenticado e autorizado antes de qualquer consulta à API do servidor. Credenciais do navegador não são encaminhadas ao servidor.
- Sem `CRM_SERVER_API_URL`, a Vercel mantém o fluxo existente. Configuração inválida ou falha da API não é escondida por uma troca silenciosa de fonte.

## Ativação do HTTPS permanente

1. Criar um túnel Cloudflare na conta responsável pelo domínio, com um hostname dedicado à API.
2. Encaminhar somente esse hostname para `http://127.0.0.1:3101`. Não publicar a rede, o SQL Server ou pastas do ERP.
3. Configurar o conector no próprio servidor para iniciar automaticamente. O binário oficial fica em `data/runtime/cloudflared.exe`.
4. Validar pelo endereço HTTPS: sem chave retorna 401; com chave, consultas autorizadas retornam dados. Testar também bloqueios de rotas e métodos.
5. Na Vercel, definir `CRM_SERVER_API_URL` com o hostname HTTPS e `CRM_SERVER_API_KEY` com a chave de `data/api/config.json`, exclusivamente como variáveis do backend. Reimplantar e conferir autenticação, consultas, notas e carteiras.

O HTTPS é terminado pelo túnel; o trecho local usa loopback. Não é necessário abrir portas de entrada nem reiniciar o ERP. Não usar endereço de túnel temporário para produção.

Ainda não desativar a publicação no Supabase: algumas rotas, identidades e documentos utilizam o armazenamento atual. Migrar essas dependências exige validação própria após a API externa estar funcionando.

## Diagnóstico e reversão

O log é `data/runtime/server-api.log`. A API não inicia outro coletor. Para reverter o encaminhamento da Vercel, remover `CRM_SERVER_API_URL` e reimplantar; o fluxo anterior permanece disponível. Parar somente a tarefa `MaxCompany CRM Server API` para desativar a API dedicada. Não alterar tarefas ou serviços do Falco.
