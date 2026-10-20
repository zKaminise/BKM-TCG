# Preços de referência — revisão em 19/10/2026

O catálogo TCGdex identifica cartas. Um anúncio da BKM é uma oferta da loja, não uma cotação independente de mercado. A avaliação pessoal aceita somente referências compatíveis em BRL, com idioma, condição, acabamento, fonte e data. Quantidades multiplicam o valor unitário; unidades sem cotação ficam fora da soma e aparecem na cobertura. O custo pago é separado do valor estimado. A diferença não representa lucro realizado.

## Fontes avaliadas

| Fonte | Cobertura e moeda | Disponibilidade constatada | Decisão atual |
|---|---|---|---|
| Liga Pokémon | Mercado brasileiro; preço depende da edição, idioma, condição e acabamento | Não foi localizada documentação pública oficial de API/licença de redistribuição nesta revisão. A página bloqueou acesso automatizado com HTTP 403. Não houve tentativa de contornar o bloqueio. | Integração automática desativada até autorização formal e contrato técnico do fornecedor. Pesquisa assistida por link e referência inserida pelo próprio usuário continuam possíveis. |
| TCGdex / Cardmarket | Mercado europeu, EUR | A documentação publica campos de preço e atualização diária; cobertura e associação de variantes são incompletas. | Não convertido nem apresentado como preço brasileiro. |
| TCGdex / TCGplayer | Mercado norte-americano, USD | Dados horários/diários conforme fornecedor, com preços por variante quando disponíveis. A FAQ reconhece associações incorretas entre raridades em certos casos. | Não usado no patrimônio em BRL. Câmbio, isoladamente, não transforma uma oferta estrangeira em preço de mercado brasileiro. |
| Referência manual pessoal | Cartas de qualquer idioma suportado; valor informado em BRL | Disponível agora. Informação privada do usuário, com fonte/data e identificação de registro manual. Não certificada pela Liga. | Utilizada nos totais compatíveis. A fonte pode ser um comprovante ou uma pesquisa permitida que o próprio usuário realizou. |
| Provedor BRL contratado | Depende da licença e das condições do fornecedor | Nenhum fornecedor/credencial autorizado foi disponibilizado nesta etapa. | Contrato `getQuote({card,language,condition,variant,currency})` preparado no módulo pessoal; integração deve validar identidade e BRL antes de persistir uma cotação. |

Fontes primárias: [TCGdex — dados de mercado](https://tcgdex.dev/markets-prices), [TCGdex — FAQ sobre precisão e acesso](https://tcgdex.dev/faq), [referência da carta](https://tcgdex.dev/reference/card), [Liga Pokémon](https://www.ligapokemon.com.br/). Valores, limites, disponibilidade e permissão de redistribuição devem ser confirmados com o fornecedor antes de habilitar um novo serviço. Não foi contratado serviço pago.

## Transparência e atualização

- Sem cotação compatível: “Preço de mercado indisponível”. Nunca gerar valor fictício nem usar zero como estimativa de uma carta sem preço.
- Cotações registram origem, metodologia, instante observado, instante registrado e cobertura. Registros manuais continuam identificados como manuais mesmo quando o usuário escreve o nome de um marketplace no campo fonte.
- TTL configurável marca valores antigos. A interface exibe data/fonte e cobertura; não promete atualização automática sem provedor.
- Histórico é formado por observações reais e snapshots locais. Não são inventados valores para dias anteriores ao cadastro. Alterações de inventário também mudam o patrimônio observado; isso não deve ser confundido com valorização de mercado das mesmas cartas.
- Mínimo, mediana e média de ofertas exigem amostras compatíveis e uma fonte autorizada. Ofertas ativas não comprovam vendas concluídas. O fallback atual registra o valor manual informado, sem alegar mediana calculada.
- Não há scraping da Liga, reuso de cookies, proxies, contorno de CAPTCHA ou importação automática de páginas protegidas.

## Para ativar uma fonte automática

Obter por escrito as condições de uso comercial, cache, atribuição, armazenamento de histórico, redistribuição, limite de consultas, custo e suporte. Confirmar cobertura PT-BR, variantes, condição, moeda e identidade estável. Implementar o contrato do provedor com chamadas em lote/cache, registrar falhas e testar cotações ambíguas antes da ativação. Nenhuma chave pertence ao navegador.
