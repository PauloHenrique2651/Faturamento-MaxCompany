const activeOrder = 'p.ped_dataexclusao_DT IS NULL';
const validInvoice = 'ISNULL(n.not_cancelada_BT, 0) = 0';

export const dashboardQuery = `
DECLARE @inicio date = DATEADD(day, -@dias, CAST(GETDATE() AS date));

SELECT
  (SELECT COUNT(*) FROM cliente) AS clientesCadastrados,
  (SELECT COUNT(*) FROM produto) AS produtosCadastrados,
  (SELECT COUNT(*) FROM orcamento_T WHERE orc_datainclusao_DT >= @inicio) AS orcamentos,
  (SELECT COUNT(*) FROM pedido_T p WHERE p.ped_datainclusao_DT >= @inicio AND ${activeOrder}) AS pedidos,
  (SELECT ISNULL(SUM(CAST(i.ite_quantidade_NM AS decimal(18,2)) * CAST(i.ite_preco_MN AS decimal(18,2))), 0)
     FROM pedido_T p
     JOIN itenspedido_T i ON i.emp_empresa_IN=p.emp_empresa_IN AND i.ped_pedido_IN=p.ped_pedido_IN AND i.ped_serie_CH=p.ped_serie_CH
    WHERE p.ped_datainclusao_DT >= @inicio AND ${activeOrder}) AS valorPedidos,
  (SELECT ISNULL(SUM(n.not_valortotal_MN), 0) FROM notafiscalsaida_T n WHERE n.not_dataemissao_DT >= @inicio AND ${validInvoice}) AS faturado,
  (SELECT ISNULL(SUM(c.ctr_valor_MN), 0) FROM contasareceber_T c WHERE c.ctr_databaixa_DT IS NULL AND c.ctr_datavencimento_DT < CAST(GETDATE() AS date)) AS receberVencido,
  (SELECT ISNULL(SUM(c.par_valor_MN), 0) FROM contasapagar_T c WHERE c.par_databaixa_DT IS NULL AND c.par_datavencimento_DT < CAST(GETDATE() AS date)) AS pagarVencido;

SELECT etapa, quantidade, valor FROM (
  SELECT 1 ordem, 'Orçamentos' etapa, COUNT(DISTINCT CONCAT(o.emp_empresa_IN,'-',o.orc_orcamento_IN,'-',o.orc_serie_CH)) quantidade,
         ISNULL(SUM(CAST(i.ite_quantidade_NM AS decimal(18,2))*CAST(i.ite_preco_MN AS decimal(18,2))),0) valor
    FROM orcamento_T o JOIN itensorcamento_T i ON i.emp_empresa_IN=o.emp_empresa_IN AND i.orc_orcamento_IN=o.orc_orcamento_IN AND i.orc_serie_CH=o.orc_serie_CH
   WHERE o.orc_datainclusao_DT >= @inicio
  UNION ALL
  SELECT 2, 'Pedidos', COUNT(DISTINCT CONCAT(p.emp_empresa_IN,'-',p.ped_pedido_IN,'-',p.ped_serie_CH)),
         ISNULL(SUM(CAST(i.ite_quantidade_NM AS decimal(18,2))*CAST(i.ite_preco_MN AS decimal(18,2))),0)
    FROM pedido_T p JOIN itenspedido_T i ON i.emp_empresa_IN=p.emp_empresa_IN AND i.ped_pedido_IN=p.ped_pedido_IN AND i.ped_serie_CH=p.ped_serie_CH
   WHERE p.ped_datainclusao_DT >= @inicio AND ${activeOrder}
  UNION ALL
  SELECT 3, 'Em separação', COUNT(DISTINCT CONCAT(p.emp_empresa_IN,'-',p.ped_pedido_IN,'-',p.ped_serie_CH)),
         ISNULL(SUM(CAST((i.ite_quantidade_NM-i.ite_separado_NM) AS decimal(18,2))*CAST(i.ite_preco_MN AS decimal(18,2))),0)
    FROM pedido_T p JOIN itenspedido_T i ON i.emp_empresa_IN=p.emp_empresa_IN AND i.ped_pedido_IN=p.ped_pedido_IN AND i.ped_serie_CH=p.ped_serie_CH
   WHERE p.ped_datainclusao_DT >= @inicio AND ${activeOrder} AND ISNULL(i.ite_separado_NM,0) < i.ite_quantidade_NM
  UNION ALL
  SELECT 4, 'Faturados', COUNT(*), ISNULL(SUM(n.not_valortotal_MN),0)
    FROM notafiscalsaida_T n WHERE n.not_dataemissao_DT >= @inicio AND ${validInvoice}
) fluxo ORDER BY ordem;

SELECT TOP 12 CONVERT(char(10), n.not_dataemissao_DT, 23) dia, ISNULL(SUM(n.not_valortotal_MN),0) valor
  FROM notafiscalsaida_T n
 WHERE n.not_dataemissao_DT >= DATEADD(day,-11,CAST(GETDATE() AS date)) AND ${validInvoice}
 GROUP BY CONVERT(char(10), n.not_dataemissao_DT, 23)
 ORDER BY dia;

SELECT TOP 10 p.pro_codigo codigo, p.pro_descricao descricao,
       CAST(SUM(i.ite_quantidade_NM) AS decimal(18,2)) quantidade,
       CAST(SUM(i.ite_quantidade_NM*i.ite_preco_MN) AS decimal(18,2)) valor
  FROM itensnotafiscalsaida_T i
  JOIN notafiscalsaida_T n ON n.emp_empresa_IN=i.emp_empresa_IN AND n.not_numero_IN=i.not_numero_IN
  JOIN produto p ON p.pro_codigo=i.pro_produto_IN
 WHERE n.not_dataemissao_DT >= @inicio AND ${validInvoice}
 GROUP BY p.pro_codigo,p.pro_descricao
 ORDER BY valor DESC;

SELECT TOP 12 tipo, codigo, dataEvento, descricao FROM (
  SELECT 'Pedido' tipo, CONCAT(p.emp_empresa_IN,'/',p.ped_pedido_IN,p.ped_serie_CH) codigo, p.ped_datainclusao_DT dataEvento,
         c.cli_nomerazao descricao FROM pedido_T p LEFT JOIN cliente c ON c.cli_codigo=p.cli_cliente_IN WHERE p.ped_datainclusao_DT>=@inicio
  UNION ALL
  SELECT 'Nota fiscal', CONCAT(n.emp_empresa_IN,'/',n.not_numero_IN), n.not_dataemissao_DT,
         c.cli_nomerazao FROM notafiscalsaida_T n LEFT JOIN cliente c ON c.cli_codigo=n.cli_cliente_IN WHERE n.not_dataemissao_DT>=@inicio
  UNION ALL
  SELECT 'Recebimento', CONCAT(n.emp_empresa_IN,'/',n.not_numerointerno_IN), n.not_dataentrada_DT,
         CONCAT('NF ',n.not_numero_IN) FROM notafiscalentrada_T n WHERE n.not_dataentrada_DT>=@inicio
) a ORDER BY dataEvento DESC;
`;

