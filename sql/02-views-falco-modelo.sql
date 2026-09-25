/*
  MODELO DOCUMENTAL DE VIEWS — CRM EXECUTIVO MAXCOMPANY

  Este arquivo NÃO contém comandos executáveis de criação porque os nomes
  físicos das colunas do MASERP precisam ser confirmados pela Falco.

  Objetivo:
  - registrar o formato de saída esperado pelo CRM;
  - evitar que marcadores ou nomes presumidos sejam executados em produção;
  - orientar o DBA na criação das views no schema [crm].

  Regras para implementação pela Falco:
  1. Criar as views listadas em docs/ESPECIFICACAO-VIEWS-FALCO.md.
  2. Manter IDs nativos e estáveis; não gerar IDs com ROW_NUMBER().
  3. Não usar WITH (NOLOCK) nem nível READ UNCOMMITTED.
  4. Não ocultar cancelamentos ou exclusões: publicar as flags previstas.
  5. Usar decimal(18,2) para valores e decimal(18,4) para quantidades.
  6. Retornar datas como date ou datetime2 e documentar o fuso horário.
  7. Garantir que cada item pertença a exatamente um cabeçalho.
  8. Conceder SELECT somente no schema [crm] ao usuário técnico do CRM.

  Exemplo de assinatura esperada, propositalmente mantido em comentário:

  CREATE OR ALTER VIEW crm.vw_crm_pedidos_venda_cabecalho AS
  SELECT
    <empresa_id_real>          AS empresa_id,
    <pedido_id_real>           AS pedido_id,
    <numero_pedido_real>       AS pedido_numero,
    <data_pedido_real>         AS data_pedido,
    <cliente_id_real>          AS cliente_id,
    <vendedor_interno_real>    AS vendedor_interno_id,
    <vendedor_externo_real>    AS vendedor_externo_id,
    <valor_liquido_real>       AS valor_liquido,
    <situacao_codigo_real>     AS situacao_codigo,
    <cancelado_real>           AS cancelado,
    <excluido_real>            AS excluido,
    <atualizado_em_real>       AS atualizado_em
  FROM <tabela_real>;

  Depois da criação, executar apenas o script de conferência:
  sql/03-validar-views-falco.sql
*/
