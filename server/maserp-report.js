import { maserpCalendarDate } from './maserp-dates.js';
import { orderId } from './order-files.js';
import sql from 'mssql';
import { readFileSync } from 'node:fs';

const defaultConfigPath = '\\\\maxcompany\\DEPLOY\\Falco Atualizador-Deploy\\CONFIG.CFG';
const companyCodes = [1, 3, 5, 6];
let poolPromise;

export async function getMaserpPool() {
  const settings = databaseSettings();
  if (!settings) throw new Error('MASERP não configurado');
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(settings).connect().catch((error) => {
      poolPromise = undefined;
      throw error;
    });
  }
  return poolPromise;
}

// Estado compacto das notas: alterações de devolução/cancelamento são revistas
// mesmo quando o XML original não mudou ou pertence a um período anterior.
export async function readMaserpInvoiceStates(startDate, endDate) {
  try {
    const pool = await getMaserpPool();
    const request = pool.request();
    request.input('start', sql.Date, startDate);
    request.input('end', sql.Date, endDate);
    const result = await request.query(`
      SELECT n.emp_empresa_IN companyCode, n.not_numero_IN number,
        n.not_serie_VC series, n.not_chavenotafiscaleletronica_VC accessKey,
        CONVERT(varchar(10),n.not_dataemissao_DT,23) date,
        n.not_totalgeral_MN gross, ISNULL(n.not_cancelada_BT,0) canceled,
        n.not_cfop_SI cfop, n.cli_cliente_IN customerCode,
        n.cli_cpfcnpj_VC customerId, n.cli_nomerazao customerName,
        n.not_vendedorinterno_IN sellerCode, v.ven_nome sellerName,
        n.ped_pedido_IN orderNumber,n.ped_serie_CH orderSeries,
        CASE WHEN ISNULL(n.ehnotadesaidanormal,0)=1 AND ISNULL(n.cfo_venda_BT,0)=1
          AND ISNULL(n.not_complementar_BT,0)=0 AND ISNULL(n.not_denegada_BT,0)=0
          THEN 1 ELSE 0 END normalSale,
        ISNULL(r.returnedValue,0) returnedValue
      FROM notafiscalsaida_V n
      LEFT JOIN vendedor v ON v.ven_codigo=n.not_vendedorinterno_IN
      OUTER APPLY (
        SELECT SUM(CONVERT(decimal(18,2),ISNULL(i.ite_quantidadedevolvida_NM,0)*ISNULL(i.ite_preco_MN,0))) returnedValue
        FROM itensnotafiscalsaida_T i WHERE i.emp_empresa_IN=n.emp_empresa_IN AND i.not_numero_IN=n.not_numero_IN
      ) r
      WHERE n.emp_empresa_IN IN (${companyCodes.join(',')})
        AND n.not_dataemissao_DT>=@start AND n.not_dataemissao_DT<DATEADD(day,1,@end)
        AND LEN(n.not_chavenotafiscaleletronica_VC)=44;
      SELECT i.emp_empresa_IN companyCode,i.not_numero_IN number,i.ite_sequencia_IN sequence,
        i.ite_quantidadedevolvida_NM returnedQuantity,
        CONVERT(decimal(18,2),ISNULL(i.ite_quantidadedevolvida_NM,0)*ISNULL(i.ite_preco_MN,0)) returnedValue
      FROM itensnotafiscalsaida_T i JOIN notafiscalsaida_T n ON n.emp_empresa_IN=i.emp_empresa_IN AND n.not_numero_IN=i.not_numero_IN
      WHERE n.emp_empresa_IN IN (${companyCodes.join(',')}) AND n.not_dataemissao_DT>=@start
        AND n.not_dataemissao_DT<DATEADD(day,1,@end) AND ISNULL(i.ite_quantidadedevolvida_NM,0)>0;
    `);
    const items = new Map();
    for (const row of result.recordsets[1] || []) {
      const key = `${row.companyCode}/${row.number}`;
      const list = items.get(key) || [];
      list.push(row);
      items.set(key, list);
    }
    return {
      available: true,
      documents: (result.recordsets[0] || []).map((row) => ({
        ...row,
        accessKey: String(row.accessKey).trim(),
        sellerName: String(row.sellerName || '').trim(),
        normalSale: Boolean(row.normalSale),
        canceled: Boolean(row.canceled),
        returnedItems: items.get(`${row.companyCode}/${row.number}`) || []
      }))
    };
  } catch {
    return { available: false, documents: [] };
  }
}

