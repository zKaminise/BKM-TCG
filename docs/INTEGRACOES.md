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

# Pagamentos — demonstração e adapter Mercado Pago

`server/payments.cjs` separa `PaymentProvider`, `MockPaymentProvider` e `MercadoPagoPaymentProvider`. Os valores são centavos inteiros calculados pelo servidor, nunca um total confiado ao navegador. Nenhuma cobrança externa foi executada nesta implementação, nem em sandbox. O ambiente demonstrativo utiliza exclusivamente o mock.

## Modos e ativação explícita

| Modo da aplicação | Provedor | Requisitos | Cobrança real |
| --- | --- | --- | --- |
| `BKM_ENVIRONMENT=demo` | `PAYMENT_PROVIDER=mock` | Ambos explicitamente configurados | Impossível |
| `BKM_ENVIRONMENT=staging` | `PAYMENT_PROVIDER=mercadopago` | Sandbox, credenciais e `MERCADO_PAGO_ENABLED=true` | Não permitida; exige comprador de teste |
| `BKM_ENVIRONMENT=production` | `PAYMENT_PROVIDER=mercadopago` | Ambiente production, credenciais, habilitação e `MERCADO_PAGO_PRODUCTION_APPROVED=true` | Somente após autorização e homologação |

Credenciais isoladas não ativam o gateway. `paymentReadiness(env)` retorna apenas estado, nomes de variáveis ausentes e explicação, sem segredos. `HOSTING_DEMO_ONLY=true` bloqueia Mercado Pago, inclusive sandbox, independentemente das demais variáveis: a demonstração hospedada no Vercel Hobby permanece sem transações externas. Uma operação comercial precisa primeiro de hospedagem elegível. O mock é recusado fora de `demo`, mesmo que `NODE_ENV=production` seja usado para compilar a demonstração.

Variáveis: `BKM_ENVIRONMENT`, `PAYMENT_PROVIDER`, `MERCADO_PAGO_ENVIRONMENT`, `MERCADO_PAGO_ENABLED`, `MERCADO_PAGO_PRODUCTION_APPROVED`, `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_PUBLIC_KEY`, `MERCADO_PAGO_WEBHOOK_SECRET`, `MERCADO_PAGO_SELLER_ID` e `BKM_PUBLIC_URL`. Valores sensíveis pertencem ao painel do serviço ou `.env` local ignorado pelo Git. O prefixo do token não comprova ambiente; a [documentação de contas de teste](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/resources/test-accounts) também utiliza credenciais `APP_USR`.

## Contrato usado pelo backend

```js
const provider = createPaymentProvider({ env });
const payment = await provider.createPayment({
  orderId, amountCents, currency: 'BRL', idempotencyKey,
  outcome: 'pending' // somente mock
});
const event = await provider.simulatePayment({ payment, outcome: 'approved' });
```

Resultado comum: `{id,provider,demo,status,orderId,amountCents,currency,eventId,occurredAt}`. O mock acrescenta `expiresAt` e rótulo obrigatório de simulação. Resultados: `APPROVED`, `PENDING`, `REJECTED`, `CANCELLED`, `EXPIRED`. Transições após um estado terminal são recusadas. Não há Pix fictício, captura financeira ou envio externo. O backend deve persistir eventos e histórico, aplicar estoque em transação e recusar eventos duplicados; a função pura do provedor não substitui esses controles.

`idempotencyKeyForOrder(orderId,attemptId)` gera chave estável por tentativa. Uma repetição reutiliza a mesma tentativa e o mesmo conteúdo. Uma nova tentativa financeira requer identificação própria persistida, nunca uma chave gerada automaticamente como reação a um timeout.

## Mercado Pago preparado

O adapter utiliza a **Orders API atual**. `createPayment` aceita `method:'pix'` ou `method:'card'`, pagador e valor do pedido. A criação usa `POST https://api.mercadopago.com/v1/orders`, processamento automático e `X-Idempotency-Key`. Valores são strings decimais exatas. O [contrato de criação](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/create-order/post) contempla HTTP 402 com uma order existente. Obtido o ID, o adapter sempre consulta `GET /v1/orders/{id}` para validar conta, referência e valores; o exemplo de criação não garante todos os campos da conta. Falha nessa confirmação conserva o ID e exige reconciliação, sem outra criação.

Para Pix, o pedido contém `id:'pix'`, `type:'bank_transfer'` e expiração de 30 minutos; o adapter expõe apenas o código real devolvido pelo provedor em `pix.copyPaste`. A demonstração nunca percorre esse caminho. A [documentação Pix](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/payment-integration/websites/pix) descreve esse fluxo e a necessidade de configuração da conta. No sandbox, o código exige pagador `@testuser.com` criado no Mercado Pago.

