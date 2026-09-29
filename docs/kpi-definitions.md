# Definições dos indicadores

O período é a data de emissão da NF-e. Os filtros de empresa, período, CFOP e efeito financeiro recortam os documentos consultados. Um filtro de CFOP pode excluir uma devolução cujo CFOP difere do da venda; o saldo filtrado não é uma conciliação por item devolvido.

| Indicador                          | Definição                                                                                                                                                                                             |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Valor fiscal emitido               | Soma de `vNF` das saídas autorizadas e não canceladas. Não equivale a receita.                                                                                                                        |
| Movimento com efeito financeiro    | Soma dos itens com CFOP da regra gerencial, independentemente da direção; compras e vendas permanecem separadas.                                                                                      |
| Vendas financeiras                 | Itens financeiros de NF-e de saída classificadas como venda, autorizadas e não canceladas.                                                                                                            |
| Compras financeiras                | Itens financeiros de NF-e de entrada completas classificadas como compra; nunca receita ou CMV.                                                                                                       |
| Devoluções financeiras confirmadas | Valor da devolução recebida, não cancelada, com referência confirmada a venda original integralmente financeira da mesma empresa e cliente. Vendas mistas exigem conciliação manual.                  |
| Faturamento real                   | Vendas financeiras menos devoluções financeiras confirmadas. Métrica gerencial documental, anterior a tributos, custos e despesas.                                                                    |
| Sem efeito financeiro              | Soma dos itens cujo CFOP não consta da regra financeira; um documento misto pode contribuir parcialmente.                                                                                             |
| Pendente                           | Itens sem CFOP e diferença entre `vNF` e soma líquida dos itens, sem rateio.                                                                                                                          |
| Cancelamentos                      | `vNF` e quantidade das NF-e com evento/status de cancelamento, informativos e já excluídos do realizado.                                                                                              |
| Diferença fiscal × faturamento     | Valor fiscal emitido menos faturamento real. Inclui saídas financeiras não classificadas como venda, itens não financeiros, pendências e o efeito das devoluções. Não é uma categoria contábil única. |

Rankings comerciais e metas usam a mesma base de vendas financeiras. Markup e margem só podem ser divulgados sobre itens com custo de compra anterior efetivamente conciliado; a ausência de cobertura impede resultado contábil completo.
