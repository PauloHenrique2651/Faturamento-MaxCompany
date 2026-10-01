# Conciliação dos indicadores do CRM

## Fonte e critérios

- O coletor `scripts/collect-fiscal.mjs` no servidor do ERP publica os dados no Supabase sem depender de navegador ou computador do usuário. Ciclo alvo de 30 segundos; consultas SEFAZ respeitam os intervalos oficiais. As telas consultam novamente a cada 10 segundos.
- Instâncias de desenvolvimento do servidor HTTP não publicam automaticamente. `CRM_BACKGROUND_SYNC=true` é uma opção explícita para instalações sem o coletor dedicado; não usar em paralelo com ele.
- Cada NF-e recebe a conciliação do MASERP pela empresa e chave: vendedor, pedido de origem, valor e quantidade devolvida por item. O XML original não registra devoluções posteriores.
- A conciliação compacta revisa também notas antigas. Mudanças em registros já conciliados têm prioridade sobre o preenchimento histórico em lotes. Falha na revisão do MASERP preserva o último conjunto publicado.
- O valor fiscal considera NF-e de venda emitidas no período, inclusive de pedidos anteriores. O faturamento comercial considera os valores dos itens dos pedidos criados no período com vínculo a NF-e válida; não é substituído pelo total fiscal. Cancelamentos confirmados ficam separados.
- **Pedidos a faturar** é o saldo das quantidades ativas dos pedidos criados no período, descontadas as quantidades já faturadas em notas válidas até a data final. Faturamentos parciais e quantidades canceladas são considerados.
- A devolução de venda registrada no Falco reduz a nota de origem e acompanha o vendedor, cliente e item. Os XMLs de devolução são documentos de apoio e não são somados novamente. O recorte considera a emissão da venda original.
- Devoluções de compras e de vendas são separadas por direção, finalidade e CFOP. Transferências, remessas e retornos de industrialização não se tornam vendas.
- Compras documentadas não equivalem a CMV. Lucratividade continua baseada nos relatórios do Falco; frete de entrada já integra o custo das vendas e não deve ser descontado novamente. A margem principal divide o lucro pelas vendas após devoluções; percentual sobre custo é markup.
- As análises por CFOP e produto mantêm valores dos itens; o valor fiscal da nota pode incluir frete, impostos e ajustes. Esses valores devem ser identificados como bases distintas.

## Validação

Caso de regressão: MaxSupply, notas Braskem 791 e 793, vendedor Tiago Zagri dos Santos. Devoluções integrais de R$ 362.780,80 e R$ 325.656,58, total R$ 688.437,38. A nota 815 não tem devolução. Resumo, vendedor, notas, detalhes e evolução devem conservar essa atribuição sem duplicidade.

Testes cobrem o contrato cloud, as telas fiscais, a regressão Braskem, cancelamentos e reversão de devolução, distinção compra/venda e preservação de artefatos. O preenchimento histórico pode permanecer em andamento; não confundir sua fila com a atualização das notas do mês corrente.

## Refino de produtos e visualização (30/09/2026)

Dashboard e faturamento usam um único resumo fiscal/comercial. A análise por XML e a conciliação de produtos ficam em uma seção expansível no faturamento; não repetem os indicadores principais. Filtros específicos de devolução/operação não vazam para outras telas.

A conciliação prioriza o código interno do MASERP comprovado pela empresa, chave da nota, sequência do item, NCM, unidade, quantidade e valor. Nas entradas, também aceita um único vínculo no cadastro fornecedor/produto, com CNPJ, código do fornecedor, NCM e unidade exatos. Identidades ERP conflitantes não podem ser substituídas por nomes parecidos, GTIN ou aprovação antiga. Conversões de embalagem não comprovadas continuam pendentes. O preço de compra é referência parcial, nunca CMV nem lucro oficial.

O coletor 24/7 publica os vínculos dos documentos recentes com a sincronização normal e revisa o histórico do último ano em lotes, priorizando compras. A revisão preserva os XMLs, DANFEs e os critérios fiscais. Notas resumidas, não lançadas no ERP ou com cadastro ambíguo não recebem uma identidade inventada.

Validação de origem: 13.242 itens consultados no período 01/09/2025–30/09/2026; 507 linhas de venda e 11 linhas de compra comprovadas nos XMLs disponíveis. Exemplos conciliados: produtos internos 11649, 629 e 18420, mantendo abertura das notas de compra/venda. A cobertura restante é uma limitação real dos vínculos/documentos disponíveis, não equivalência automática por descrição.

## Bases separadas e virada de mês (01/10/2026)

