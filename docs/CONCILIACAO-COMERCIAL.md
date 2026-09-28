# Conciliação comercial do CRM

O Falco permanece somente leitura. XMLs de saída vêm das pastas de NF-e; entradas vêm da distribuição DF-e da SEFAZ sincronizada pelo coletor. Metas e equivalências são gravadas exclusivamente no Supabase do CRM (`sales_targets` e `product_equivalences`).

O coletor também lê diretamente `NotasFiscaisEntradaImportacaoXML/Identificado` e `NaoIdentificado` em produção, aproveitando os PDFs ao lado dos XMLs. Chave e CNPJ destinatário são validados; a mesma entrada presente na SEFAZ e no Falco conta uma única vez. **Compra identificada** é uma NF-e completa, autorizada, não cancelada e classificada como venda pelo CFOP do fornecedor. Todas as demais naturezas e resumos sem itens permanecem em entradas, fora do valor de compras identificado.

## Indicadores do mostrador

- **Vendas faturadas:** soma de `vNF` das saídas autorizadas, não canceladas e classificadas como venda por CFOP/natureza. Emissão de devolução a fornecedor, retorno de industrialização, remessa, bonificação e transferência não é venda.
- **Devoluções confirmadas:** entradas classificadas como devolução com chave de referência a uma venda autorizada da mesma empresa e do mesmo CNPJ. Devolução sem vínculo fica visível, mas não reduz este indicador.
- **Faturamento líquido documentado:** vendas faturadas menos devoluções confirmadas. Não equivale a receita líquida contábil ou valor recebido.
- **Meta:** valor cadastrado no CRM. No mesmo dia, meta mensal prevalece sobre trimestral, que prevalece sobre anual. O rateio diário usa segunda a sexta-feira; feriados não são abatidos.
- **Ritmo e projeção:** média diária do período e média dos cinco últimos dias úteis; a projeção usa 70% da média recente e 30% da média do período. Só aparece após três dias úteis. É uma estimativa, não compromisso de venda.
- **Ranking:** soma das vendas atribuídas ao vendedor no XML, abatendo devoluções vinculadas à venda original presente no recorte. Notas sem vendedor identificado continuam no total, fora do ranking.

O navegador consulta o banco do CRM a cada minuto no mostrador e a cada 10 segundos nas telas operacionais. O coletor das pastas e a consulta SEFAZ possuem cadências próprias. O horário da última sincronização e o estado fresco/desatualizado vêm da API; não se anuncia atualização instantânea quando a origem está atrasada.

## Entradas × saídas

Uma venda emitida pode corresponder a uma compra recebida, mas a NF-e de compra não indica qual lote do estoque foi efetivamente baixado. Por isso o painel chama o resultado de **diferença parcial entre venda e última compra**, nunca lucro ou margem contábil.

Uma entrada só é candidata a compra quando possui XML completo, está autorizada, não cancelada, é venda do fornecedor pelo CFOP e foi emitida **antes** da nossa venda nos últimos 365 dias. A mesma empresa, NCM e unidade são obrigatórios. A identidade do item exige um destes critérios:

1. GTIN informado idêntico;
2. descrição normalizada exata;
3. equivalência entre código interno e código do fornecedor aprovada e registrada no CRM.

Códigos do fornecedor e do Falco não são considerados iguais por coincidência textual. Preços divergentes em compras da mesma data ficam ambíguos e não geram referência. Devoluções, remessas e resumos SEFAZ sem itens não entram na referência de compra. O cálculo usa `vProd - vDesc` dividido por `qCom` e não incorpora frete, tributos recuperáveis, despesas, bonificações ou custo de estoque. O painel mostra quantos itens têm e não têm correspondência e permite abrir as duas NF-e.

Descrições semelhantes com a mesma empresa, NCM e unidade são exibidas como **sugestões**, sem entrar no cálculo. Um administrador pode aprovar e revogar uma equivalência; a mudança fica no banco próprio do CRM e passa a valer nas próximas consultas. Para margem/markup gerencial total, ainda é necessário custo de estoque ou de produção por lote/movimento, além de tratamento tributário e financeiro. O XML de entrada, isolado, não comprova isso.

## Conferência do acervo em 28/09/2026

No recorte de vendas de 01/09 a 28/09, havia 608 linhas de venda nas NF-e disponíveis; nas entradas desde 01/09/2025, 789 linhas e 499 documentos classificados como venda pelo fornecedor. Nenhuma linha tinha GTIN ou descrição com NCM/unidade coincidentes nos dados já sincronizados. O algoritmo encontrou oito sugestões de descrição próxima **sem as considerar custo**. Estes números são um instantâneo de auditoria e variam com a sincronização.

Três equivalências foram conferidas nos XMLs pelos códigos e especificações de produto (kit protetor facial, marcador permanente azul e linha nylon 0,90 mm) e registradas no banco do CRM em 28/09/2026. Elas cobrem três linhas de venda do período, totalizando R$ 2.112,62 em itens vendidos contra R$ 1.507,50 pelo último preço de compra documentado (diferença parcial de R$ 605,12). A cobertura continua insuficiente para uma margem geral.

## Implantação

As migrações `supabase/004_sales_targets.sql` e `supabase/005_product_equivalences.sql` pertencem ao banco do CRM. As rotas autenticadas `/api/commercial/targets` e `/api/commercial/equivalences` operam apenas com a chave do servidor; usuários fiscais não têm acesso. O frontend público não recebe a chave do Supabase.
