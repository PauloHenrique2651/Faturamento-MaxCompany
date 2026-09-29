# Regra gerencial de CFOP financeiro

A única lista editável é `public/lib/financial-cfops.js`. `npm run sync:frontend` copia esse arquivo para o bundle publicado. Esta é uma regra da operação MaxCompany, não uma regra tributária geral.

CFOPs com efeito financeiro: 5102, 6102, 7102, 1102, 2102, 3102, 1353, 2353, 3353, 5922, 6922, 2113, 6113, 5916, 2916, 1901, 2901, 5118, 6118, 5119, 6119, 5114, 6114, 1556 e 2556.

A classificação usa o CFOP de cada item e seu `vProd - vDesc`. O `vNF` permanece no total fiscal. Frete, impostos e outras diferenças entre `vNF` e os itens não são rateados: aparecem como pendentes de classificação. Item sem CFOP válido também é pendente. Uma nota mista preserva as parcelas financeira e não financeira. CFOP 5949 não gera financeiro nesta regra.

A direção e a natureza da operação continuam necessárias: uma NF-e recebida de fornecedor não vira receita, uma saída de devolução não vira venda e uma nota cancelada não participa do realizado. A lista de CFOPs sozinha nunca transforma uma operação em venda.

Devoluções só reduzem faturamento quando a NF-e recebida referencia uma venda autorizada da mesma empresa e do mesmo CNPJ destinatário. Para evitar rateio inventado, uma venda original mista ou com diferença não atribuível não gera abatimento automático; a devolução continua visível para conciliação.