export const listQueries = {
  contratos: `SELECT TOP (@limite) CONCAT(c.emp_empresa_IN,'/',c.con_contrato_IN) codigo,c.con_datainclusao_DT data,cli.cli_nomerazao entidade,CONCAT('Status ERP ',c.con_statuscontrato_IN) situacao FROM contrato_T c LEFT JOIN cliente cli ON cli.cli_codigo=c.cli_cliente_IN WHERE (@busca='' OR cli.cli_nomerazao LIKE @termo OR CAST(c.con_contrato_IN AS varchar(20)) LIKE @termo) ORDER BY c.con_datainclusao_DT DESC`,
  orcamentos: `
    SELECT TOP (@limite) CONCAT(o.emp_empresa_IN,'/',o.orc_orcamento_IN,o.orc_serie_CH) codigo,
      o.orc_datainclusao_DT data, COALESCE(c.cli_nomerazao,o.orc_nomecliente_VC) entidade,
      CAST(ISNULL(SUM(i.ite_quantidade_NM*i.ite_preco_MN),0) AS decimal(18,2)) valor,
      COUNT(i.ite_sequencia_IN) itens, o.orc_datafinalizacao_DT conclusao
    FROM orcamento_T o LEFT JOIN cliente c ON c.cli_codigo=o.cli_cliente_IN
    LEFT JOIN itensorcamento_T i ON i.emp_empresa_IN=o.emp_empresa_IN AND i.orc_orcamento_IN=o.orc_orcamento_IN AND i.orc_serie_CH=o.orc_serie_CH
    WHERE (@busca='' OR c.cli_nomerazao LIKE @termo OR CAST(o.orc_orcamento_IN AS varchar(20)) LIKE @termo)
    GROUP BY o.emp_empresa_IN,o.orc_orcamento_IN,o.orc_serie_CH,o.orc_datainclusao_DT,c.cli_nomerazao,o.orc_nomecliente_VC,o.orc_datafinalizacao_DT
    ORDER BY o.orc_datainclusao_DT DESC`,
  pedidos: `
    SELECT TOP (@limite) CONCAT(p.emp_empresa_IN,'/',p.ped_pedido_IN,p.ped_serie_CH) codigo,
      p.ped_datainclusao_DT data, c.cli_nomerazao entidade,
      CAST(ISNULL(SUM(i.ite_quantidade_NM*i.ite_preco_MN),0) AS decimal(18,2)) valor,
      COUNT(i.ite_sequencia_IN) itens, p.sit_situacao_IN situacao
    FROM pedido_T p LEFT JOIN cliente c ON c.cli_codigo=p.cli_cliente_IN
    LEFT JOIN itenspedido_T i ON i.emp_empresa_IN=p.emp_empresa_IN AND i.ped_pedido_IN=p.ped_pedido_IN AND i.ped_serie_CH=p.ped_serie_CH
    WHERE p.ped_dataexclusao_DT IS NULL AND (@busca='' OR c.cli_nomerazao LIKE @termo OR CAST(p.ped_pedido_IN AS varchar(20)) LIKE @termo)
    GROUP BY p.emp_empresa_IN,p.ped_pedido_IN,p.ped_serie_CH,p.ped_datainclusao_DT,c.cli_nomerazao,p.sit_situacao_IN
    ORDER BY p.ped_datainclusao_DT DESC`,
  clientes: `
    SELECT TOP (@limite) c.cli_codigo codigo, c.cli_nomerazao entidade, j.cli_fantasia complemento,
      c.cli_datacadastro data, c.cli_situacao situacao, c.cli_email email
    FROM cliente c LEFT JOIN clientejuridica j ON j.cli_codigo=c.cli_codigo
    WHERE (@busca='' OR c.cli_nomerazao LIKE @termo OR j.cli_fantasia LIKE @termo OR CAST(c.cli_codigo AS varchar(20)) LIKE @termo)
    ORDER BY c.cli_nomerazao`,
  produtos: `
    SELECT TOP (@limite) p.pro_codigo codigo, p.pro_descricao entidade, p.pro_barra complemento,
      p.pro_datacadastro data, p.pro_situacao situacao,
      CAST(MAX(pe.pro_venda1_MN) AS decimal(18,2)) valor
    FROM produto p LEFT JOIN produtoempresa_T pe ON pe.pro_produto_IN=p.pro_codigo
    WHERE (@busca='' OR p.pro_descricao LIKE @termo OR p.pro_barra LIKE @termo OR CAST(p.pro_codigo AS varchar(20)) LIKE @termo)
    GROUP BY p.pro_codigo,p.pro_descricao,p.pro_barra,p.pro_datacadastro,p.pro_situacao
    ORDER BY p.pro_descricao`,
  compras: `
    SELECT TOP (@limite) CONCAT(p.emp_empresa_IN,'/',p.ped_pedido_IN) codigo, p.ped_datainclusao_DT data,
      f.for_razao entidade, CAST(ISNULL(SUM(i.ite_quantidade_NM*i.ite_preco_MN),0) AS decimal(18,2)) valor,
      COUNT(i.ite_sequencia_IN) itens, p.ped_databaixa_DT conclusao
    FROM pedidocompra_T p LEFT JOIN fornecedor f ON f.for_codigo=p.for_fornecedor_IN
    LEFT JOIN itenspedidocompra_T i ON i.emp_empresa_IN=p.emp_empresa_IN AND i.ped_pedido_IN=p.ped_pedido_IN
    WHERE (@busca='' OR f.for_razao LIKE @termo OR CAST(p.ped_pedido_IN AS varchar(20)) LIKE @termo)
    GROUP BY p.emp_empresa_IN,p.ped_pedido_IN,p.ped_datainclusao_DT,f.for_razao,p.ped_databaixa_DT
    ORDER BY p.ped_datainclusao_DT DESC`,
  faturamento: `
    SELECT TOP (@limite) CONCAT(n.emp_empresa_IN,'/',n.not_numero_IN) codigo, n.not_dataemissao_DT data,
      c.cli_nomerazao entidade, CAST(n.not_valortotal_MN AS decimal(18,2)) valor,
      CASE WHEN n.not_cancelada_BT=1 THEN 'Cancelada' WHEN n.not_lancada_BT=1 THEN 'Lançada' ELSE 'Em processamento' END situacao
    FROM notafiscalsaida_T n LEFT JOIN cliente c ON c.cli_codigo=n.cli_cliente_IN
    WHERE (@busca='' OR c.cli_nomerazao LIKE @termo OR CAST(n.not_numero_IN AS varchar(20)) LIKE @termo)
    ORDER BY n.not_dataemissao_DT DESC`,
  recebimento: `
    SELECT TOP (@limite) CONCAT(n.emp_empresa_IN,'/',n.not_numerointerno_IN) codigo, n.not_dataentrada_DT data,
      CONCAT('NF ',n.not_numero_IN) entidade, CAST(ISNULL(SUM(i.ite_quantidade_FL*i.ite_preco_NM),0) AS decimal(18,2)) valor,
      COUNT(i.ite_sequencia_IN) itens, CASE WHEN n.not_confirmada_BT=1 THEN 'Confirmada' ELSE 'Pendente de confirmação' END situacao
    FROM notafiscalentrada_T n LEFT JOIN itensnotafiscalentrada_T i ON i.emp_empresa_IN=n.emp_empresa_IN AND i.not_numerointerno_IN=n.not_numerointerno_IN
    WHERE (@busca='' OR CAST(n.not_numero_IN AS varchar(20)) LIKE @termo)
    GROUP BY n.emp_empresa_IN,n.not_numerointerno_IN,n.not_numero_IN,n.not_dataentrada_DT,n.not_confirmada_BT
    ORDER BY n.not_dataentrada_DT DESC`,
  receber: `
    SELECT TOP (@limite) CONCAT(c.ctr_empresa_IN,'/',c.ctr_receber_IN,'-',c.ctr_parcela_IN) codigo,
      c.ctr_datavencimento_DT data, cli.cli_nomerazao entidade, CAST(c.ctr_valor_MN AS decimal(18,2)) valor,
      CASE WHEN ISNULL(c.ctr_excluido_BT,0)=1 THEN 'Excluído' WHEN ISNULL(c.ctr_baixa_IN,0)<>0 THEN 'Com baixa vinculada' WHEN ISNULL(c.ctr_baixaprovisoria_BT,0)=1 THEN 'Baixa provisória' WHEN ISNULL(c.ctr_renegociado_BT,0)=1 THEN 'Renegociado' WHEN ISNULL(c.ctr_emprocessojuridico_BT,0)=1 THEN 'Processo jurídico' ELSE 'Sem baixa vinculada' END situacao
    FROM contasareceber_T c LEFT JOIN cliente cli ON cli.cli_codigo=c.ctr_cliente_IN
    WHERE (@busca='' OR cli.cli_nomerazao LIKE @termo OR c.ctr_numerodocumento_VC LIKE @termo)
    ORDER BY c.ctr_datavencimento_DT DESC`,
  pagar: `
    SELECT TOP (@limite) CONCAT(c.emp_empresa_IN,'/',c.doc_pagamento_IN,'-',c.par_parcela_IN) codigo,
      c.par_datavencimento_DT data, f.for_razao entidade, CAST(c.par_valor_MN AS decimal(18,2)) valor,
      CASE WHEN c.par_databaixa_DT IS NOT NULL THEN 'Data de baixa registrada' ELSE 'Sem data de baixa · conferir conciliação' END situacao
    FROM contasapagar_T c LEFT JOIN fornecedor f ON f.for_codigo=c.for_fornecedor_IN
    WHERE (@busca='' OR f.for_razao LIKE @termo OR c.par_numerodocumento_VC LIKE @termo)
    ORDER BY c.par_datavencimento_DT DESC`,
  expedicao: `
    SELECT TOP (@limite) CONCAT(p.emp_empresa_IN,'/',p.ped_pedido_IN,p.ped_serie_CH) codigo,
      p.ped_dataprevistaentrega_DT data, c.cli_nomerazao entidade,
      CAST(SUM(i.ite_quantidade_NM-i.ite_separado_NM) AS decimal(18,2)) pendente,
      COUNT(i.ite_sequencia_IN) itens, p.sit_situacao_IN situacao
    FROM pedido_T p JOIN itenspedido_T i ON i.emp_empresa_IN=p.emp_empresa_IN AND i.ped_pedido_IN=p.ped_pedido_IN AND i.ped_serie_CH=p.ped_serie_CH
    LEFT JOIN cliente c ON c.cli_codigo=p.cli_cliente_IN
    WHERE p.ped_dataexclusao_DT IS NULL AND ISNULL(i.ite_separado_NM,0)<i.ite_quantidade_NM
      AND (@busca='' OR c.cli_nomerazao LIKE @termo OR CAST(p.ped_pedido_IN AS varchar(20)) LIKE @termo)
    GROUP BY p.emp_empresa_IN,p.ped_pedido_IN,p.ped_serie_CH,p.ped_dataprevistaentrega_DT,c.cli_nomerazao,p.sit_situacao_IN
    ORDER BY p.ped_dataprevistaentrega_DT`
};