// Identidade por nota e item lançado no ERP; códigos do fornecedor não são
// confundidos com o código interno, nem sugestões de importação são aprovadas.
export async function readMaserpProductReferences(startDate, endDate) {
  try {
    const pool = await getMaserpPool();
    const request = pool.request();
    request.input('start', sql.Date, startDate);
    request.input('end', sql.Date, endDate);
    const result = await request.query(`
      SELECT n.emp_empresa_IN companyCode,n.not_chavenotafiscaleletronica_VC accessKey,
        'outgoing' direction,i.ite_sequencia_IN sequence,i.pro_produto_IN productId,
        i.ite_unidade_CH unit,i.ite_quantidade_NM quantity,i.ite_preco_MN price,
        i.ite_ncm_CH ncm
      FROM notafiscalsaida_T n JOIN itensnotafiscalsaida_T i
        ON i.emp_empresa_IN=n.emp_empresa_IN AND i.not_numero_IN=n.not_numero_IN
      WHERE n.emp_empresa_IN IN (${companyCodes.join(',')}) AND n.not_dataemissao_DT>=@start
        AND n.not_dataemissao_DT<DATEADD(day,1,@end) AND LEN(n.not_chavenotafiscaleletronica_VC)=44
      UNION ALL
      SELECT n.emp_empresa_IN,n.not_chavenotafiscaleletronica_VC,'incoming',
        i.ite_sequencia_IN,i.ite_produto_IN,i.ite_unidade_CH,i.ite_quantidade_FL,i.ite_preco_NM,i.ite_cf_CH
      FROM notafiscalentrada_T n JOIN itensnotafiscalentrada_T i
        ON i.emp_empresa_IN=n.emp_empresa_IN AND i.not_numerointerno_IN=n.not_numerointerno_IN
      WHERE n.emp_empresa_IN IN (${companyCodes.join(',')}) AND n.not_dataemissao_DT>=@start
        AND n.not_dataemissao_DT<DATEADD(day,1,@end) AND LEN(n.not_chavenotafiscaleletronica_VC)=44
        AND ISNULL(n.not_excluido_BT,0)=0 AND ISNULL(n.not_confirmada_BT,0)=1;
      SELECT pf.pro_produto_IN productId, f.for_cnpj supplierId,
        COALESCE(NULLIF(LTRIM(RTRIM(pf.pro_codigonf_VC)),''),NULLIF(LTRIM(RTRIM(pf.pro_codigo_VC)),'')) supplierCode,
        p.pro_unidade unit,p.pro_cf_CH ncm
      FROM produtofornecedor_T pf JOIN fornecedor f ON f.for_codigo=pf.for_fornecedor_IN
        JOIN produto p ON p.pro_codigo=pf.pro_produto_IN
      WHERE NULLIF(LTRIM(RTRIM(pf.pro_codigo_VC)),'') IS NOT NULL
        OR NULLIF(LTRIM(RTRIM(pf.pro_codigonf_VC)),'') IS NOT NULL;
    `);
    return { available: true, items: result.recordsets[0], catalog: result.recordsets[1] };
  } catch {
    return { available: false, items: [] };
  }
}

function databaseSettings() {
  let saved = {};
  try {
    const text = readFileSync(process.env.MASERP_CONFIG_PATH || defaultConfigPath, 'utf8').replace(
      /^\uFEFF/,
      ''
    );
    const setting = text.split(/\r?\n/).find((line) => /^\s*SQL_SERVER\s*=/i.test(line));
    const fields = setting
      ?.split('=', 2)[1]
      ?.split(';')
      .map((field) => field.trim());
    if (fields?.length >= 4) [saved.server, saved.database, saved.user, saved.password] = fields;
  } catch {
    // Environment variables can configure MASERP without a local Falco config file.
  }
  const server = process.env.MASERP_SQL_SERVER || saved.server;
  const user = process.env.MASERP_SQL_USER || saved.user;
  const password = process.env.MASERP_SQL_PASSWORD || saved.password;
  if (!server || !user || !password) return null;
  return {
    server,
    database: process.env.MASERP_SQL_DATABASE || saved.database || 'MASERP',
    user,
    password,
    port: Number(process.env.MASERP_SQL_PORT || 1433),
    connectionTimeout: 8000,
    requestTimeout: 30000,
    pool: { min: 0, max: 3, idleTimeoutMillis: 10000 },
    options: {
      encrypt: String(process.env.MASERP_SQL_ENCRYPT || 'false').toLowerCase() === 'true',
      trustServerCertificate:
        String(process.env.MASERP_SQL_TRUST_CERT || 'true').toLowerCase() === 'true',
      appName: 'CRM MASERP leitura',
      useUTC: true,
      readOnlyIntent: true,
      enableArithAbort: true
    }
  };
}

