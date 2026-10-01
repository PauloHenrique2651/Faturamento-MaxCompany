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
- Compras documentadas não equivalem a CMV. Lucratividade continua baseada nos relatórios do Falco; frete de entrada é outra despesa, sem rateio inventado por vendedor. Percentual sobre custo não é margem sobre receita.
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

Fiscal, relatório comercial, compras e lucratividade são apresentados em blocos próprios, sem tratar compras como custo. A lucratividade exibe a base após devoluções/despesas Falco, o custo das vendas, o lucro Falco e o ajuste de frete de entrada. Outras despesas já consideradas na base Falco não são descontadas novamente. O percentual sobre custo é identificado; o resultado não é apresentado como lucro contábil.

O coletor publica retratos do mês atual e do mês anterior a cada ciclo, conservando até 12 meses já coletados no estado local e na nuvem. As telas só escolhem um relatório com datas exatamente correspondentes ao filtro; períodos sem retrato não recebem números de outro período. O horário de revisão é mostrado. A API local também lê a publicação do coletor, sem iniciar outro publicador.

## Integridade da publicação

A revisão de 01/10 encontrou 142 notas de setembro cujo ERP havia sido sobrescrito por um publicador antigo no computador local. O processo foi encerrado. O coletor dedicado passou a comparar também o estado ERP realmente persistido no Supabase e reenviar conciliações perdidas ou alteradas, preservando artefatos. A tarefa do servidor não tem mais o limite de execução de 72 horas. A comparação ignora a ordem das propriedades JSON e conserva cancelamentos fiscais confirmados.

Os resumos SEFAZ não podem substituir itens, tributos ou classificação de um XML completo já armazenado. Uma revisão em lotes recupera documentos que foram degradados anteriormente, lendo o XML privado da própria nuvem e validando empresa e chave. O cancelamento continua sendo atualizado. A navegação para o mostrador preserva as datas selecionadas no dashboard, inclusive após a virada do mês.

## Prioridade da lucratividade e revisão contínua

O resultado após frete aparece primeiro no executivo, no faturamento e no mostrador; o relatório comercial vem abaixo. A composição usa **vendas do relatório de lucro − devoluções − despesas Falco − custo das vendas − frete de entrada**. As vendas antes das deduções são recompostas pela base líquida, devoluções e despesas oficiais. O campo legado chamado gross já descontava as despesas; ele não deve ser apresentado como venda bruta. Cancelamentos já excluídos das vendas não são descontados de novo. Compras ficam visíveis como movimento de estoque, sem substituir custo.

A igualdade entre base, custo e lucro Falco é conferida nas duas interfaces; diferenças acima de dois centavos recebem aviso, sem inventar ajustes. Relatório comercial usa a data do pedido; a lucratividade usa a emissão da venda.

Além de reler o estado MASERP de todo o histórico configurado, o coletor compara continuamente a publicação antiga na nuvem em páginas de 500 documentos por ciclo, conservando o cursor e reiniciando ao final. Mês atual e anterior são revalidados a cada ciclo. Um relatório mensal anterior desses últimos 12 meses é revisado a cada cinco minutos, sem depender do acesso ao CRM. XMLs são reexaminados integralmente a cada seis horas; a varredura recente permanece entre essas revisões. O histórico recebe um horário de conclusão quando a volta inteira termina; não é declarado instantaneamente revisado.

O resumo usa nomes diretos: vendas faturadas, compras, notas canceladas, vendas devolvidas, custo das vendas, frete de entrada e lucro após despesas. Abaixo aparecem apenas pedidos a faturar e já faturado desses pedidos (pedidos criados no período). Total de pedidos e demais saldos ficam em detalhes. Faturamento parcial usa quantidade efetivamente vinculada; quantidade cancelada não vira venda ativa.
