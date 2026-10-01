import { getMaserpPool } from './maserp-report.js';

export async function readMaserpPayables() {
  try {
    const pool = await getMaserpPool();
    const result = await pool.request().query(`
      SELECT c.emp_empresa_IN companyCode,c.doc_pagamento_IN titleNumber,c.par_parcela_IN installment,
        c.for_fornecedor_IN supplierCode,f.for_razao supplier,f.for_cnpj supplierTaxId,c.par_numerodocumento_VC documentNumber,
        CONVERT(varchar(10),c.doc_datalancamento_DT,23) issuedOn,
        CONVERT(varchar(10),COALESCE(c.par_datareprogramada_DT,c.par_datavencimento_DT),23) dueOn,
        CONVERT(varchar(10),c.par_datavencimento_DT,23) originalDueOn,
        CONVERT(decimal(18,2),c.par_valor_MN-ISNULL(c.par_desconto_MN,0)+ISNULL(c.par_juros_MN,0)+ISNULL(c.par_mora_MN,0)) amount,
        ISNULL(c.par_desconto_MN,0) discount,ISNULL(c.par_juros_MN,0)+ISNULL(c.par_mora_MN,0) charges,
        ISNULL(c.par_bloqueado_BT,0) blocked,ISNULL(c.par_bloqueadopeladevolucao_BT,0) returnBlocked,
        c.par_chave_xml_notafiscalentradaxml_VC accessKey,
        (SELECT DISTINCT n.not_numero_IN invoiceNumber,n.not_serie_IN invoiceSeries,n.not_chavenotafiscaleletronica_VC accessKey,
            CONVERT(varchar(10),n.not_dataemissao_DT,23) issuedOn,
            part.nfp_nome_VC supplier,part.nfp_cnpj_VC supplierTaxId,part.nfp_fornecedor_IN supplierCode
          FROM notafiscalentradadocumentosapagar_T l JOIN notafiscalentrada_T n
          ON n.emp_empresa_IN=l.emp_empresa_IN AND n.not_numerointerno_IN=l.not_numerointerno_IN
          LEFT JOIN notafiscalparticipantes_T part ON part.nfp_codigo_IN=n.not_codigodadoparticipante_IN
          WHERE l.emp_empresa_IN=c.emp_empresa_IN AND l.doc_pagamento_IN=c.doc_pagamento_IN
            AND ISNULL(n.not_excluido_BT,0)=0
          FOR JSON PATH) invoices
      FROM contasapagar_T c LEFT JOIN fornecedor f ON f.for_codigo=c.for_fornecedor_IN
      WHERE c.emp_empresa_IN IN (1,3,5,6)
        AND c.par_datapagamento_DT IS NULL AND c.par_databaixa_DT IS NULL
        AND ISNULL(c.par_excluido_BT,0)=0 AND ISNULL(c.par_fechadopelarenegociacao_BT,0)=0
        AND ISNULL(c.par_excluidonadevolucao_BT,0)=0 AND ISNULL(c.par_excluidopelaRJ_BT,0)=0
        AND ISNULL(c.par_previsaofixa_BT,0)=0 AND ISNULL(c.par_previsaovariavelobrigatoria_BT,0)=0
        AND ISNULL(c.par_previsaovariavelnaoobrigatoria_BT,0)=0;
    `);
    const rows = result.recordset.map((r) => ({
      ...r,
      id: `${r.companyCode}/${r.titleNumber}/${r.installment}`,
      amount: Number(r.amount),
      discount: Number(r.discount),
      charges: Number(r.charges),
      blocked: Boolean(r.blocked || r.returnBlocked),
      invoices: JSON.parse(r.invoices || '[]'),
      source: 'MASERP'
    }));
    if (new Set(rows.map((r) => r.id)).size !== rows.length)
      throw new Error('Contas a pagar com títulos duplicados.');
    if (rows.some((r) => !Number.isFinite(r.amount))) throw new Error('Valor de parcela inválido.');
    return { available: true, checkedAt: new Date().toISOString(), rows };
  } catch (error) {
    return { available: false, reason: String(error.message) };
  }
}
