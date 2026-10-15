# Catálogo Pokémon — integração TCGdex

Implementado em `server/catalog.cjs`, usando apenas `fetch` e módulos nativos do Node.js 22. Consultado e verificado em 15/10/2026. Este serviço fornece **metadados de referência para importação administrativa**. Não cria produtos, define preços, publica anúncios ou altera estoque.

## Contrato

- `listSets({language:'pt'})` → `{items,total,provider,language}`.
- `searchCards({set:'sv09',number:'001/159',language:'pt'})` → `{items,total,provider,language,set,warnings}`.
- Idiomas da loja: `pt`, `en`, `ja`. O alias de entrada `pt-br` resolve explicitamente para `pt`.
- `CatalogError` possui `status`, `statusCode`, `code` e mensagem em português; API deve preservar o status e apresentar a mensagem. Falha de rede gera 502; timeout, 504; registro ausente, 404; entrada inválida, 400.
- Exporta também `createCatalogProvider` para teste isolado com transporte injetado.

O backend deve proteger `/api/catalog/sets` e `/api/catalog/search` com autorização administrativa. O catálogo público consulta exclusivamente anúncios persistidos no inventário da loja. Os filtros públicos devem vir desse inventário, nunca da lista mundial do provedor.

## Identidade e normalização

A busca lê primeiro `/{language}/sets/{setId}` e compara o número solicitado com `cards[].localId` da coleção genuína. Só então consulta o `id` devolvido pelo provedor em `/cards/{id}`. Não monta IDs presumindo formato, nem equipara nomes comerciais brasileiros a coleções internacionais. IDs japoneses contendo `+`, como `SM1+`, são preservados e codificados na URL.

Comparação de números tolera maiúsculas/minúsculas e zeros à esquerda, inclusive `TG0001` versus `TG01`. A numeração exibida preserva a forma do provedor. Entrada `025/198` procura `025`; divergência entre denominador digitado e contagem oficial gera aviso de conferência antes da importação. A confirmação humana dos metadados continua necessária.

Uma carta retorna `id` estável no formato `tcgdex:idioma:providerId`, além de `providerId`, `setId`, `setName`, `name`, `number`, `total`, `rarity`, `type`, `hp`, `image`, `series`, `category`, `variants`, `provider`, `language`, `imageKind:'reference'`. `total` usa o total oficial impresso, que pode diferir da quantidade com cartas secretas. O resumo da coleção expõe também `totalWithSecret`.

Preço, condição física, estoque, fotos reais e acabamento efetivamente vendido pertencem ao anúncio comercial e precisam ser preenchidos separadamente. As possibilidades de `variants` do provedor não representam estoque da loja. A imagem retornada é ilustrativa; não comprova conservação física.

## Cobertura e idiomas verificados

Leituras reais da API retornaram:

| Endpoint | Resultado observado |
| --- | --- |
| `/v2/pt/sets` | 125 coleções |
| `/v2/en/sets` | 220 coleções |
| `/v2/ja/sets` | 184 coleções |
| `/v2/pt-br/sets` | 11 coleções de Pocket; por isso a loja usa `/pt` para cartas físicas brasileiras |
| `pt`, coleção `sv09`, `001/159` | Caterpie, metadados em português e imagem |
| `en`, coleção `base1`, `058/102` | Pikachu, número preservado como `58`, imagem |
| `ja`, coleção `PMCG1`, `001/102` | フシギダネ, metadados disponíveis, imagem ausente identificada por aviso |
| `pt`, coleção `base1` | Coleção existe, mas lista de cartas vazia no momento da consulta |

Essas contagens refletem a resposta da data de teste, não uma promessa de cobertura completa. Não há troca automática de idioma quando faltam dados. Cadastro manual permanece disponível.

