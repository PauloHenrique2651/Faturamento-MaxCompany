# Especificação de views — CRM Executivo MaxCompany

Este documento é o pacote a ser entregue ao DBA/Falco. As views são **somente leitura** e não alteram tabelas, rotinas ou executáveis do ERP. O CRM consome apenas essas views por uma API interna.

## Padrões obrigatórios

- Schema recomendado: `crm` (ex.: `crm.vw_crm_pedidos_venda_itens`).
- Uma chave estável por linha: IDs nativos do ERP; não usar `ROW_NUMBER()` como identificação.
- Datas em `datetime2`, valores em `decimal(18,2)`, quantidades em `decimal(18,4)`.
- Incluir `empresa_id` e `atualizado_em` em todas as views transacionais.
- Manter `situacao_codigo` original e publicar também `situacao_nome` somente depois de homologar os códigos.
- Itens cancelados/excluídos não devem desaparecer: publicar `cancelado`, `excluido`, `quantidade_cancelada` e `valor_cancelado` quando aplicável.
- Não calcular comissão no ERP nesta etapa; a interface deixará regras parametrizáveis posteriormente.

## Camada de cadastro

| View                     | Origem principal mapeada        | Para que serve                                            | Campos mínimos                                                                                                             |
| ------------------------ | ------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `vw_crm_empresas`        | cadastro de empresas            | Filtro corporativo e consolidação                         | `empresa_id`, `codigo`, `nome_fantasia`, `razao_social`, `documento`, `ativa`, `atualizado_em`                             |
| `vw_crm_clientes`        | `cliente`, `clientejuridica`    | Carteira, ranking e drill-down do cliente                 | `cliente_id`, `codigo`, `razao_social`, `nome_fantasia`, `documento`, `cidade`, `uf`, `segmento`, `ativo`, `atualizado_em` |
| `vw_crm_fornecedores`    | `fornecedor`                    | Ranking de compras, recebimento e análise de fornecedores | `fornecedor_id`, `codigo`, `razao_social`, `nome_fantasia`, `documento`, `cidade`, `uf`, `ativo`, `atualizado_em`          |
| `vw_crm_produtos`        | `produto`, `produtoempresa_T`   | Código do produto, catálogo e filtros de produto/grupo    | `produto_id`, `produto_codigo`, `produto_nome`, `grupo_codigo`, `grupo_nome`, `unidade`, `ativo`, `atualizado_em`          |
| `vw_crm_vendedores`      | cadastro de vendedores/usuários | Performance por vendedor e atribuição de venda            | `vendedor_id`, `codigo`, `vendedor_nome`, `grupo_id`, `grupo_nome`, `tipo`, `ativo`, `atualizado_em`                       |
| `vw_crm_transportadoras` | cadastro de transportadoras     | Expedição e prazo de entrega                              | `transportadora_id`, `codigo`, `transportadora_nome`, `documento`, `ativa`, `atualizado_em`                                |

## Comercial

| View                             | Granularidade              | Para que serve                                       | Campos mínimos além das chaves                                                                                                                                                                                        |
| -------------------------------- | -------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vw_crm_orcamentos_cabecalho`    | 1 linha por orçamento      | Conversão de propostas, funil e orçamento → pedido   | `orcamento_numero`, `data_emissao`, `validade`, `cliente_id`, `vendedor_id`, `valor_bruto`, `desconto`, `valor_liquido`, `situacao_codigo`, `situacao_nome`, `pedido_gerado_id`, `cancelado`                          |
| `vw_crm_orcamentos_itens`        | 1 linha por item           | Produtos cotados e valores por orçamento             | `orcamento_id`, `item_sequencia`, `produto_id`, `quantidade`, `preco_unitario`, `desconto`, `valor_item`, `cancelado`                                                                                                 |
| `vw_crm_pedidos_venda_cabecalho` | 1 linha por pedido         | Pedidos, ticket, clientes, vendedores e situação     | `pedido_numero`, `serie`, `data_pedido`, `cliente_id`, `vendedor_interno_id`, `vendedor_externo_id`, `valor_bruto`, `desconto`, `frete`, `valor_liquido`, `situacao_codigo`, `situacao_nome`, `cancelado`, `excluido` |
| `vw_crm_pedidos_venda_itens`     | 1 linha por item           | Mais vendidos, código do produto e detalhe do pedido | `pedido_id`, `item_sequencia`, `produto_id`, `quantidade`, `quantidade_cancelada`, `preco_unitario`, `desconto`, `valor_item`, `valor_cancelado`, `cancelado`, `excluido`                                             |
| `vw_crm_devolucoes_venda_itens`  | 1 linha por item devolvido | Valor líquido de vendas, devoluções e alertas        | `devolucao_id`, `data_devolucao`, `pedido_id`, `documento_saida_id`, `cliente_id`, `produto_id`, `quantidade`, `valor_item`, `motivo`, `cancelado`                                                                    |

## Operação

| View                              | Origem principal mapeada       | Para que serve                                   | Campos mínimos                                                                                                                                                                      |
| --------------------------------- | ------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vw_crm_faturamento_documentos`   | `notafiscalsaida_T`            | Faturamento emitido, por cliente e pedido        | `documento_saida_id`, `numero`, `serie`, `data_emissao`, `pedido_id`, `cliente_id`, `valor_produtos`, `valor_frete`, `valor_total`, `situacao_codigo`, `cancelado`                  |
| `vw_crm_faturamento_itens`        | `itensnotafiscalsaida_T`       | Faturamento por produto e reconciliação de itens | `documento_saida_id`, `item_sequencia`, `produto_id`, `quantidade`, `valor_item`, `pedido_item_id`, `cancelado`                                                                     |
| `vw_crm_expedicao`                | `entregaspedido_T`, `pedido_T` | Pedidos a expedir, atraso e SLA logístico        | `expedicao_id`, `pedido_id`, `cliente_id`, `transportadora_id`, `data_prevista`, `data_separacao`, `data_saida`, `data_entrega`, `situacao_codigo`, `situacao_nome`, `valor_pedido` |
| `vw_crm_pedidos_compra_cabecalho` | `pedidocompra_T`               | Compras, prazo, fornecedores e valores           | `pedido_compra_id`, `pedido_numero`, `data_pedido`, `fornecedor_id`, `comprador_id`, `valor_bruto`, `desconto`, `frete`, `valor_liquido`, `situacao_codigo`, `cancelado`            |
| `vw_crm_pedidos_compra_itens`     | `itenspedidocompra_T`          | Mais comprados, custo e detalhamento de compras  | `pedido_compra_id`, `item_sequencia`, `produto_id`, `quantidade`, `quantidade_recebida`, `preco_unitario`, `valor_item`, `cancelado`                                                |
| `vw_crm_recebimento_documentos`   | `notafiscalentrada_T`          | Recebimento, divergências e prazo de fornecedor  | `documento_entrada_id`, `numero`, `serie`, `data_emissao`, `data_entrada`, `pedido_compra_id`, `fornecedor_id`, `valor_total`, `situacao_codigo`, `cancelado`                       |
| `vw_crm_recebimento_itens`        | `itensnotafiscalentrada_T`     | Itens recebidos, divergência compra × entrada    | `documento_entrada_id`, `item_sequencia`, `produto_id`, `quantidade`, `valor_item`, `pedido_compra_item_id`, `divergencia_quantidade`, `divergencia_valor`                          |