Fiscal, relatório comercial, compras e lucratividade são apresentados em blocos próprios, sem tratar compras como custo. A lucratividade exibe a base após devoluções/despesas Falco, o custo das vendas, o lucro Falco e o frete de entrada informativo, já incluído no custo. Outras despesas já consideradas na base Falco não são descontadas novamente. O percentual sobre custo é identificado; o resultado não é apresentado como lucro contábil.

O coletor publica retratos do mês atual e do mês anterior a cada ciclo, conservando até 12 meses já coletados no estado local e na nuvem. As telas só escolhem um relatório com datas exatamente correspondentes ao filtro; períodos sem retrato não recebem números de outro período. O horário de revisão é mostrado. A API local também lê a publicação do coletor, sem iniciar outro publicador.

## Integridade da publicação

A revisão de 01/10 encontrou 142 notas de setembro cujo ERP havia sido sobrescrito por um publicador antigo no computador local. O processo foi encerrado. O coletor dedicado passou a comparar também o estado ERP realmente persistido no Supabase e reenviar conciliações perdidas ou alteradas, preservando artefatos. A tarefa do servidor não tem mais o limite de execução de 72 horas. A comparação ignora a ordem das propriedades JSON e conserva cancelamentos fiscais confirmados.

Os resumos SEFAZ não podem substituir itens, tributos ou classificação de um XML completo já armazenado. Uma revisão em lotes recupera documentos que foram degradados anteriormente, lendo o XML privado da própria nuvem e validando empresa e chave. O cancelamento continua sendo atualizado. A navegação para o mostrador preserva as datas selecionadas no dashboard, inclusive após a virada do mês.

## Prioridade da lucratividade e revisão contínua

O lucro apurado pelo Falco aparece primeiro no executivo, no faturamento e no mostrador; o relatório comercial vem abaixo. A composição usa **total faturado com outras despesas − devoluções − outras despesas − custo das vendas** (frete já embutido no custo). As vendas antes das deduções são recompostas pela base líquida, devoluções e despesas oficiais. O campo legado chamado gross já descontava as despesas; ele não deve ser apresentado como venda bruta. Cancelamentos já excluídos das vendas não são descontados de novo. Compras ficam visíveis como movimento de estoque, sem substituir custo.

A igualdade entre base, custo e lucro Falco é conferida nas duas interfaces; diferenças acima de dois centavos recebem aviso, sem inventar ajustes. Relatório comercial usa a data do pedido; a lucratividade usa a emissão da venda.

Além de reler o estado MASERP de todo o histórico configurado, o coletor compara continuamente a publicação antiga na nuvem em páginas de 500 documentos por ciclo, conservando o cursor e reiniciando ao final. Mês atual e anterior são revalidados a cada ciclo. Um relatório mensal anterior desses últimos 12 meses é revisado a cada cinco minutos, sem depender do acesso ao CRM. XMLs são reexaminados integralmente a cada seis horas; a varredura recente permanece entre essas revisões. O histórico recebe um horário de conclusão quando a volta inteira termina; não é declarado instantaneamente revisado.

O resumo usa nomes diretos: vendas faturadas, compras, notas canceladas, vendas devolvidas, custo das vendas, frete de entrada e lucro após despesas. Abaixo aparecem apenas pedidos a faturar e já faturado desses pedidos (pedidos criados no período). Total de pedidos e demais saldos ficam em detalhes. Faturamento parcial usa quantidade efetivamente vinculada; quantidade cancelada não vira venda ativa.

### Limite de calendário SQL

A validação com notas emitidas em 01/10 detectou inclusão indevida dessas notas no relatório de setembro: DateTime construído em hora local era enviado em UTC, fazendo a data final avançar ao dia seguinte. Os parâmetros das procedures agora são datas de calendário UTC à meia-noite; o Falco compara a data ou normaliza a hora internamente. Retratos mensais feitos com a regra anterior são invalidados e revistos. O mesmo limite vale para lucro, lucro por vendedor e fretes de entrada.

## Refino anual e filtros (01/10/2026)

A interface aprovada, as fontes e a identidade visual foram preservadas. Pedidos e carteira têm busca com rótulo visível, situação, ordenação, limpeza dos filtros da lista e carregamento em blocos de 60. Pedidos também permitem selecionar vendedor. Os totais sempre consideram todos os resultados filtrados, inclusive os que ainda não foram expandidos na lista. Campos monetários não quebram seus dígitos entre linhas; os controles da lista têm altura mínima de 44px.