O [status oficial](https://tcgdex.dev/status) informa que a completude varia por idioma. O [painel de progresso](https://api.tcgdex.net/status) consultado indicava metadados em português em aproximadamente 77,50% e imagens em 71,03%; inglês, 99,05% e 91,75%; japonês, 70,88% e 21,53%. Os conjuntos e seus IDs específicos também variam regionalmente.

## Imagens, uso e limites

URLs são derivadas exclusivamente do campo `image` da API e do [formato de assets documentado](https://tcgdex.dev/assets), usando `/high.webp`. Só são aceitas URLs HTTPS de `assets.tcgdex.net`, sem credenciais, portas personalizadas ou parâmetros arbitrários. O servidor não baixa nem faz scraping das imagens. Campos ausentes permanecem nulos.

A [FAQ oficial](https://tcgdex.dev/pt-br/faq) informa acesso sem chave e ausência de limites rígidos publicados; recomenda cache para consultas repetidas. Não há SLA ou cota garantida confirmada nesta integração.

O [repositório oficial](https://github.com/tcgdex/cards-database#licenses) declara banco sob [MIT](https://github.com/tcgdex/cards-database/blob/master/LICENSE), sem afiliação com Nintendo ou The Pokémon Company. Isso não foi tratado como autorização irrestrita sobre marcas e ilustrações Pokémon de terceiros. Não foi confirmada uma licença comercial específica das imagens; revisar direitos e condições aplicáveis antes de operação pública.

## Resiliência e segurança

- Origem de API fixa: `https://api.tcgdex.net/v2`, sem endpoint configurável por requisição.
- Validação estrita de idioma, ID e número; segmentos codificados.
- Timeout de 6,5 segundos por tentativa, incluindo leitura do corpo; uma repetição no máximo para rede, timeout, 429 ou erro 5xx.
- Sem repetição para 404 ou erro de estrutura.
- Cache em memória por 30 minutos, máximo de 128 respostas, cópias independentes e coalescência de requisições iguais; máximo de 32 consultas pendentes.
- Respostas limitadas a 2 MiB; coleções limitadas a 5 mil registros; até 10 correspondências de uma mesma numeração.
- Erros claros oferecem cadastro manual; sem API falsa ou sucesso simulado.

## Validação

`node --test server/catalog.test.cjs`: 10 testes passaram. Cobrem coleção/número, zeros, alfanuméricos, IDs japoneses com `+`, idiomas, cache/TTL/limite/coalescência, retry, timeout, 404, metadados incompatíveis, imagem de host arbitrário, cobertura vazia e corpo inválido/excessivo.

Smoke test externo executado com o módulo implementado: listagem PT/EN/JA e consultas de uma carta em cada idioma retornaram os resultados da tabela. Nenhum produto foi importado ou publicado nesses testes. A primeira tentativa de rede dentro da sandbox falhou por DNS (`ENOTFOUND`); a verificação de leitura autorizada fora da sandbox funcionou.

Referências de contrato: [REST v2](https://tcgdex.dev/rest), [coleções](https://tcgdex.dev/rest/sets), [detalhe da coleção](https://tcgdex.dev/rest/set), [detalhe da carta](https://tcgdex.dev/rest/card).


---

# Mercado Pago — preparação de segurança, integração pendente

`server/payments.cjs` contém somente utilitários de preparação. **Não é um gateway integrado e não cria cobranças, Pix, tokens de cartão, capturas ou reembolsos.** A compra com pagamento deve continuar indisponível. Não foi executada transação, inclusive sandbox.

## O que foi implementado

- `paymentReadiness(env)`: retorna prontidão honesta, sem divulgar segredos. `enabled` e `canCharge` permanecem falsos mesmo que variáveis estejam preenchidas, porque a integração não foi concluída nem validada.
- `requirePaymentReady()`: responde com erro 503 e informa que nenhuma cobrança foi criada.
- `idempotencyKeyForOrder(orderId)`: gera chave estável SHA-256 para uma futura requisição de criação, permitindo reutilização segura da mesma chave em tentativas do mesmo pedido.
- `verifyWebhookSignature({signature,requestId,dataId,secret,now,maxAgeMs})`: verifica HMAC SHA-256 e compara em tempo constante. Usa `data.id` da query, em minúsculas quando alfanumérico, junto de `x-request-id` e `ts` no manifesto documentado. Recusa campos ausentes/duplicados e timestamps fora da janela configurada. Aceita timestamp em segundos ou milissegundos. Retorna uma chave de identificação de repetição exata, **sem persistir ou processar eventos financeiros**.

Os nomes de configuração reservados são `MERCADO_PAGO_ENVIRONMENT=sandbox`, `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_PUBLIC_KEY` e `MERCADO_PAGO_WEBHOOK_SECRET`. Não adicionar credenciais ao repositório nem ao HTML autossuficiente.

## O que falta para habilitar

1. Configurar uma aplicação e contas de teste do Mercado Pago, confirmando explicitamente que as credenciais pertencem ao ambiente correto.
2. Implementar criação de Orders e formulário oficial/tokenização para Pix e cartão, usando somente totais calculados pelo servidor e a chave de idempotência persistida por tentativa financeira.
3. Dispor de endpoint HTTPS de notificações e configurar evento `order` e assinatura. Verificar HMAC antes de aceitar a notificação. A assinatura identifica o recurso, não autoriza confiar cegamente em todos os campos do corpo.
4. Consultar a order no provedor e validar identidade do vendedor, ambiente, referência externa, moeda BRL, total, valor efetivamente pago e status apropriado.
5. Persistir evento com unicidade e realizar transição financeira + movimentação de estoque em transação de banco. A chave de repetição exata do helper não substitui idempotência comercial para novas notificações do mesmo pagamento.
6. Testar sandbox de ponta a ponta: aprovação, pendência, recusa, cancelamento, notificações duplicadas, falhas de rede e concorrência de estoque. Não marcar como pronto sem esses testes.

## Referências oficiais consultadas em 15/10/2026

As [credenciais Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/resources/credentials?scope=prod) distinguem testes e produção. O prefixo sozinho não comprova ambiente: nas [contas de teste Orders](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/resources/test-accounts), o Access Token de teste pode começar com `APP_USR`. Nenhuma configuração deste módulo habilita cobranças automaticamente.

O contrato de notificações e a necessidade de confirmação do recurso estão na [documentação de Webhooks Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/notifications). O [manifesto HMAC sem SDK](https://www.mercadopago.com.br/developers/pt/docs/wallet-connect/notifications) descreve `data.id`, `request-id` e `ts`, incluindo uso do identificador alfanumérico em minúsculas. A tolerância local padrão de 10 minutos é política deste helper; deve ser ajustada e testada com os reenvios reais antes de ativação.

## Testes executados

`node --test server/payments.test.cjs`: 4 testes passaram, cobrindo HMAC válido/adulterado, campos duplicados/ausentes, timestamp antigo, chave estável por pedido e bloqueio permanente de cobrança sem exposição de segredos. São testes unitários locais com valores artificiais identificados; não comprovam integração com o serviço Mercado Pago.