## Financeiro e contratos

| View                    | Origem principal mapeada                 | Para que serve                               | Campos mínimos                                                                                                                                                                                                             |
| ----------------------- | ---------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vw_crm_contas_receber` | `contasareceber_T` + baixas              | Aging, inadimplência, fluxo de recebimento   | `titulo_receber_id`, `documento`, `cliente_id`, `pedido_id`, `documento_saida_id`, `data_emissao`, `vencimento`, `data_baixa`, `valor_original`, `valor_baixado`, `valor_aberto`, `situacao_codigo`, `cancelado`           |
| `vw_crm_contas_pagar`   | `contasapagar_T` + baixas                | Obrigações, previsão de caixa e fornecedores | `titulo_pagar_id`, `documento`, `fornecedor_id`, `pedido_compra_id`, `documento_entrada_id`, `data_emissao`, `vencimento`, `data_baixa`, `valor_original`, `valor_baixado`, `valor_aberto`, `situacao_codigo`, `cancelado` |
| `vw_crm_contratos`      | `contrato_T`, `contrato_LT`, status/tipo | Carteira contratada, vigência e renovações   | `contrato_id`, `contrato_numero`, `cliente_id`, `tipo_id`, `tipo_nome`, `data_inicio`, `data_fim`, `valor_total`, `valor_mensal`, `situacao_codigo`, `situacao_nome`, `ativo`                                              |

## Ordem de entrega para o Falco

1. Cadastros: empresas, clientes, fornecedores, produtos e vendedores.
2. Comercial: pedidos de venda (cabeçalho e itens); esta dupla alimenta o dashboard inicial.
3. Orçamentos, faturamento e expedição.
4. Compras e recebimento.
5. Financeiro e contratos.

## Critérios de aceite

- Um pedido do ERP pode ser encontrado pelo `pedido_id`/número no CRM e seus itens fecham com o cabeçalho.
- Rankings desconsideram itens cancelados/excluídos por padrão, mas permitem auditoria.
- Vendas em pedidos, faturamento e contas a receber permanecem métricas distintas; não podem ser somadas como se fossem a mesma receita.
- Todas as views retornam dados por empresa e respeitam o período filtrado por data de negócio.
- O usuário técnico do CRM recebe `SELECT` somente nessas views; sem acesso direto às tabelas.

## Homologação obrigatória

Antes de liberar cada módulo, o Falco e a MaxCompany devem validar uma amostra de pelo menos 10 documentos reais, incluindo registros normais, cancelados e parcialmente atendidos.

- Confirmar que a chave publicada é única e estável e que nenhum item fica órfão do respectivo cabeçalho.
- Reconciliar quantidades e valores totais da view com a mesma tela ou relatório do ERP Falco.
- Validar empresa, cliente/fornecedor, vendedor, produto, datas, situação, cancelamentos e devoluções.
- Confirmar qual data de negócio controla cada filtro e publicar os horários sem conversão ambígua de fuso.
- Não usar `NOLOCK` como solução padrão; a consistência dos indicadores é requisito do CRM.
- Garantir paginação e filtros por empresa/período na API para evitar a transferência integral das views ao navegador.
- Registrar os códigos de situação homologados e a regra de inclusão de cada indicador antes de colocar a view em produção.

O arquivo `sql/03-validar-views-falco.sql` faz a checagem estrutural inicial. Ele não substitui a reconciliação funcional com o ERP.
