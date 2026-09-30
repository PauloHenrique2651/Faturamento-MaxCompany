# Conciliação dos indicadores do CRM

## Fonte e critérios

- O coletor `scripts/collect-fiscal.mjs` no servidor do ERP publica os dados no Supabase sem depender de navegador ou computador do usuário. Ciclo alvo de 30 segundos; consultas SEFAZ respeitam os intervalos oficiais. As telas consultam novamente a cada 10 segundos.
- Instâncias de desenvolvimento do servidor HTTP não publicam automaticamente. `CRM_BACKGROUND_SYNC=true` é uma opção explícita para instalações sem o coletor dedicado; não usar em paralelo com ele.
- Cada NF-e recebe a conciliação do MASERP pela empresa e chave: vendedor, pedido de origem, valor e quantidade devolvida por item. O XML original não registra devoluções posteriores.
- A conciliação compacta revisa também notas antigas. Mudanças em registros já conciliados têm prioridade sobre o preenchimento histórico em lotes. Falha na revisão do MASERP preserva o último conjunto publicado.
- O faturamento considera notas de venda emitidas no período, inclusive pedidos criados anteriormente. Cancelamentos confirmados ficam separados.
- **Pedidos a faturar** é o saldo das quantidades ativas dos pedidos criados no período, descontadas as quantidades já faturadas em notas válidas até a data final. Faturamentos parciais e quantidades canceladas são considerados.
- A devolução de venda registrada no Falco reduz a nota de origem e acompanha o vendedor, cliente e item. Os XMLs de devolução são documentos de apoio e não são somados novamente. O recorte considera a emissão da venda original.
- Devoluções de compras e de vendas são separadas por direção, finalidade e CFOP. Transferências, remessas e retornos de industrialização não se tornam vendas.
- Compras documentadas não equivalem a CMV. Lucratividade continua baseada nos relatórios do Falco; frete de entrada é outra despesa, sem rateio inventado por vendedor. Percentual sobre custo não é margem sobre receita.
- As análises por CFOP e produto mantêm valores dos itens; o valor fiscal da nota pode incluir frete, impostos e ajustes. Esses valores devem ser identificados como bases distintas.

## Validação

Caso de regressão: MaxSupply, notas Braskem 791 e 793, vendedor Tiago Zagri dos Santos. Devoluções integrais de R$ 362.780,80 e R$ 325.656,58, total R$ 688.437,38. A nota 815 não tem devolução. Resumo, vendedor, notas, detalhes e evolução devem conservar essa atribuição sem duplicidade.

Testes cobrem o contrato cloud, as telas fiscais, a regressão Braskem, cancelamentos e reversão de devolução, distinção compra/venda e preservação de artefatos. O preenchimento histórico pode permanecer em andamento; não confundir sua fila com a atualização das notas do mês corrente.
