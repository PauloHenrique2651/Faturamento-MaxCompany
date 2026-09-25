# Correção de documentos fiscais e faturamento gerencial

Data: 25 de setembro de 2026

## Objetivo

Corrigir o fluxo existente sem recriar o CRM: sincronizar XMLs autorizados e DANFEs do Falco para o storage privado, completar o backfill histórico e separar vendas faturadas, devoluções, faturamento líquido e outras operações com reconciliação por NF-e.

## Restrições

- Alterar somente o projeto `CRM-EXECUTIVO`.
- Tratar `\\maxcompany\DEPLOY` como fonte somente leitura.
- Não resetar banco, excluir histórico, usar migration destrutiva ou publicar documentos fiscais no Git.
- Manter coletor Node local, Supabase privado e frontend/API serverless na Vercel.
- Entregar documentos somente por endpoint autenticado; o bucket continuará privado.

## Diagnóstico

O coletor encontra XMLs em `XmlDestinatario_*` e DANFEs em `DanfePDF_*`. Em 25/09/2026 havia cerca de 15.286 XMLs emitidos e 22.367 PDFs na origem, mas apenas 102 artefatos constavam como sincronizados.

O backfill limita cada execução aos primeiros 100 documentos visitados. Documentos já enviados continuam consumindo esse limite, portanto as execuções seguintes revisitam o mesmo lote e não avançam. A API cloud também presume caminhos fixos e ignora `xml_storage_path` e `pdf_storage_path`.

## Arquitetura mantida

```text
Falco / pasta fiscal (somente leitura)
  -> coletor local
  -> validação do nfeProc e da chave
  -> classificação fiscal centralizada
  -> metadados no Supabase
  -> artefatos no bucket privado
  -> API autenticada da Vercel
  -> CRM publicado
```

A Vercel nunca acessará caminhos Windows ou IPs privados.

## XML, DANFE e storage

O XML será associado pela chave de 44 dígitos. Antes do upload, o coletor validará `nfeProc`, `NFe`, `protNFe`, chave, autorização, número, série, emitente, destinatário, data e valor. Documento divergente não será associado.

O DANFE existente será localizado pela convenção do Falco e vinculado somente à NF-e validada. Sem PDF, a interface poderá usar a representação já gerada a partir do XML autorizado.

O banco registrará os caminhos reais de XML e PDF. Estados independentes informarão disponibilidade, ausência, pendência e erro. Falhas registrarão chave, empresa, direção, artefato, tentativa, origem, mensagem sanitizada e data/hora.

## Backfill

O limite será aplicado a uploads efetivamente pendentes, não a documentos apenas examinados. O estado persistirá progresso e falhas por artefato. Objetos existentes contarão como sucesso. Erros temporários serão tentados novamente sem bloquear o restante da fila. O processo será idempotente, retomável e auditável.

## Classificação e faturamento

A classificação usará `finNFe`, CFOPs, natureza, direção, referências e status. Os tipos serão venda, devolução, transferência, bonificação, complementar, ajuste, retorno de industrialização, mista, outras e não classificada.

Somente NF-e de saída autorizadas, não canceladas e inteiramente classificadas como venda comporão **Vendas faturadas**. Somente devoluções recebidas de clientes com XML completo e referência confirmada a venda autorizada da mesma empresa e contraparte reduzirão o faturamento líquido. Devoluções de compra emitidas a fornecedores ficarão separadas.

```text
Vendas faturadas = soma das NF-e de venda
Devoluções confirmadas = soma das devoluções recebidas vinculadas
Faturamento líquido = vendas faturadas - devoluções confirmadas
```

Canceladas, denegadas, rejeitadas e inutilizadas não participarão dos totais. Operações desconhecidas não serão tratadas como venda.

## Interface

O dashboard manterá o design system atual e destacará vendas faturadas, faturamento líquido e devoluções. Valores abreviados terão valor exato e tooltip com a regra.

A listagem mostrará tipo gerencial, status fiscal e disponibilidade de XML/DANFE. O detalhe manterá resumo, itens, impostos, XML formatado e DANFE. No mobile, a linha principal mostrará apenas campos essenciais e as ações ficarão compactas.

A reconciliação exibirá quantidade e valor por classificação, inclusive não classificadas. Indicadores de cobertura permitirão chegar aos documentos faltantes. KPIs e drill-down usarão a mesma coleção filtrada.

## Migration e segurança

A migration será somente aditiva: estados, tentativas, erros e índices necessários, com padrões compatíveis. Nenhuma tabela ou linha será removida.

Nenhum segredo, XML ou PDF entrará no Git ou no diretório público. A API validará sessão, empresa, direção, chave, formato e caminho antes de ler o bucket. Respostas não revelarão paths internos nem segredos. A falha de um documento não interromperá o lote.

## Testes e entrega

Serão testados venda, devolução, cancelamento, devolução cancelada, transferência, complementar, ajuste, mista, não classificada, XML autorizado, XML divergente, DANFE existente/ausente, duplicidade, retry e avanço além do primeiro lote.

A entrega incluirá formatação, sintaxe, testes, verificação estrutural, amostra real contra XML do Falco, commit, push, espera do deploy e validação do domínio. Sem sessão autenticada utilizável, a limitação da validação funcional será registrada objetivamente.
