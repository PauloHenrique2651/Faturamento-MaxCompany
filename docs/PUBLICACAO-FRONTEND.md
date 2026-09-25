# Publicação do frontend

O repositório público/privado destinado ao Vercel deve publicar somente a pasta `public`. As pastas `server`, arquivos `.env`, credenciais, scripts SQL e mapeamentos internos não devem compor o artefato público.

1. A Falco publica as views e uma API HTTPS somente de consulta.
2. Em `public/config.js`, definir `baseUrl` com a URL pública da API, sem token embutido.
3. Configurar autenticação por sessão/SSO ou gateway. Segredos permanecem na API, nunca no JavaScript.
4. No Vercel, usar `public` como diretório de saída estático.
5. Autorizar CORS somente para o domínio definitivo e os previews que forem realmente necessários.

No localhost, `baseUrl` permanece vazio e as chamadas usam a ponte Node local. Para publicação, recomenda-se manter um repositório privado e criar um pacote de frontend separado antes do primeiro commit.