export async function readMaserpSalesSnapshot(startDate, endDate) {
  const settings = databaseSettings();
  if (!settings) return { available: false, reason: 'configuracao_ausente' };
  let pool;
  try {
    if (!poolPromise) {
      poolPromise = new sql.ConnectionPool(settings).connect().catch((error) => {
        poolPromise = undefined;
        throw error;
      });
    }
    pool = await poolPromise;
    const request = pool.request();
    request.input('startDate', sql.Date, startDate);
    const exclusive = new Date(`${endDate}T00:00:00Z`);
    exclusive.setUTCDate(exclusive.getUTCDate() + 1);
    request.input('endExclusive', sql.Date, exclusive.toISOString().slice(0, 10));
    const result = await request.query(`
      WITH returned AS (
        SELECT emp_empresa_IN, not_numero_IN,
          SUM(CONVERT(decimal(18,2), ISNULL(ite_quantidadedevolvida_NM,0) * ISNULL(ite_preco_MN,0))) returned_value
        FROM itensnotafiscalsaida_T
        GROUP BY emp_empresa_IN, not_numero_IN
      )
      SELECT n.emp_empresa_IN company_code, CONVERT(varchar(10),n.not_dataemissao_DT,23) date,
        COUNT_BIG(*) invoice_count,
        SUM(CONVERT(decimal(18,2), ISNULL(n.not_totalgeral_MN,0))) gross_value,
        SUM(CONVERT(decimal(18,2), ISNULL(r.returned_value,0))) returned_value
      FROM notafiscalsaida_V n
      LEFT JOIN returned r ON r.emp_empresa_IN=n.emp_empresa_IN AND r.not_numero_IN=n.not_numero_IN
      WHERE n.emp_empresa_IN IN (${companyCodes.join(',')})
        AND n.not_dataemissao_DT >= @startDate AND n.not_dataemissao_DT < @endExclusive
        AND ISNULL(n.ehnotadesaidanormal,0)=1
        AND ISNULL(n.cfo_venda_BT,0)=1
        AND ISNULL(n.not_cancelada_BT,0)=0
        AND ISNULL(n.not_complementar_BT,0)=0
        AND ISNULL(n.not_denegada_BT,0)=0
      GROUP BY n.emp_empresa_IN, CONVERT(varchar(10),n.not_dataemissao_DT,23)

      ;WITH commercial_lines AS (
        SELECT p.emp_empresa_IN company_code,
          p.ped_pedido_IN order_number,
          p.ped_serie_CH order_series,
          CONVERT(varchar(10),p.ped_datainclusao_DT,23) created_on,
          p.cli_cliente_IN customer_code, customer_name.cli_nomerazao customer_name,
          seller.ven_nome seller_name,
          CONVERT(decimal(18,2), (ISNULL(i.ite_quantidade_NM,0)-ISNULL(i.ite_quantidadecancelada_NM,0)) * ISNULL(i.ite_preco_MN,0)) sale_value,
          CONVERT(decimal(18,2), (ISNULL(i.ite_quantidade_NM,0)-ISNULL(i.ite_quantidadecancelada_NM,0)) * (ISNULL(i.ite_preco_MN,0) - ISNULL(i.ite_lucro_MN,0))) sale_cost,
          ISNULL(i.ite_produtosemgiro_BT,0) without_rotation,
          billed.cost_unit,
          billed.invoice_linked,
          CASE WHEN ISNULL(billed.quantity,0)>ISNULL(i.ite_quantidade_NM,0)-ISNULL(i.ite_quantidadecancelada_NM,0)
            THEN ISNULL(i.ite_quantidade_NM,0)-ISNULL(i.ite_quantidadecancelada_NM,0)
            ELSE ISNULL(billed.quantity,0) END billed_quantity,
          ISNULL(i.ite_quantidade_NM,0)-ISNULL(i.ite_quantidadecancelada_NM,0) active_quantity,
          ISNULL(i.ite_preco_MN,0) unit_price,
          CONVERT(decimal(18,2), ISNULL(i.ite_quantidade_NM,0) * ISNULL(billed.cost_unit,0)) billed_cost
        FROM pedido_T p
        INNER JOIN itenspedido_T i ON i.emp_empresa_IN=p.emp_empresa_IN
          AND i.ped_pedido_IN=p.ped_pedido_IN AND i.ped_serie_CH=p.ped_serie_CH
        INNER JOIN configuracaoentradasaida_T operation ON operation.ces_codigo_IN=p.ped_configuracaoentradasaida_IN
        LEFT JOIN clientejuridica customer ON customer.cli_codigo=p.cli_cliente_IN
        LEFT JOIN cliente customer_name ON customer_name.cli_codigo=p.cli_cliente_IN
        LEFT JOIN vendedor seller ON seller.ven_codigo=p.ven_vendedor_SI
        OUTER APPLY (
          SELECT MAX(item_invoice.ite_customediobrutoporitem_MN) cost_unit,
            CONVERT(bit,CASE WHEN COUNT(*)>0 THEN 1 ELSE 0 END) invoice_linked,
            SUM(link.inp_quantidadeitempedido_NM) quantity
          FROM itensnotafiscalsaida_T_itenspedidovenda_T link
          INNER JOIN notafiscalsaida_T invoice ON invoice.emp_empresa_IN=link.inp_empresanotafiscal_IN
            AND invoice.not_numero_IN=link.inp_notafiscalsaida_IN
          INNER JOIN itensnotafiscalsaida_T item_invoice ON item_invoice.emp_empresa_IN=link.inp_empresanotafiscal_IN
            AND item_invoice.not_numero_IN=link.inp_notafiscalsaida_IN
            AND item_invoice.ite_sequencia_IN=link.inp_sequencianotafiscalsaida_IN
          WHERE link.inp_empresapedido_IN=p.emp_empresa_IN
            AND link.inp_pedido_IN=p.ped_pedido_IN
            AND link.inp_seriepedido_CH=p.ped_serie_CH
            AND link.inp_sequenciapedido_IN=i.ite_sequencia_IN
            AND invoice.emp_empresa_IN=p.emp_empresa_IN
            AND ISNULL(invoice.not_cancelada_BT,0)=0
            AND ISNULL(invoice.not_complementar_BT,0)=0
            AND ISNULL(invoice.not_denegada_BT,0)=0
            AND invoice.not_dataemissao_DT<@endExclusive
        ) billed
        WHERE p.emp_empresa_IN IN (${companyCodes.join(',')})
          AND p.ped_datainclusao_DT >= @startDate AND p.ped_datainclusao_DT < @endExclusive
          AND ISNULL(p.ped_excluido_BT,0)=0
          AND ISNULL(i.ite_cancelado_BT,0)=0
          AND ISNULL(operation.ces_venda_BT,0)=1
          AND NOT EXISTS (
            SELECT 1 FROM empresa_T group_company WHERE group_company.emp_CNPJ_CH=customer.cli_cnpj
          )
      )
      SELECT company_code, order_number, order_series, created_on, customer_code, customer_name, seller_name,
        COUNT_BIG(DISTINCT CONCAT(company_code,'|',order_number,'|',order_series)) order_count,
        SUM(sale_value) sales_value,
        SUM(sale_cost) sales_cost,
        SUM(CASE WHEN without_rotation=0 THEN sale_value ELSE 0 END) sales_with_rotation,
        SUM(CASE WHEN without_rotation=1 THEN sale_value ELSE 0 END) sales_without_rotation,
        SUM(CONVERT(decimal(18,2),billed_quantity*unit_price)) billed_value,
        SUM(CASE WHEN invoice_linked=1 AND cost_unit IS NOT NULL THEN CONVERT(decimal(18,2),billed_quantity*unit_price) ELSE 0 END) billed_cost_coverage,
        SUM(CASE WHEN invoice_linked=1 AND cost_unit IS NOT NULL THEN CONVERT(decimal(18,2),billed_quantity*cost_unit) ELSE 0 END) billed_cost,
        SUM(CASE WHEN invoice_linked=1 AND without_rotation=0 THEN CONVERT(decimal(18,2),billed_quantity*unit_price) ELSE 0 END) billed_with_rotation,
        SUM(CASE WHEN invoice_linked=1 AND without_rotation=1 THEN CONVERT(decimal(18,2),billed_quantity*unit_price) ELSE 0 END) billed_without_rotation
        ,SUM(CONVERT(decimal(18,2),CASE WHEN active_quantity>billed_quantity THEN (active_quantity-billed_quantity)*unit_price ELSE 0 END)) pending_value
        ,COUNT(DISTINCT CASE WHEN active_quantity>billed_quantity THEN CONCAT(company_code,'|',order_number,'|',order_series) END) pending_orders
      FROM commercial_lines
      GROUP BY company_code, order_number, order_series, created_on, customer_code, customer_name, seller_name

      SELECT DISTINCT p.emp_empresa_IN company_code,p.ped_pedido_IN order_number,p.ped_serie_CH order_series,
        n.not_numero_IN number,n.not_serie_VC series,n.not_chavenotafiscaleletronica_VC access_key,
        CONVERT(varchar(10),n.not_dataemissao_DT,23) issued_on
      FROM pedido_T p
      JOIN itensnotafiscalsaida_T_itenspedidovenda_T l ON l.inp_empresapedido_IN=p.emp_empresa_IN AND l.inp_pedido_IN=p.ped_pedido_IN AND l.inp_seriepedido_CH=p.ped_serie_CH
      JOIN notafiscalsaida_T n ON n.emp_empresa_IN=l.inp_empresanotafiscal_IN AND n.not_numero_IN=l.inp_notafiscalsaida_IN
      WHERE p.ped_datainclusao_DT>=@startDate AND p.ped_datainclusao_DT<@endExclusive
        AND n.emp_empresa_IN=p.emp_empresa_IN AND n.not_dataemissao_DT<@endExclusive AND ISNULL(n.not_cancelada_BT,0)=0
        AND ISNULL(n.not_denegada_BT,0)=0 AND ISNULL(n.not_complementar_BT,0)=0


      SELECT p.emp_empresa_IN company_code,p.ped_pedido_IN order_number,p.ped_serie_CH order_series,
        i.ite_sequencia_IN sequence,i.pro_produto_IN code,product.pro_descricao name,i.ite_unidade_CH unit,
        ISNULL(i.ite_quantidade_NM,0)-ISNULL(i.ite_quantidadecancelada_NM,0) quantity,
        ISNULL(i.ite_preco_MN,0) unit_price, ISNULL(i.ite_produtosemgiro_BT,0) without_rotation,
        CONVERT(decimal(18,2),(ISNULL(i.ite_quantidade_NM,0)-ISNULL(i.ite_quantidadecancelada_NM,0))*ISNULL(i.ite_preco_MN,0)) value
      FROM pedido_T p JOIN itenspedido_T i ON i.emp_empresa_IN=p.emp_empresa_IN AND i.ped_pedido_IN=p.ped_pedido_IN AND i.ped_serie_CH=p.ped_serie_CH
      LEFT JOIN produto product ON product.pro_codigo=i.pro_produto_IN
      WHERE p.emp_empresa_IN IN (1,3,5,6) AND p.ped_datainclusao_DT>=@startDate AND p.ped_datainclusao_DT<@endExclusive
        AND ISNULL(p.ped_excluido_BT,0)=0 AND ISNULL(i.ite_cancelado_BT,0)=0
      ORDER BY p.emp_empresa_IN,p.ped_pedido_IN,p.ped_serie_CH,i.ite_sequencia_IN
      SELECT p.emp_empresa_IN company_code,p.ped_pedido_IN order_number,p.ped_serie_CH order_series,
        company.emp_razao_VC company_name,company.emp_CNPJ_CH company_cnpj,
        customer.cli_cnpj customer_cnpj,p.ped_descricaocondicaopagamento_VC payment_terms
      FROM pedido_T p JOIN empresa_T company ON company.emp_empresa_IN=p.emp_empresa_IN
      LEFT JOIN clientejuridica customer ON customer.cli_codigo=p.cli_cliente_IN
      WHERE p.emp_empresa_IN IN (1,3,5,6) AND p.ped_datainclusao_DT>=@startDate AND p.ped_datainclusao_DT<@endExclusive

      SELECT p.emp_empresa_IN company_code,p.ped_pedido_IN order_number,p.ped_serie_CH order_series,
        i.ite_sequencia_IN sequence,CONVERT(varchar(10),n.not_dataemissao_DT,23) date,
        SUM(l.inp_quantidadeitempedido_NM) quantity,MAX(ni.ite_customediobrutoporitem_MN) cost
      FROM pedido_T p JOIN itenspedido_T i ON i.emp_empresa_IN=p.emp_empresa_IN AND i.ped_pedido_IN=p.ped_pedido_IN AND i.ped_serie_CH=p.ped_serie_CH
      JOIN itensnotafiscalsaida_T_itenspedidovenda_T l ON l.inp_empresapedido_IN=p.emp_empresa_IN AND l.inp_pedido_IN=p.ped_pedido_IN AND l.inp_seriepedido_CH=p.ped_serie_CH AND l.inp_sequenciapedido_IN=i.ite_sequencia_IN
      JOIN notafiscalsaida_T n ON n.emp_empresa_IN=l.inp_empresanotafiscal_IN AND n.not_numero_IN=l.inp_notafiscalsaida_IN
      JOIN itensnotafiscalsaida_T ni ON ni.emp_empresa_IN=n.emp_empresa_IN AND ni.not_numero_IN=n.not_numero_IN AND ni.ite_sequencia_IN=l.inp_sequencianotafiscalsaida_IN
      WHERE p.emp_empresa_IN IN (1,3,5,6) AND p.ped_datainclusao_DT>=@startDate AND p.ped_datainclusao_DT<@endExclusive
        AND n.emp_empresa_IN=p.emp_empresa_IN AND n.not_dataemissao_DT<@endExclusive
        AND ISNULL(n.not_cancelada_BT,0)=0 AND ISNULL(n.not_denegada_BT,0)=0 AND ISNULL(n.not_complementar_BT,0)=0
        AND ISNULL(p.ped_excluido_BT,0)=0 AND ISNULL(i.ite_cancelado_BT,0)=0
      GROUP BY p.emp_empresa_IN,p.ped_pedido_IN,p.ped_serie_CH,i.ite_sequencia_IN,CONVERT(varchar(10),n.not_dataemissao_DT,23)
    `);
    const profitabilityRequest = pool.request();
    profitabilityRequest.input('empresa_VC', sql.VarChar(sql.MAX), companyCodes.join(','));
    profitabilityRequest.input('cliente_IN', sql.Int, null);
    profitabilityRequest.input('numero_IN', sql.Int, null);
    profitabilityRequest.input('datainicio_DT', sql.DateTime, maserpCalendarDate(startDate));
    profitabilityRequest.input('datafinal_DT', sql.DateTime, maserpCalendarDate(endDate));
    profitabilityRequest.input('retirarempresasdogrupo_BT', sql.Bit, true);
    profitabilityRequest.input('produto_IN', sql.Int, null);
    profitabilityRequest.input('NotasFiscais_BT', sql.Bit, true);
    profitabilityRequest.input('CupomFiscal_BT', sql.Bit, false);
    profitabilityRequest.input('NotaFiscalConsumidorEletronica_BT', sql.Bit, false);
    const sellerProfitabilityRequest = pool.request();
    sellerProfitabilityRequest.input('empresa_VC', sql.VarChar(sql.MAX), companyCodes.join(','));
    sellerProfitabilityRequest.input('vendedor_IN', sql.Int, null);
    sellerProfitabilityRequest.input('numero_IN', sql.Int, null);
    sellerProfitabilityRequest.input('datainicio_DT', sql.DateTime, maserpCalendarDate(startDate));
    sellerProfitabilityRequest.input('datafinal_DT', sql.DateTime, maserpCalendarDate(endDate));
    sellerProfitabilityRequest.input('retirarempresasdogrupo_BT', sql.Bit, true);
    sellerProfitabilityRequest.input('NotasFiscais_BT', sql.Bit, true);
    sellerProfitabilityRequest.input('CupomFiscal_BT', sql.Bit, false);
    sellerProfitabilityRequest.input('NotaFiscalConsumidorEletronica_BT', sql.Bit, false);
    sellerProfitabilityRequest.input('VendedorInterno_BT', sql.Bit, true);
    sellerProfitabilityRequest.input('VendedorExterno_BT', sql.Bit, true);
    const incomingFreightRequest = pool.request();
    incomingFreightRequest.input('empresas_VC', sql.VarChar(50), companyCodes.join(','));
    incomingFreightRequest.input('fornecedor_IN', sql.Int, null);
    incomingFreightRequest.input('cliente_IN', sql.Int, null);
    incomingFreightRequest.input('transportadora_IN', sql.Int, null);
    incomingFreightRequest.input('dataEmissaoInicial_DT', sql.DateTime, null);
    incomingFreightRequest.input('dataEmissaoFinal_DT', sql.DateTime, null);
    incomingFreightRequest.input(
      'dataEntradaInicial_DT',
      sql.DateTime,
      maserpCalendarDate(startDate)
    );
    incomingFreightRequest.input('dataEntradaFinal_DT', sql.DateTime, maserpCalendarDate(endDate));
    incomingFreightRequest.input('valorInicial_MN', sql.Money, null);
    incomingFreightRequest.input('valorFinal_MN', sql.Money, null);
    incomingFreightRequest.input('finalizadas_BT', sql.Bit, true);
    incomingFreightRequest.input('semFinanceiro_BT', sql.Bit, true);
    incomingFreightRequest.input('TipoConhecimentoFrete_IN', sql.Int, 2);
    const [profitabilityResult, sellerProfitabilityResult, incomingFreightResult] =
      await Promise.all([
        profitabilityRequest.execute('dbo.usp_SelecionarDadosParaRelatorioLucratividade'),
        sellerProfitabilityRequest.execute(
          'dbo.usp_SelecionarDadosParaRelatorioLucratividadePorVendedor'
        ),
        incomingFreightRequest.execute('dbo.usp_SelecionarNotaFiscalEntradaFretePorFiltros')
      ]);
    const invoiceRows = result.recordsets[0] || [];
    const orderRows = result.recordsets[1] || [];
    const byCompany = new Map();
    for (const row of orderRows) {
      const aggregate = byCompany.get(row.company_code) || { company_code: row.company_code };
      for (const key of [
        'order_count',
        'sales_value',
        'sales_cost',
        'sales_with_rotation',
        'sales_without_rotation',
        'billed_value',
        'billed_cost_coverage',
        'billed_cost',
        'billed_with_rotation',
        'billed_without_rotation',
        'pending_value',
        'pending_orders'
      ])
        aggregate[key] = (aggregate[key] || 0) + Number(row[key] || 0);
      byCompany.set(row.company_code, aggregate);
    }
    const commercialRows = [...byCompany.values()];
    const profitabilityInvoices = profitabilityResult.recordsets?.[1] || [];
    const sellerProfitabilityInvoices = sellerProfitabilityResult.recordsets?.[1] || [];
    const profitabilityByCompany = new Map();
    for (const row of profitabilityInvoices) {
      const companyCode = Number(row.emp_empresa_IN);
      const current = profitabilityByCompany.get(companyCode) || {
        companyCode,
        count: 0,
        gross: 0,
        net: 0,
        cost: 0,
        profit: 0,
        returned: 0,
        expenses: 0
      };
      const net = Number(row.not_total_MN || 0);
      const returned = Number(row.not_valordevolvido_MN || 0);
      current.count += 1;
      current.gross += net + returned;
      current.net += net;
      current.cost += Number(row.not_totalcusto_MN || 0);
      current.profit += Number(row.not_lucro_MN || 0);
      current.returned += returned;
      current.expenses += Number(row.not_totaloutrasdespesas_MN || 0);
      profitabilityByCompany.set(companyCode, current);
    }
    const sellerProfitability = new Map();
    for (const row of sellerProfitabilityInvoices) {
      const companyCode = Number(row.emp_empresa_IN);
      const sellerCode = Number(row.ven_codigo || 0);
      const sellerName = String(row.ven_nome || 'Não identificado').trim();
      const key = `${companyCode}|${sellerCode}|${sellerName}`;
      const current = sellerProfitability.get(key) || {
        companyCode,
        sellerCode,
        sellerName,
        internal: Boolean(row.interno_BT),
        count: 0,
        sales: 0,
        cost: 0,
        profit: 0,
        returned: 0,
        expenses: 0
      };
      current.count += 1;
      current.sales += Number(row.not_total_MN || 0);
      current.cost += Number(row.not_totalcusto_MN || 0);
      current.profit += Number(row.not_lucro_MN || 0);
      current.returned += Number(row.not_valordevolvido_MN || 0);
      current.expenses += Number(row.not_totaloutrasdespesas_MN || 0);
      sellerProfitability.set(key, current);
    }
    const dateOf = (v) =>
      v instanceof Date ? v.toISOString().slice(0, 10) : String(v || '').slice(0, 10);
    const index = (rows) => {
      const map = new Map();
      for (const row of rows) {
        const id = orderId(row.company_code, row.order_number, row.order_series);
        if (!map.has(id)) map.set(id, []);
        map.get(id).push(row);
      }
      return map;
    };
    const notesByOrder = index(result.recordsets[2] || []),
      itemsByOrder = index(result.recordsets[3] || []),
      headersByOrder = index(result.recordsets[4] || []),
      billingByOrder = index(result.recordsets[5] || []);
    const forOrder = (map, row) =>
      map.get(orderId(row.company_code, row.order_number, row.order_series)) || [];
    const timelineByOrder = new Map();
    for (const row of orderRows) {
      const items = forOrder(itemsByOrder, row),
        links = forOrder(billingByOrder, row);
      const dates = [...new Set(links.map((l) => l.date))].sort();
      const itemLinks = new Map();
      for (const l of links) {
        if (!itemLinks.has(l.sequence)) itemLinks.set(l.sequence, []);
        itemLinks.get(l.sequence).push(l);
      }
      const timeline = dates.map((date) => {
        const t = {
          date,
          billed: 0,
          billedCostCoverage: 0,
          billedCost: 0,
          billedWithRotation: 0,
          billedWithoutRotation: 0
        };
        for (const i of items) {
          const selected = (itemLinks.get(i.sequence) || []).filter((l) => l.date <= date);
          const quantity = Math.min(
            Number(i.quantity),
            selected.reduce((n, l) => n + Number(l.quantity || 0), 0)
          );
          const costs = selected.filter((l) => l.cost != null).map((l) => Number(l.cost));
          const cost = costs.length ? Math.max(...costs) : null;
          const value = Math.round((quantity * Number(i.unit_price) + Number.EPSILON) * 100) / 100;
          t.billed += value;
          if (selected.length)
            t[i.without_rotation ? 'billedWithoutRotation' : 'billedWithRotation'] += value;
          if (cost != null) {
            t.billedCostCoverage += value;
            t.billedCost += Math.round((quantity * cost + Number.EPSILON) * 100) / 100;
          }
        }
        t.cohortBilled = t.billed;
        t.pending = Number(row.sales_value) - t.billed;
        t.pendingOrders = t.pending > 0.005 ? 1 : 0;
        return t;
      });
      timelineByOrder.set(orderId(row.company_code, row.order_number, row.order_series), timeline);
    }
    const groupFacts = (rows, keys) => {
      const map = new Map();
      for (const r of rows) {
        const key = keys.map((k) => r[k]).join('|');
        const t = map.get(key) || Object.fromEntries(keys.map((k) => [k, r[k]]));
        for (const [k, v] of Object.entries(r))
          if (!keys.includes(k) && typeof v === 'number') t[k] = (t[k] || 0) + v;
        map.set(key, t);
      }
      return [...map.values()];
    };
    const companyFacts = invoiceRows.map((r) => ({
      companyCode: Number(r.company_code),
      date: r.date,
      count: Number(r.invoice_count),
      gross: Number(r.gross_value || 0),
      returned: Number(r.returned_value || 0)
    }));
    const profitFacts = groupFacts(
      profitabilityInvoices.map((r) => ({
        companyCode: Number(r.emp_empresa_IN),
        date: dateOf(r.not_dataemissao_DT),
        count: 1,
        gross: Number(r.not_total_MN || 0) + Number(r.not_valordevolvido_MN || 0),
        net: Number(r.not_total_MN || 0),
        cost: Number(r.not_totalcusto_MN || 0),
        profit: Number(r.not_lucro_MN || 0),
        returned: Number(r.not_valordevolvido_MN || 0),
        expenses: Number(r.not_totaloutrasdespesas_MN || 0)
      })),
      ['companyCode', 'date']
    );
    const sellerFacts = groupFacts(
      sellerProfitabilityInvoices.map((r) => ({
        companyCode: Number(r.emp_empresa_IN),
        date: dateOf(r.not_dataemissao_DT),
        sellerCode: Number(r.ven_codigo || 0),
        sellerName: String(r.ven_nome || 'Não identificado').trim(),
        internal: Boolean(r.interno_BT),
        count: 1,
        sales: Number(r.not_total_MN || 0),
        cost: Number(r.not_totalcusto_MN || 0),
        profit: Number(r.not_lucro_MN || 0),
        returned: Number(r.not_valordevolvido_MN || 0),
        expenses: Number(r.not_totaloutrasdespesas_MN || 0)
      })),
      ['companyCode', 'date', 'sellerCode', 'sellerName', 'internal']
    );
    return {
      available: true,
      source: 'MASERP · vendas, faturamento, notas emitidas e lucratividade',
      checkedAt: new Date().toISOString(),
      startDate,
      endDate,
      orders: orderRows.map((row) => ({
        id: orderId(row.company_code, row.order_number, row.order_series),
        companyCode: Number(row.company_code),
        number: Number(row.order_number),
        series: String(row.order_series).trim(),
        ...(() => {
          const h = forOrder(headersByOrder, row)[0] || {};
          return {
            companyName: String(h.company_name || '').trim(),
            companyCnpj: String(h.company_cnpj || '').trim(),
            customerCnpj: String(h.customer_cnpj || '').trim(),
            paymentTerms: String(h.payment_terms || '').trim()
          };
        })(),
        date: row.created_on,
        customerCode: Number(row.customer_code),
        customer: String(row.customer_name || '').trim(),
        seller: String(row.seller_name || '').trim(),
        total: Number(row.sales_value || 0),
        billed: Number(row.billed_value || 0),
        pending: Number(row.pending_value || 0),
        billingTimeline: timelineByOrder.get(
          orderId(row.company_code, row.order_number, row.order_series)
        ),
        invoices: forOrder(notesByOrder, row).map((n) => ({
          number: n.number,
          series: n.series,
          key: String(n.access_key || '').trim(),
          date: n.issued_on
        })),
        items: forOrder(itemsByOrder, row).map((i) => ({
          sequence: Number(i.sequence),
          code: Number(i.code),
          name: String(i.name || '').trim(),
          unit: String(i.unit || '').trim(),
          quantity: Number(i.quantity),
          unitPrice: Number(i.unit_price),
          value: Number(i.value)
        }))
      })),
      periodFacts: {
        companies: companyFacts,
        profitability: profitFacts,
        sellerProfitability: sellerFacts,
        commercial: orderRows.map((r) => ({
          companyCode: Number(r.company_code),
          date: r.created_on,
          orders: 1,
          sales: Number(r.sales_value || 0),
          salesCost: Number(r.sales_cost || 0),
          salesWithRotation: Number(r.sales_with_rotation || 0),
          salesWithoutRotation: Number(r.sales_without_rotation || 0),
          timeline: timelineByOrder.get(orderId(r.company_code, r.order_number, r.order_series))
        }))
      },
      companies: groupFacts(
        companyFacts.map(({ date, ...r }) => r),
        ['companyCode']
      ),
      commercial: commercialRows.map((row) => ({
        companyCode: Number(row.company_code),
        orders: Number(row.order_count),
        sales: Number(row.sales_value || 0),
        salesCost: Number(row.sales_cost || 0),
        salesWithRotation: Number(row.sales_with_rotation || 0),
        salesWithoutRotation: Number(row.sales_without_rotation || 0),
        billed: Number(row.billed_value || 0),
        cohortBilled: Number(row.billed_value || 0),
        pending: Number(row.pending_value || 0),
        pendingOrders: Number(row.pending_orders || 0),
        billedCostCoverage: Number(row.billed_cost_coverage || 0),
        billedCost: Number(row.billed_cost || 0),
        billedWithRotation: Number(row.billed_with_rotation || 0),
        billedWithoutRotation: Number(row.billed_without_rotation || 0)
      })),
      profitability: [...profitabilityByCompany.values()],
      sellerProfitability: [...sellerProfitability.values()],
      incomingFreights: (incomingFreightResult.recordsets?.[0] || []).map((row) => ({
        companyCode: Number(row.empresa),
        internalNumber: Number(row.numeroInterno),
        documentNumber: String(row.numeroDocumento || ''),
        entryDate: row.dataEntrada,
        issueDate: row.dataEmissao,
        cfop: String(row.CFOP || ''),
        carrierCode: Number(row.transportadora || 0),
        carrier: String(row.razaoTransportadora || 'Não identificada').trim(),
        carrierId: String(row.CnpjTransportadora || '').trim(),
        value: Number(row.valorFrete || 0),
        outgoingKnowledge: Boolean(row.ConhecimentoDeNotaSaida)
      }))
    };
  } catch {
    poolPromise = undefined;
    if (pool) await pool.close().catch(() => {});
    return { available: false, reason: 'consulta_indisponivel' };
  }
}
