/*
  VALIDAÇÃO SOMENTE LEITURA DAS VIEWS FALCO
  Pode ser executada após a Falco criar as views no banco MASERP.
  O resultado vazio significa que as views e colunas essenciais existem.
*/
USE [MASERP];
GO

;WITH views_esperadas AS (
  SELECT nome
  FROM (VALUES
    (N'vw_crm_empresas'), (N'vw_crm_clientes'),
    (N'vw_crm_fornecedores'), (N'vw_crm_produtos'),
    (N'vw_crm_vendedores'), (N'vw_crm_transportadoras'),
    (N'vw_crm_orcamentos_cabecalho'), (N'vw_crm_orcamentos_itens'),
    (N'vw_crm_pedidos_venda_cabecalho'), (N'vw_crm_pedidos_venda_itens'),
    (N'vw_crm_devolucoes_venda_itens'),
    (N'vw_crm_faturamento_documentos'), (N'vw_crm_faturamento_itens'),
    (N'vw_crm_expedicao'),
    (N'vw_crm_pedidos_compra_cabecalho'), (N'vw_crm_pedidos_compra_itens'),
    (N'vw_crm_recebimento_documentos'), (N'vw_crm_recebimento_itens'),
    (N'vw_crm_contas_receber'), (N'vw_crm_contas_pagar'),
    (N'vw_crm_contratos')
  ) AS lista(nome)
)
SELECT
  N'VIEW_AUSENTE' AS tipo_erro,
  N'crm.' + esperada.nome AS objeto,
  CAST(NULL AS sysname) AS coluna
FROM views_esperadas AS esperada
LEFT JOIN sys.views AS encontrada
  ON encontrada.schema_id = SCHEMA_ID(N'crm')
 AND encontrada.name = esperada.nome
WHERE encontrada.object_id IS NULL
ORDER BY objeto;
GO

;WITH colunas_essenciais AS (
  SELECT view_nome, coluna
  FROM (VALUES
    (N'vw_crm_empresas', N'empresa_id'),
    (N'vw_crm_clientes', N'cliente_id'),
    (N'vw_crm_fornecedores', N'fornecedor_id'),
    (N'vw_crm_produtos', N'produto_id'),
    (N'vw_crm_produtos', N'produto_codigo'),
    (N'vw_crm_vendedores', N'vendedor_id'),
    (N'vw_crm_orcamentos_cabecalho', N'orcamento_id'),
    (N'vw_crm_orcamentos_itens', N'orcamento_id'),
    (N'vw_crm_pedidos_venda_cabecalho', N'pedido_id'),
    (N'vw_crm_pedidos_venda_cabecalho', N'empresa_id'),
    (N'vw_crm_pedidos_venda_cabecalho', N'data_pedido'),
    (N'vw_crm_pedidos_venda_itens', N'pedido_id'),
    (N'vw_crm_pedidos_venda_itens', N'pedido_item_id'),
    (N'vw_crm_pedidos_venda_itens', N'produto_id'),
    (N'vw_crm_faturamento_documentos', N'documento_saida_id'),
    (N'vw_crm_faturamento_itens', N'documento_saida_id'),
    (N'vw_crm_expedicao', N'expedicao_id'),
    (N'vw_crm_pedidos_compra_cabecalho', N'pedido_compra_id'),
    (N'vw_crm_pedidos_compra_itens', N'pedido_compra_id'),
    (N'vw_crm_recebimento_documentos', N'documento_entrada_id'),
    (N'vw_crm_recebimento_itens', N'documento_entrada_id'),
    (N'vw_crm_contas_receber', N'titulo_receber_id'),
    (N'vw_crm_contas_pagar', N'titulo_pagar_id'),
    (N'vw_crm_contratos', N'contrato_id')
  ) AS lista(view_nome, coluna)
)
SELECT
  N'COLUNA_AUSENTE' AS tipo_erro,
  N'crm.' + esperada.view_nome AS objeto,
  esperada.coluna
FROM colunas_essenciais AS esperada
LEFT JOIN sys.views AS view_encontrada
  ON view_encontrada.schema_id = SCHEMA_ID(N'crm')
 AND view_encontrada.name = esperada.view_nome
LEFT JOIN sys.columns AS coluna_encontrada
  ON coluna_encontrada.object_id = view_encontrada.object_id
 AND coluna_encontrada.name = esperada.coluna
WHERE view_encontrada.object_id IS NOT NULL
  AND coluna_encontrada.column_id IS NULL
ORDER BY objeto, coluna;
GO
