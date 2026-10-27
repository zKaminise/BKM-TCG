# Catálogo da Minha Coleção

O adaptador `server/collection-catalog.cjs` consulta a API REST pública do **TCGdex**, em `https://api.tcgdex.net/v2/{idioma}`. Os metadados do catálogo são independentes dos produtos, preços e quantidades disponíveis na loja BKM. As imagens são referências externas do TCGdex; o projeto não declara propriedade sobre a arte das cartas.

## Identificação e cobertura

Cada carta tem identidade `tcgdex:{idioma-de-referência}:{id-do-provedor}`. Número local, total impresso e expansão são campos distintos. A API normalizada contém nome, ID e código da expansão, série, número impresso, raridade, ilustrador, números da Pokédex, imagens em duas resoluções, idioma da referência e acabamentos declarados pelo provedor. Campos ausentes continuam ausentes: imagem, raridade ou impressão não são fabricadas.

`availableLanguages` contém somente o idioma da referência efetivamente conferida. O mesmo número ou nome não comprova uma impressão japonesa/portuguesa equivalente. O idioma do exemplar físico é separado de `referenceLanguage`. Quando a busca em português não encontra registros antigos, pode oferecer resultados em inglês, com `languageFallback`, `requestedLanguage` e aviso explícito. Esses resultados conservam identidade e imagem em inglês.

A busca aceita nomes, ID canônico ou ID do provedor, números locais com ou sem zeros à esquerda, números completos, nome + número, nomes de expansão em português/inglês, código TCGdex e abreviação oficial retornada pela API. O total da numeração é comparado ao total **oficial**, sem confundi-lo com o total que inclui cartas secretas. Colisões retornam todas as expansões correspondentes com paginação e aviso de ambiguidade. O seletor de expansão resolve essa ambiguidade.

O provedor organiza Pokémon TCG Pocket na série `tcgp`. O adaptador usa essa relação real para excluir as cartas digitais dos resultados de itens físicos, em vez de tentar adivinhar pelo nome.

## Cache e limites

- Cache persistente de listas de cartas, expansões, séries e buscas auxiliares: **24 horas**.
- Detalhes de carta e preços internacionais associados: **24 horas**. Metadados essenciais e a referência de preço coletada também ficam no registro privado do exemplar; indisponibilidade externa não apaga o acervo.
- Cache de memória curto, limitado a 64 entradas; chamadas iguais em andamento são agrupadas.
- Índice resumido fica no servidor. Na verificação, o índice português tinha 13.907 registros e cerca de 1,4 MB. O navegador recebe somente a página solicitada.
- Máximo de 24 cartas por página, hidratação de detalhes com concorrência limitada a quatro chamadas e timeout por consulta externa de até 6,5 segundos, dentro de orçamento cooperativo de 40 segundos por operação. Nenhum polling ou cron de catálogo foi criado.
- Resposta máxima de 8 MB, endpoints fixos, parâmetros codificados e validação de URLs de imagem para `assets.tcgdex.net`. Não há chave privada no cliente.
- Em consulta fria, falha transitória de rede/429/5xx recebe uma única repetição com espera de 200 ms, dentro do mesmo orçamento. Ausência de impressão (404) não é tratada como falha transitória. Havendo cache anterior, ele é devolvido sem prolongar a espera com repetições.
- Na indisponibilidade da fonte, o cache anterior é devolvido com `stale` e data da coleta. Sem cache utilizável, há erro recuperável; os itens pessoais existentes permanecem salvos.

`GET /api/account/collection/catalog/search` recebe `q`, `language`, `setId` (ou `set`), `page` e `pageSize`. Também aceita série, raridade e tipo. Com `live=1`, números e denominadores incompletos são pesquisados por prefixo: `16`, `166/` e `166/1` mantêm resultados pertinentes enquanto o usuário digita. Sem esse parâmetro, a pesquisa de número completo conserva a comparação exata. A interface pesquisa automaticamente após 250 ms, cancela respostas antigas, respeita composição de texto e mantém cache de um minuto para até 30 consultas desta tela. A resposta traz `items`, `total`, paginação, `sets`, `series`, fonte, data e avisos. `GET .../catalog/sealed` consulta somente metadados de produtos selados publicados e não arquivados, sem converter preço de venda da loja em cotação de mercado. Na ausência de produto catalogado, o cadastro manual continua disponível.

