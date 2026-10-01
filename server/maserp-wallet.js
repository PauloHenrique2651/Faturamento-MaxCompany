import { getMaserpPool } from './maserp-report.js';
export async function readMaserpWallet() {
  try {
    const pool = await getMaserpPool();
    const result = await pool.request().query(`
      SELECT c.ctr_empresa_IN companyCode,c.ctr_receber_IN titleNumber,c.ctr_parcela_IN installment,
        c.ctr_notafiscal_IN invoiceNumber,n.not_serie_VC invoiceSeries,n.not_chavenotafiscaleletronica_VC accessKey,
        CONVERT(varchar(10),n.not_dataemissao_DT,23) issuedOn,
        CONVERT(varchar(10),COALESCE(c.ctr_datareprogramada_DT,c.ctr_datavencimento_DT),23) dueOn,
        CONVERT(varchar(10),c.ctr_datavencimento_DT,23) originalDueOn,
        c.ctr_cliente_IN customerCode,cli.cli_nomerazao customer,
        nt.not_descricaocondicaopagamento_VC paymentTerms,
        CONVERT(decimal(18,2),c.ctr_valor_MN-ISNULL(c.ctr_abatimento_MN,0)) amount,
        ISNULL(c.ctr_abatimento_MN,0) abatement,
        CASE WHEN ISNULL(c.ctr_antecipado_BT,0)=1
          OR (ISNULL(c.ctr_boletodescontado_BT,0)=1 AND ISNULL(c.ctr_boletodescontadocancelado_BT,0)=0)
          OR (ISNULL(c.ctr_notafiscaldescontada_BT,0)=1 AND ISNULL(c.ctr_notafiscaldescontadacancelada_BT,0)=0)
          THEN 1 ELSE 0 END anticipated
      FROM contasareceber_T c
      JOIN notafiscalsaida_V n ON n.emp_empresa_IN=c.ctr_empresa_IN AND n.not_numero_IN=c.ctr_notafiscal_IN
      JOIN notafiscalsaida_T nt ON nt.emp_empresa_IN=n.emp_empresa_IN AND nt.not_numero_IN=n.not_numero_IN
      JOIN cliente cli ON cli.cli_codigo=c.ctr_cliente_IN
      WHERE c.ctr_empresa_IN IN (1,3,5,6)
        AND c.ctr_databaixa_DT IS NULL AND c.ctr_datapagamento_DT IS NULL AND c.ctr_baixa_IN IS NULL
        AND c.ctr_dataexclusao_DT IS NULL AND ISNULL(c.ctr_excluido_BT,0)=0
        AND ISNULL(c.ctr_excluidanadevolucao_BT,0)=0 AND ISNULL(c.ctr_fechadopelarenegociacao_BT,0)=0
        AND ISNULL(c.ctr_baixaprovisoria_BT,0)=0 AND ISNULL(c.ctr_emprocessojuridico_BT,0)=0
        AND ISNULL(n.not_cancelada_BT,0)=0 AND ISNULL(n.not_denegada_BT,0)=0
        AND ISNULL(n.not_complementar_BT,0)=0 AND ISNULL(n.ehnotadesaidanormal,0)=1 AND ISNULL(n.cfo_venda_BT,0)=1;
      SELECT n.emp_empresa_IN companyCode,n.not_numero_IN invoiceNumber,n.not_serie_VC invoiceSeries,
        n.not_chavenotafiscaleletronica_VC accessKey,n.cli_nomerazao customer,
        CONVERT(varchar(10),n.not_dataemissao_DT,23) issuedOn
      FROM notafiscalsaida_V n
      WHERE n.emp_empresa_IN IN (1,3,5,6) AND n.not_dataemissao_DT>=DATEADD(day,-7,CAST(GETDATE() AS date))
        AND ISNULL(n.not_cancelada_BT,0)=0 AND ISNULL(n.not_denegada_BT,0)=0
        AND ISNULL(n.ehnotadesaidanormal,0)=1 AND ISNULL(n.cfo_venda_BT,0)=1
        AND NOT EXISTS (SELECT 1 FROM contasareceber_T c WHERE c.ctr_empresa_IN=n.emp_empresa_IN AND c.ctr_notafiscal_IN=n.not_numero_IN);
    `);
    const rows = result.recordsets[0].map((r) => ({
      ...r,
      id: `${r.companyCode}/${r.titleNumber}/${r.installment}`,
      amount: Number(r.amount),
      anticipated: Boolean(r.anticipated),
      source: 'MASERP'
    }));
    if (new Set(rows.map((r) => r.id)).size !== rows.length)
      throw new Error('Carteira com títulos duplicados.');
    return {
      available: true,
      checkedAt: new Date().toISOString(),
      rows,
      awaitingInstallments: result.recordsets[1]
    };
  } catch (error) {
    return { available: false, reason: String(error.message) };
  }
}
