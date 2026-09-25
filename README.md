# CRM Executivo MaxCompany

CRM local de consulta aos arquivos do Falco. O servidor lê XMLs de NF-e em `\\maxcompany\DEPLOY\NFE` e não altera o ERP. Não é necessária conexão SQL para o dashboard.

## Executar

Com Node.js 20 ou superior, rode `npm install` e `npm run dev` nesta pasta, ou execute `./start-local.ps1`. Abra [http://localhost:3100](http://localhost:3100). O servidor escuta em `0.0.0.0:3100`; outros PCs da mesma rede podem usar o IP desta máquina e a porta 3100 enquanto ela estiver ligada e a rede/firewall permitir. O CRM exige login. Os quatro usuários de acesso completo e os três do fiscal informados para a implantação inicial já estão cadastrados. Não há senhas no código: hashes e chave de sessão ficam em `data/auth/`, que deve permanecer fora do diretório público e ser incluído no backup local.

Administradores gerenciam usuários na aba **Usuários**. O perfil fiscal vê apenas **NF-e emitidas**, **NF-e recebidas**, **Impostos** e a busca de documentos; essa restrição também é aplicada à API. A sessão sobrevive ao fechamento do navegador por até sete dias, salvo logout ou troca de senha/perfil. Ao usar o IP da máquina via HTTP, o tráfego da rede não é criptografado; mantenha o acesso dentro da LAN confiável ou coloque HTTPS na frente do serviço antes de ampliar o acesso.

`FALCO_NFE_PATH` permite trocar o caminho da pasta NFE para testes. O navegador verifica atualizações a cada 10 segundos enquanto está aberto e reconecta ao voltar à aba, recuperar a rede ou reabrir a página. Para iniciar o servidor automaticamente ao entrar no Windows, execute uma vez `pwsh -File scripts/install-autostart.ps1`. Fechar o navegador não encerra o servidor.

Ao abrir sem datas na URL, o CRM mostra o mês atual. Selecionar empresa, período ou datas atualiza imediatamente a aba aberta; trocar de empresa remove filtros de cliente, vendedor e produto da empresa anterior. A busca no topo encontra NF-e pelo número, número/série ou chave, além de nomes de clientes, fornecedores, vendedores e produtos, independentemente do período selecionado. O índice de busca em `data/nfe/search-index.json` é derivado dos XMLs, e novos arquivos são incorporados nas consultas seguintes.

## Gráficos disponíveis

- Evolução diária do valor e quantidade de NF-e autorizadas, cancelamentos identificados e valor por empresa.
- Rankings de NF-e de venda por vendedor, grupo de clientes e produto, com filtro de empresa e período. Os grupos cruzam os CNPJs e razões sociais do catálogo de clientes exportado do Falco com os nomes encontrados nos XMLs. Filiais com o mesmo CNPJ raiz e cadastros com razão social equivalente são consolidados. Dois CNPJs duplicados com razões sociais conflitantes não entram no vínculo automático. O catálogo usado fica em `data/customer-catalog.json`; a exportação fornecida não contém uma coluna separada de nome fantasia. O vendedor é extraído do texto “Vendedor” nas informações adicionais da NF-e; vendas sem indicação entram na contagem de não atribuídas.
- Navegação conectada: empresa → grupo de clientes → CNPJs/cadastros → vendedores → NF-e; cada clique mantém o período e os filtros na URL. A nota abre seus itens, tributos, frete, XML e DANFE quando existe na pasta da empresa. O Falco nomeia os PDFs por prefixo da empresa (01/03/05/06), que pode diferir da série informada no XML.
- Faturamento documentado, médias por período, projeção do mês, fretes e impostos destacados nos XMLs. Médias e projeções são cálculos do CRM sobre NF-e autorizadas, não valores conciliados do ERP.
- Entradas: NF-e emitidas por fornecedores contra as quatro empresas, consultadas pelo serviço oficial de distribuição DF-e da SEFAZ. Mostra valor diário, empresas, fornecedores e cobertura dos XMLs completos. São compras/entradas, não faturamento de vendas.
- Fiscal: distribuição das NF-e de saída por UF do destinatário e CFOP dos itens.
- Impostos: valores destacados nos XMLs de saída e entrada, separados por empresa, além de regime tributário CRT das NF-e e eventual `vCredICMSSN` informado ao comprador pelas empresas do Simples. Os XMLs não comprovam crédito efetivamente apropriado; a pasta `SPED` examinada não contém apuração para esse cálculo. Não use tributo destacado como crédito tomado.
- A aba de catálogo dos relatórios do Falco está temporariamente oculta para todos os perfis; seu endereço antigo redireciona para o dashboard ou para as NF-e emitidas no perfil fiscal.

O valor de **Vendas faturadas** soma somente NF-e de venda autorizadas e não canceladas, identificadas pelo CFOP dos itens. Devolução emitida a fornecedor e retorno de industrialização não entram nesse valor. Devoluções recebidas são mostradas à parte e só reduzem o saldo gerencial quando o XML completo referencia uma venda autorizada da mesma empresa e do mesmo CNPJ. Esse saldo não representa receita líquida contábil, pedidos, comissão, estoque nem o cadastro completo do ERP. O valor por produto é o valor bruto do item e pode diferir do total da nota.

## Consulta SEFAZ e continuidade

`scripts/sync-sefaz.ps1` consulta a distribuição DF-e com os certificados de cada empresa instalados no repositório do usuário do Windows. O servidor verifica ao iniciar e a cada cinco minutos se já pode consultar, respeitando a próxima janela informada pela SEFAZ; `SEFAZ_CHECK_SECONDS` ajusta a checagem. Documentos e posição NSU ficam em `data/sefaz/` para não repetir consultas e preservar o histórico retornado; a página continua a buscar os dados atuais da API local, sem depender de uma planilha. Resumos da SEFAZ não incluem itens e alguns XMLs completos só são liberados após manifestação do destinatário. Uma máquina desligada, sem rede ou sem acesso ao compartilhamento não recebe atualizações durante esse intervalo; a atualização retoma quando o serviço e a conexão voltam.

## Fontes examinadas

Em `\\maxcompany\DEPLOY\BACKUP\BANCO_DE_DADOS` há backups `MASERP.bak`. Eles contêm a base do SQL Server, mas não são tabelas consultáveis diretamente como arquivos e não são uma fonte em tempo real. `\\maxcompany\DEPLOY HOMOLOGACAO` contém uma cópia de homologação menos atual. O dashboard usa os XMLs de produção atualizados nas pastas.

## Verificar

`npm run check` valida formatação, sintaxe, testes e sincronismo do frontend. `npm run sync:frontend` copia `public/` para `frontend-vercel/` após alterações.