## Verificação real executada em 27/10/2026

O teste de rede usou um banco SQLite isolado, sem alterar produção:

| Busca | Resultado real conferido |
| --- | --- |
| `166/165` | Bulbasaur, `sv03.5-166`, 151, Ilustração Rara, Yoriyuki Ikegami |
| `170/165` | Squirtle, `sv03.5-170`, 151, Ilustração Rara, Mitsuhiro Arita |
| `33/181` | Pikachu e Zekrom GX, `sm9-33`, União de Aliados |
| `Charmander 168` | `sv03.5-168`, 168/165 |
| `Charizard 199/165` | Charizard ex, `sv03.5-199` |
| `151`, `Escarlate e Violeta 151`, `Scarlet & Violet 151` | 207 registros reais da expansão 151 |
| `sv03.5-166` | A identidade exata de Bulbasaur, sem resolver somente por nome |
| `25/102` | Dewgong / Base Set e Lunatone / Triumphant, com referências explicitamente em inglês |
| `1/100` | Quatro expansões físicas distintas, com referências em inglês |

As URLs das imagens de Bulbasaur e Squirtle responderam HTTP 200, `image/webp`. Esses exemplos são verificações do catálogo externo; não existem exceções hardcoded para produzir esses resultados. Testes automatizados também usam expansões/nomes diferentes para conferir colisões, normalização, paginação, isolamento de idiomas, cache e falha da fonte.

## Precificação: capacidade diferente do catálogo

**Não há integração automática com preços brasileiros da Liga Pokémon neste módulo.** Não foi fornecida ao projeto uma API/credencial/contrato autorizado dessa fonte. A pesquisa pública não localizou documentação oficial de API de preços; o acesso automatizado à página oficial consultada respondeu 403. Isso não demonstra que uma parceria seja impossível: significa que não existe integração autorizada comprovada disponível para implementar agora. Não foram contornados bloqueios, autenticação, captcha ou limites.

O TCGdex documenta preços internacionais de **Cardmarket (EUR, Europa)** e **TCGplayer (USD, América do Norte)**. A documentação descreve atualização diária para Cardmarket e horária/diária para TCGplayer. O adaptador agora consulta e exibe essas referências automaticamente na busca, detalhes, revisão e inventário, com fonte, moeda, data e acabamento quando identificável. Os totais internacionais da página são apresentados por fonte e moeda, separados dos indicadores em BRL. Isso não comprova preço brasileiro nem equivalência de idioma/condição de cada exemplar. `valuation` continua reservado à política BRL existente; `marketData` e `internationalMarket` contêm os dados estrangeiros. Ver [regras e validação da integração automática](TCGDEX-PRECOS-AUTOMATICOS.md).

Valores privados informados pelo usuário permanecem identificados como manuais. A infraestrutura de preços autorizados existente na BKM mantém sua própria fonte, moeda, data e identidade; preços estrangeiros e valores desconhecidos não são misturados nos totais BRL.

## Fontes primárias

- [TCGdex: API multilíngue e cobertura variável por idioma](https://tcgdex.dev/pt-br).
- [Filtros, ordenação e paginação da API](https://tcgdex.dev/rest/filtering-sorting-pagination).
- [Objeto de carta](https://tcgdex.dev/reference/card).
- [Série oficial de Pokémon TCG Pocket](https://tcgdex.dev/tcg-pocket).
- [Fontes e moedas dos preços internacionais](https://tcgdex.dev/markets-prices).
- [Licença MIT do banco de metadados TCGdex, copyright TCGdex](https://github.com/tcgdex/cards-database/blob/master/LICENSE). Essa licença não é uma declaração de propriedade da BKM sobre marcas ou imagens Pokémon.
- [Página oficial Liga Pokémon](https://www.ligapokemon.com.br/).
