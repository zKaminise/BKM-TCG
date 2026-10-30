# Estimativas da coleção em reais — 29/10/2026

## Comportamento

A coleção apresenta o valor unitário e o total estimado em BRL. A prioridade é: valor pessoal informado, referência exata atual, referência brasileira compatível do MYP Cards e, na ausência destas, referência internacional atual convertida para reais.

A conversão recebe o rótulo **Referência internacional convertida**. Não representa um anúncio brasileiro, uma oferta de compra, um preço garantido de venda ou uma avaliação ajustada à conservação. Não são aplicados multiplicadores inventados para NM, SP, HP ou outras condições. O custo de aquisição e os preços comerciais da loja permanecem independentes.

O total indica quantos exemplares utilizam conversão e continua parcial quando existem itens sem referência compatível. A moeda original fica nos detalhes da fonte; a apresentação principal é em reais. Uma referência manual não é substituída silenciosamente por uma conversão automática.

## Câmbio e procedência

As taxas EUR/BRL e USD/BRL são consultadas no serviço público PTAX do Banco Central, sem chave. Usa-se a cotação de venda do fechamento mais recente válido. Não há taxa fixa embutida no código. A tela preserva a fonte internacional, a data do preço, a taxa aplicada e a data do câmbio.

Fontes: [serviço oficial PTAX](https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/documentacao), [metadados oficiais OData](https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/$metadata) e [definição dos campos](https://www.bcb.gov.br/conteudo/dadosabertos/BCBDepin/gnastportal-dados-abertostaxas-de-cambio---todos-os-boletins-diarios.pdf).

O cálculo utiliza centavos inteiros e taxa de câmbio em escala fixa, arredondando uma vez por unidade. Quantidades multiplicam esse valor unitário. A conversão não faz requisições para cada cópia da mesma carta.

Sem preço original atual, taxa válida ou correspondência de idioma/acabamento, não se inventa uma estimativa. Preços originais ou taxas vencidos ficam fora do total. Cartas com idioma físico diferente da referência ou atributos especiais sem correspondência também ficam fora da conversão automática.

## Persistência e configuração

Reutiliza-se o cache privado `personal_reference_cache`; não há nova tabela, migração ou credencial. O backend compartilha taxas entre consultas e guarda as referências convertidas para que paginação, filtros, ordenação, agrupamento, resumo, fichários e exportação usem a mesma política de valores.

```dotenv
# Padrão: true. Somente no backend; nenhum token é necessário.
FX_CONVERSION_ENABLED=true
```

A integração MYP continua preparada. O acesso externo ainda depende da liberação legítima do provedor; a resposta 403 não é interpretada como preço zero. Quando uma referência brasileira válida estiver disponível, ela terá prioridade sobre a conversão internacional.

## Validação

**553 testes aprovados** na suíte completa, incluindo SQLite e PostgreSQL/PGlite. Sintaxe e build passaram. A cobertura inclui arredondamento, moedas, impressão/idioma/acabamento incompatíveis, taxas e preços vencidos ou futuros, timeout, indisponibilidade, cache entre instâncias, prioridade manual/exata/MYP, totais, filtros, agrupamentos, fichários, checklist, CSV e preservação de custos.

O serviço oficial do Banco Central respondeu HTTP 200 para EUR e USD, com o fechamento de 29/10/2026. No navegador isolado, a busca automática, inclusão de uma carta, revisão, salvamento e recarregamento mostraram a mesma estimativa unitária e total em BRL. O custo informado foi preservado. Também se verificou a tela mobile em 390 px, sem transbordamento horizontal. Os preços e a taxa desse teste de interface são **fixtures sintéticas**, não cotações reais da carta e não foram inseridos na conta comercial.


Na versão publicada em lojabkm.com.br, a busca pela impressão cel25-5 mostrou **R$ 24,24**, calculados a partir de EUR 4,04 (Cardmarket via TCGdex, atualização de 28/10/2026) e PTAX venda EUR/BRL 6,0000 (fechamento de 29/10/2026). Esse é um registro da consulta, não um preço fixo nem uma avaliação SP/NM específica. A origem em EUR aparece somente ao expandir os detalhes. O ajuste inclui espera limitada para a primeira consulta de câmbio entre instâncias simultâneas, validada com respostas simuladas de 650 ms.

A auditoria antes/depois confirmou os mesmos dados de produtos, variantes, pedidos, movimentações e reservas comerciais; não houve migração nem alteração nesses registros.