Para cartão, o servidor aceita somente um token do SDK, bandeira, tipo e parcelas: `card:{token,paymentMethodId,type,installments}`. PAN e CVV não pertencem aos modelos nem ao armazenamento da BKM. O [Card Payment Brick oficial](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/payment-integration/websites/cards) produz o token no navegador; `getAdditionalData` ocorre depois de `getFormData`, conforme o [contrato do controller](https://www.mercadopago.com.br/developers/en/docs/checkout-bricks/card-payment-brick/advanced-features/additional-data). O token é usado na requisição e omitido da persistência e das respostas. A ativação depende de validar o formulário, as URLs e as credenciais reais em sandbox.

`getPayment(paymentId,expected)` exige ID persistido, referência, vendedor configurado, Brasil, BRL quando fornecida e valor exato. A aprovação requer status acreditado, total bruto integral e valor bruto da única transação também acreditada. `paid_amount` da transação pode representar repasse líquido de taxas; ele não é usado como total bruto do pedido. Outros estados preservam pendência, recusa, cancelamento, expiração, reembolso ou revisão. Referências: [consulta de order](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/get-order/get), [estados oficiais](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/payment-management/status/order-status).

## Webhooks, reconciliação e falhas

`verifyWebhookSignature` valida HMAC SHA-256 em tempo constante, campos únicos, timestamp e manifesto com `data.id` em minúsculas. `data.id` deve vir exclusivamente da query da URL, com `x-signature` e `x-request-id`. A tolerância local é de dez minutos; é política da aplicação e deve ser conferida com os reenvios sandbox.

`reconcileWebhook({signature,requestId,dataId,expected})` autentica e consulta o recurso remoto; o corpo não confirma estado financeiro. Retorna `replayKey`, evento comercial estável e pagamento verificado. O serviço persistente pode recuperar uma criação inconclusiva pela referência devolvida nessa consulta, inclusive quando o cliente não recebeu o ID. Referência: [notificações Orders](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/notifications).

`server/payment-service.cjs` mantém a tentativa no banco antes do acesso externo. `createMercadoPagoService` expõe `preparePayment`, `createPayment`, `reconcile` e `webhook`; a preparação ocorre na mesma transação de pedido e reserva, sem acesso à rede. Cada tentativa conserva seu ambiente sandbox ou production; trocar as variáveis posteriormente não converte uma tentativa de teste em cobrança real. O backend conecta checkout, consulta do titular e reconciliação administrativa. O endpoint público `POST /api/payments/webhook/mercadopago?data.id=ORD...&type=order` exige HMAC e ID único da query, sem exigir sessão de navegador ou CSRF. Rotas de cliente e administrador exigem sessão, CSRF e propriedade ou papel administrativo.

A transação de confirmação bloqueia pedido, tentativa e variantes em ordem estável. Eventos comerciais e recibos são únicos. Estoque e cupom baixam uma vez, junto do histórico e da outbox; notificações antigas e aprovação depois de reembolso não repetem a baixa. Aprovação tardia sem reserva válida ou com cupom esgotado preserva o fato financeiro em `PAYMENT_REVIEW`, libera a reserva e exige resolução administrativa antes de envio. Reembolsos não repõem automaticamente mercadoria que pode ter sido enviada. Falha local depois da criação ou uma resposta inválida mantêm a tentativa inconclusiva; nenhum desses casos é tratado como recusa definitiva para criar outra cobrança.

O transporte tem origem HTTPS fixa, redirecionamentos recusados, timeout de oito segundos e corpo limitado a 1 MiB. Falhas retornam erros sanitizados sem payloads ou credenciais. 423, 429 e 5xx indicam possibilidade de retry com `retryAfterMs`; timeout, falha de rede e conflito 409 na criação exigem reconciliação antes de prosseguir. Não há retry automático de cobrança com chave nova. O agendador deve respeitar o intervalo informado e reutilizar a tentativa persistida.

Os 13 testes de adapter substituem o transporte e cobrem HMAC, adulteração, janela temporal, idempotência, ambientes, mock, valores, Pix/cartão, 402, consulta e falhas. `payment-service.test.cjs` acrescenta onze cenários em cada um dos bancos SQLite e PostgreSQL embarcado PGlite: confirmações e repetições, duas submissões sobrepostas, ambiente persistido, retorno inconclusivo, recuperação por webhook, rollback financeiro/estoque/outbox, aprovação tardia, cupom, vendedor/valor incompatíveis, reembolso e leases de e-mail. A suíte HTTP `tests/mercadopago-api.test.cjs` verifica permissões e integração das rotas. PGlite verifica o SQL e as transações PostgreSQL; não substitui um teste de carga com conexões independentes no Supabase. Não houve cobrança externa, nem homologação da conta Mercado Pago.

---

# E-mails transacionais — desenvolvimento e Resend

`server/email.cjs` exporta `EmailProvider`, `DevelopmentEmailProvider`, `ResendEmailProvider`, `createEmailProvider`, `renderEmail`, `emailReadiness` e `createEmailDispatcher`. Não foi enviado e-mail externo nesta execução.

## Templates e modo seguro

Modelos: `welcome`, `order-confirmation`, `payment-approved`, `payment-rejected`, `order-shipped`, `tracking-update`, `password-reset`. Todos incluem logo fornecida, preto/vermelho/ciano/prata, versão em texto e HTML, links da loja e resumo do pedido quando aplicável. Dados variáveis são escapados e limitados; links de conta/recuperação ficam na origem configurada. A recuperação usa token de uso único de 30 minutos gerado pelo backend.

`BKM_ENVIRONMENT=demo` ou `HOSTING_DEMO_ONLY=true` força `DevelopmentEmailProvider`, mesmo se houver configuração Resend. Ele não utiliza rede nem grava arquivos públicos. Retorna uma prévia para armazenamento privado na outbox, com destinatário mascarado. Tokens de recuperação são omitidos da prévia. Todos os templates de demonstração levam aviso no assunto e no conteúdo; nenhum resultado simulado pode disparar e-mail comercial pelo adapter Resend.

Contrato de dados dos templates: `customerName`, `orderNumber`, `orderId`, `orderUrl`, `items:[{name,quantity,priceCents,subtotalCents}]`, `subtotalCents`, `discountCents`, `shippingCents`, `totalCents`, `trackingCode`, `trackingUrl`, `resetUrl`, `storeName`, `storeContact`, `demo`.

## Ativação futura

O envio externo exige `EMAIL_PROVIDER=resend`, ambiente `staging` ou `production`, `RESEND_ENABLED=true`, `RESEND_DOMAIN_VERIFIED=true`, `RESEND_API_KEY` e `RESEND_FROM` válido em domínio efetivamente verificado no painel. O flag da aplicação não verifica DNS por conta própria; o domínio precisa passar pela [verificação do Resend](https://resend.com/docs/dashboard/domains/introduction). `BKM_PUBLIC_URL` define links e URL absoluta da logo. A chave fica somente no servidor.

O adapter envia `POST https://api.resend.com/emails`, texto/HTML e cabeçalho de idempotência estável. A resposta confirma **aceitação pela API**, não entrega na caixa do destinatário. Timeout e respostas são limitados; 429/5xx permitem retry, erros permanentes encerram o item. Erros não expõem chave, destinatário, token ou corpo do provedor. Referência: [Send Email](https://resend.com/docs/api-reference/emails/send-email).

## Outbox e reenvio

O backend persiste o evento na mesma transação do evento de negócio, usando `key` única. `createEmailDispatcher({store,env,provider})` trabalha com o store de banco, sem depender de timers que desaparecem em serverless:

- `enqueue({key,template,to,data},tx?)` persiste uma vez, devolve o ID existente e recusa reutilização da chave com conteúdo diferente.
- `claimDue({limit,now,leaseUntil})` obtém lote atomicamente e registra tentativas/lease. Cada retorno inclui a prova da tentativa; um worker antigo não pode concluir ou sobrescrever uma tentativa reatribuída.
- `complete(id,{providerId,preview,now})` registra aceitação ou prévia privada.
- `retry(id,{attempts,nextAttemptAt,errorCode})` agenda backoff exponencial com jitter e respeita `Retry-After`.
- `fail(id,{errorCode})` encerra erro permanente ou seis tentativas; operação administrativa pode reavaliar e reenfileirar com segurança.

O dispatcher processa cinco mensagens por chamada. O backend deve acioná-lo em requisições autorizadas ou por agendador compatível com o plano, sem depender de um processo residente. A [idempotência Resend](https://resend.com/docs/dashboard/emails/idempotency-keys) dura 24 horas; por isso uma tentativa ambígua com mais de 23 horas é interrompida para reconciliação manual, em vez de correr o risco de duplicar um e-mail. A chave persistida permanece a mesma em todos os retries. A unicidade local e o histórico continuam sendo necessários mesmo com deduplicação do provedor.

Sete testes locais cobrem identidade e escape dos templates, links inseguros, tokens omitidos, ausência de envio em demo, gates de configuração, aceitação API, erro/timeout, idempotência, backoff, limite de tentativas e encerramento da janela segura. Os testes de backend validam a persistência da fila e dos eventos de negócio separadamente.

Documentação oficial consultada em 15/10/2026. Ativação final de Mercado Pago e Resend exige credenciais privadas, configuração nos painéis e homologação externa; os adapters e o fluxo demonstrativo não dependem dessas chaves.