O coletor relê do MASERP o ano civil atual e o anterior a cada ciclo alvo de 30 segundos, inclusive movimentos alterados. Publica fatos por data de emissão, criação do pedido e cronologia do faturamento vinculado. Ano, trimestre e intervalos personalizados dentro dessa cobertura são calculados com as datas exatas do filtro, mantendo o limite de faturamento até a data final. O mesmo cálculo atende executivo, faturamento, mostrador, fretes e pedidos/PDF. Um retrato mensal antigo não substitui uma revisão anual mais recente. Não é reconstrução de um estado histórico imutável: cancelamentos e devoluções são o estado atual do ERP aplicado ao período da nota.

A API envia às telas apenas o recorte solicitado, sem transmitir a cronologia de dois anos em cada resumo. Catálogos de pedidos continuam privados e independentes dos anexos. Períodos fora da cobertura não recebem valores de outro período nem zeros inventados. Documentos fiscais continuam em revisão incremental/cíclica; SEFAZ respeita a janela oficial e a cobertura de notas depende dos documentos disponíveis.

Composição do relatório Falco: `Total das Notas = base usada no lucro + devoluções`; `Total Geral = base usada no lucro`; `Total final = Total Geral + outras despesas`. O total faturado incluindo despesas é apresentado com esse rótulo explicativo. Setembro validado: Total das Notas R$4.128.559,80; devoluções R$724.363,94; Total Geral R$3.404.195,86; outras despesas R$250,00; Total final R$3.404.445,86; custo R$2.218.781,40; lucro R$1.185.414,46. Despesas e frete não recebem um segundo desconto.

Validação: consultas anuais e recortes mensais/personalizados foram comparados diretamente às procedures Falco e às relações pedido/item/nota; testes automatizados verificam limites de calendário, faturamento parcial, revisão de snapshots antigos, autorização, filtros e composição sem dupla dedução. Valores arredondados para exibição; a precisão original das procedures é mantida no cálculo.

## Contas a pagar e carteira a receber interligadas

O coletor consulta `contasapagar_T` no servidor 24/7 em cada ciclo, junto à carteira a receber. Publica catálogo privado e autenticado na nuvem; as telas verificam a publicação a cada 10 segundos e reaproveitam os últimos dados confirmados. Não depende do navegador nem do computador do usuário para coletar.

Cada parcela é identificada por empresa, título e parcela. Usa vencimento reprogramado quando informado e valor menos desconto mais juros e mora, conforme fórmula do MASERP. Pagos, baixados, excluídos, encerrados por renegociação e previsões provisórias ficam fora. Notas vinculadas são agrupadas por parcela, sem multiplicar o valor. Documentos financeiros sem nota continuam visíveis; não são tratados como compras.

As duas telas compartilham empresa e período de vencimento: saldo projetado = recebimentos a vencer sem antecipados menos obrigações a vencer, incluindo bloqueados identificados. Vencidos aparecem separados, sem inventar data futura; bloqueados são um subconjunto, não uma despesa adicional. Busca e situação da lista não alteram o consolidado. Trata-se de previsão sem saldo bancário inicial e não de capital líquido disponível. Não há lançamentos nem baixas no ERP.

Validação inicial em 01/10/2026: 243 parcelas a pagar e 593 a receber, sem IDs duplicados. Valores a pagar conferidos por empresa diretamente na tabela, com mesma regra; nenhuma parcela sem vencimento ou negativa na amostra. Para outubro, entradas previstas R$ 2.934.749,40, pagamentos previstos R$ 1.309.050,09, saldo projetado R$ 1.625.699,31. Valores variam conforme a operação e não são fixados no frontend.

### Origem das parcelas e identidade do fornecedor

A origem aparece na lista: nota de entrada ou sem nota vinculada, com filtro próprio. O vínculo é pelo título (`empresa + doc_pagamento_IN`) em `notafiscalentradadocumentosapagar_T`, pois o MASERP pode registrar apenas a primeira parcela na relação, embora as demais pertençam ao mesmo título. Notas são agregadas dentro da parcela e não multiplicam saldos. A referência fiscal vem de `notafiscalentrada_T`, com emitente confirmado em `notafiscalparticipantes_T`; não se associa pela semelhança de nome ou número. Mostra razão social e CNPJ.

Conferência ATLAS: fornecedor ATLAS S.A, código 492, CNPJ 89.723.837/0008-49, nota de entrada 1054433, título 959 e parcelas 1/2. O cliente ATLAS COPCO BRASIL LTDA possui CNPJs 57.029.431/0038-90 e 57.029.431/0024-94. São entidades diferentes. A revisão ampliou a identificação de origem de 60 para 230 das 243 parcelas, preservando valores e quantidades; as 13 restantes continuam sinalizadas sem vínculo fiscal informado.
