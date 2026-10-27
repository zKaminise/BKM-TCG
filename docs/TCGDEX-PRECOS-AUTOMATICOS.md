# Referências automáticas de mercado — Minha Coleção

Implementado em 27/10/2026. O catálogo TCGdex já existente foi reaproveitado. Não é necessário criar banco, chave ou tabela adicional.

## Comportamento entregue

- Busca automática após 250 ms de digitação, inclusive `166` → `166/` → `166/1` → `166/165`, além de nomes, IDs e expansão. Respostas de consultas anteriores são descartadas. O botão permanece como atualização opcional.
- Preços públicos reais consultados do objeto `pricing` retornado pela carta TCGdex; nenhuma tabela de preços hardcoded em produção.
- Referência internacional visível no resultado da busca, formulário de conservação/acabamento, revisão, cartão do inventário e detalhe do exemplar. A referência muda ao editar acabamento/atributos.
- Cardmarket: tendência `trend` em EUR; campo `trend-holo` quando explicitamente compatível. TCGplayer: `marketPrice` por acabamento em USD.
- A seleção prioriza referência atual do TCGplayer quando compatível, depois Cardmarket. Zero é tratado como ausência, sem exibir preços de € 0,00 como cotação real.
- Totais internacionais somam somente exemplares ativos **da página atual**, separadamente para cada fonte/moeda e acabamento compatível. Vendidos, arquivados, referências antigas e acabamentos/atributos incompatíveis são excluídos. Nunca se somam USD e EUR.
- Custos, patrimônio manual em reais e lucros BRL mantêm suas regras anteriores. A referência BRL informada pelo usuário é preservada e continua prioritária, sem conversão cambial ou substituição silenciosa.
- O cadastro salva um snapshot de `marketData` nos metadados privados do exemplar. A matéria-prima pública fica também no cache persistente compartilhado, sem informações do colecionador.
- Cache diário. Listagens verificam até oito identidades vencidas da página, em até quatro consultas simultâneas. A ação de atualização aceita até 24 registros próprios e respeita o mesmo cache; não dispara polling ou atualização de todo o acervo. Falhas têm cooldown curto. Acervo e snapshot não são apagados quando a fonte falha.
- Endpoint autenticado `POST /api/account/collection/inventory/market-refresh`, corpo `{ "ids": ["id-do-exemplar"] }`, valida propriedade de todos os IDs e retorna itens enriquecidos. A proteção de sessão/CSRF existente continua aplicada.

## Limites reais e integridade das estimativas

O TCGdex publica referências de **Cardmarket (EUR)** e **TCGplayer (USD)**, não uma cotação brasileira. O idioma do metadado da carta não comprova que o preço corresponda a uma impressão naquele idioma. As respostas examinadas também não informam conservação. Portanto, selecionar HP, NM ou Mint **não aplica multiplicador inventado** nem afirma que o valor seja específico da condição; esse limite aparece na interface.

Os valores têm `condition: null`, `marketLanguage: null`, `match: PARTIAL`, `brazilian: false`, `converted: false` e `usableForBrlValuation: false`. A data exibida é a data de atualização **da fonte**, distinta da data em que a BKM verificou o cache. Após sete dias sem atualização da fonte, a referência é marcada desatualizada e excluída dos totais.

Quando a fonte não identifica o acabamento, a referência geral pode ser exibida com aviso, mas não entra no total por acabamento. Quando existe exatamente um acabamento no catálogo, a tendência geral pode ser associada a ele com `finishBasis: single_catalog_variant`. O preço de acabamento explicitamente indicado pelo provedor tem preferência sobre essa inferência. Atributos extras (carimbo, primeira edição etc.) sem referência correspondente impedem seleção/total automático.

A própria [FAQ oficial](https://tcgdex.dev/faq) alerta para associações incorretas de IDs entre marketplaces e raridades. A BKM mantém `providerMappingVerified: false` e informa que a correspondência de impressão não é certificada. Não se promete avaliação ou recompra por esse valor. A integração brasileira autorizada da Liga Pokémon permanece pendente.

## Verificação pública real

Em 27/10/2026 foram consultados, sem modificar produção:

| Carta | Cardmarket | Data da fonte | TCGplayer | Data da fonte |
| --- | --- | --- | --- | --- |
| Bulbasaur `sv03.5-166`, 166/165 | EUR 64,95 | 26/10/2026 | USD 61,17 | 14/10/2026 — desatualizada |
| Squirtle `sv03.5-170`, 170/165 | EUR 70,92 | 26/10/2026 | USD 91,43 | 14/10/2026 — desatualizada |
| Furret `swsh3-136` | EUR 0,06, acabamento não informado | 26/10/2026 | USD 0,27 normal / 0,44 reverse | 14/10/2026 — desatualizadas |

Esses valores documentam a resposta recebida; não são preços permanentes ou regras embutidas. O comprovante JSON com fonte, horário, identidade e normalização foi guardado no diretório privado de trabalho, fora do artefato publicado.

## Testes

`tests/tcgdex-market.test.cjs`: precisão monetária, moedas e fontes, identidade, zero/ausência, datas impossíveis e antigas, acabamento/atributos, totais nativos separados, BRL manual preservado e paridade de seleção frontend/backend.

`tests/collection-market-integration.test.cjs`: fluxo real dos serviços com transporte externo simulado e bancos SQLite/PostgreSQL via PGlite; cadastro, snapshot persistente, cache diário, atualização, isolamento entre usuários, limites de lote, conservação HP sem fator inventado e indisponibilidade sem perda de dados.

`tests/collection-catalog.test.cjs` e `tests/collection-ui-domain.test.cjs`: busca progressiva sem submit, debounce, cancelamento de navegação, pesquisa exata antiga preservada e atualização do cache persistente.

`tests/collection-ui-smoke.test.cjs`: executa o carregamento real do dashboard com um host DOM mínimo, conferindo item persistido, referência EUR, escopo da página, finalização de carregamento e mensagem de erro recuperável, para impedir regressão de variáveis da busca usadas indevidamente na lista.

Fontes primárias: [TCGdex em português](https://tcgdex.dev/pt-br), [integração de mercados e formatos](https://tcgdex.dev/markets-prices), [FAQ e limitações](https://tcgdex.dev/faq).
