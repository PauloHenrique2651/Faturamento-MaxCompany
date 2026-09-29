import sql from 'mssql';
import { readFileSync } from 'node:fs';

const defaultConfigPath = '\\\\maxcompany\\DEPLOY\\Falco Atualizador-Deploy\\CONFIG.CFG';
const companyCodes = [1, 3, 5, 6];
let poolPromise;

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
      SELECT n.emp_empresa_IN company_code,
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
      GROUP BY n.emp_empresa_IN

      ;WITH commercial_lines AS (
        SELECT p.emp_empresa_IN company_code,
          p.ped_pedido_IN order_number,
          p.ped_serie_CH order_series,
          CONVERT(decimal(18,2), ISNULL(i.ite_quantidade_NM,0) * ISNULL(i.ite_preco_MN,0)) sale_value,
          CONVERT(decimal(18,2), ISNULL(i.ite_quantidade_NM,0) * (ISNULL(i.ite_preco_MN,0) - ISNULL(i.ite_lucro_MN,0))) sale_cost,
          ISNULL(i.ite_produtosemgiro_BT,0) without_rotation,
          billed.cost_unit,
          billed.invoice_linked,
          CONVERT(decimal(18,2), ISNULL(i.ite_quantidade_NM,0) * ISNULL(billed.cost_unit,0)) billed_cost
        FROM pedido_T p
        INNER JOIN itenspedido_T i ON i.emp_empresa_IN=p.emp_empresa_IN
          AND i.ped_pedido_IN=p.ped_pedido_IN AND i.ped_serie_CH=p.ped_serie_CH
        INNER JOIN configuracaoentradasaida_T operation ON operation.ces_codigo_IN=p.ped_configuracaoentradasaida_IN
        LEFT JOIN clientejuridica customer ON customer.cli_codigo=p.cli_cliente_IN
        OUTER APPLY (
          SELECT TOP 1 item_invoice.ite_customediobrutoporitem_MN cost_unit,
            CONVERT(bit,1) invoice_linked
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
          ORDER BY invoice.not_dataemissao_DT DESC
        ) billed
        WHERE p.emp_empresa_IN IN (${companyCodes.join(',')})
          AND p.ped_datainclusao_DT >= @startDate AND p.ped_datainclusao_DT < @endExclusive
          AND ISNULL(p.ped_excluido_BT,0)=0
          AND ISNULL(operation.ces_venda_BT,0)=1
          AND NOT EXISTS (
            SELECT 1 FROM empresa_T group_company WHERE group_company.emp_CNPJ_CH=customer.cli_cnpj
          )
      )
      SELECT company_code,
        COUNT_BIG(DISTINCT CONCAT(company_code,'|',order_number,'|',order_series)) order_count,
        SUM(sale_value) sales_value,
        SUM(sale_cost) sales_cost,
        SUM(CASE WHEN without_rotation=0 THEN sale_value ELSE 0 END) sales_with_rotation,
        SUM(CASE WHEN without_rotation=1 THEN sale_value ELSE 0 END) sales_without_rotation,
        SUM(CASE WHEN invoice_linked=1 THEN sale_value ELSE 0 END) billed_value,
        SUM(CASE WHEN invoice_linked=1 AND cost_unit IS NOT NULL THEN sale_value ELSE 0 END) billed_cost_coverage,
        SUM(CASE WHEN invoice_linked=1 AND cost_unit IS NOT NULL THEN billed_cost ELSE 0 END) billed_cost,
        SUM(CASE WHEN invoice_linked=1 AND without_rotation=0 THEN sale_value ELSE 0 END) billed_with_rotation,
        SUM(CASE WHEN invoice_linked=1 AND without_rotation=1 THEN sale_value ELSE 0 END) billed_without_rotation
      FROM commercial_lines
      GROUP BY company_code
    `);
    const profitabilityRequest = pool.request();
    profitabilityRequest.input('empresa_VC', sql.VarChar(sql.MAX), companyCodes.join(','));
    profitabilityRequest.input('cliente_IN', sql.Int, null);
    profitabilityRequest.input('numero_IN', sql.Int, null);
    profitabilityRequest.input('datainicio_DT', sql.DateTime, new Date(`${startDate}T00:00:00`));
    profitabilityRequest.input('datafinal_DT', sql.DateTime, new Date(`${endDate}T23:59:59`));
    profitabilityRequest.input('retirarempresasdogrupo_BT', sql.Bit, true);
    profitabilityRequest.input('produto_IN', sql.Int, null);
    profitabilityRequest.input('NotasFiscais_BT', sql.Bit, true);
    profitabilityRequest.input('CupomFiscal_BT', sql.Bit, false);
    profitabilityRequest.input('NotaFiscalConsumidorEletronica_BT', sql.Bit, false);
    const sellerProfitabilityRequest = pool.request();
    sellerProfitabilityRequest.input('empresa_VC', sql.VarChar(sql.MAX), companyCodes.join(','));
    sellerProfitabilityRequest.input('vendedor_IN', sql.Int, null);
    sellerProfitabilityRequest.input('numero_IN', sql.Int, null);
    sellerProfitabilityRequest.input(
      'datainicio_DT',
      sql.DateTime,
      new Date(`${startDate}T00:00:00`)
    );
    sellerProfitabilityRequest.input('datafinal_DT', sql.DateTime, new Date(`${endDate}T23:59:59`));
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
      new Date(`${startDate}T00:00:00`)
    );
    incomingFreightRequest.input(
      'dataEntradaFinal_DT',
      sql.DateTime,
      new Date(`${endDate}T23:59:59`)
    );
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
    const commercialRows = result.recordsets[1] || [];
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
    return {
      available: true,
      source: 'MASERP · vendas, faturamento, notas emitidas e lucratividade',
      startDate,
      endDate,
      companies: invoiceRows.map((row) => ({
        companyCode: Number(row.company_code),
        count: Number(row.invoice_count),
        gross: Number(row.gross_value || 0),
        returned: Number(row.returned_value || 0)
      })),
      commercial: commercialRows.map((row) => ({
        companyCode: Number(row.company_code),
        orders: Number(row.order_count),
        sales: Number(row.sales_value || 0),
        salesCost: Number(row.sales_cost || 0),
        salesWithRotation: Number(row.sales_with_rotation || 0),
        salesWithoutRotation: Number(row.sales_without_rotation || 0),
        billed: Number(row.billed_value || 0),
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
