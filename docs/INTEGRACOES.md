# Integrações — BKM TCG Fase 3

Estado em **20/10/2026**: núcleo da Fase 3 publicado em `https://lojabkm.com.br`, [commit `d109af2`](https://github.com/zKaminise/BKM-TCG/commit/d109af2), deployment Ready e [CI histórico com 211 testes aprovado](https://github.com/zKaminise/BKM-TCG/actions/runs/39399711168). A rodada local posterior aprovou **213 testes**, sintaxe e build. O principal foi migrado e voltou a HTTP 200. Resend tem prova controlada de envio/entrega; Google, de vínculo explícito, novo login na mesma conta e publicação básica Externo/Em produção; o sandbox Mercado Pago, de Pix aprovado por reconciliação e outro pendente. Webhook financeiro e demais caminhos ainda precisam de validação. Evidências e limites em [VALIDACAO.md](VALIDACAO.md).

O Supabase **BKM ecommerce** (`cxoeompxmgdzufgzxerw`) é agora o principal. A migração transferiu **40 tabelas, 230 registros e 2 objetos Storage**, com SHA-256, integridade e origem inalterada conferidos. As migrations **1–7** estão aplicadas, com **RLS nas 40 tabelas** e nenhum grant de tabelas para `anon`, `authenticated` ou `PUBLIC`. A auditoria encontrou 3 usuários, 4 pedidos e as 2 referências de imagens apontando ao novo Storage, sem referência persistida ao antigo.

As conexões de banco e Storage da Vercel Production e o `.env` local foram atualizados privadamente; o banco anterior (`nxrvmanifngjmdtgnzoq`) e o `.env.old-main` permanecem preservados. Com a manutenção encerrada, `/api/config` confirmou demo, mock, `canCharge=false` e Google habilitado; o catálogo tinha 15 produtos no momento da consulta. A homologação financeira usa infraestrutura separada.

## TCGdex: identidade, checklist e cobertura

`server/catalog.cjs` fornece a importação administrativa; `server/personal-collection.cjs` utiliza referências persistidas/cacheadas para o fichário privado. A fonte é `https://api.tcgdex.net/v2`, com imagens HTTPS de `assets.tcgdex.net`. Não há scraping de páginas ou endpoint externo definido pelo navegador.

A identidade considera provedor, idioma, coleção e número. O importador comercial confere o número no checklist genuíno antes de buscar os detalhes. IDs regionais, zeros à esquerda e numerações alfanuméricas são tratados sem equiparar coleções apenas pelo nome. O identificador comercial tem formato `tcgdex:idioma:providerId`; a coleção pessoal conserva a identidade e o idioma de referência.

Metadados não representam preço, condição física, posse ou estoque. Produtos públicos vêm dos anúncios persistidos. O fichário pode mostrar cartas nunca anunciadas pela BKM. Objetivos básicos usam a numeração principal; personalizados incluem secretas e variantes escolhidas. Duplicatas/versões ficam em lotes separados.

A cobertura varia por região e idioma. Listas resumidas da TCGdex nem sempre incluem raridade; detalhes são obtidos de forma limitada/cacheada, sem consulta massiva de todo o catálogo a cada página. Campos ausentes não são inventados. Fotos pessoais são URLs HTTPS do titular, sem upload privado nesta etapa.

Os testes históricos de 15/10 consultaram listagens PT/EN/JA e cartas por identidade, inclusive imagens ausentes e coleções vazias. Essas observações não garantem cobertura atual completa. Referências: [REST](https://tcgdex.dev/rest), [coleções](https://tcgdex.dev/rest/sets), [detalhe da carta](https://tcgdex.dev/rest/card), [assets](https://tcgdex.dev/assets), [licenças do projeto](https://github.com/tcgdex/cards-database#licenses). Direitos sobre ilustrações e marcas devem ser avaliados para a operação comercial.

## APIs pessoais e privacidade

A base autenticada `/api/account/collection` inclui resumo, catálogos de referência, fichários, checklist, lotes, desejos, preferências, notificações, referências privadas de preço e importação/exportação CSV. Escritas exigem CSRF; o servidor verifica titularidade. Alterar um ID não concede acesso a registros de outra conta.

Pedidos, estoque comercial e cartas possuídas são conceitos separados. Adicionar um lote pessoal não altera o anúncio. Compra ou aprovação de pagamento não marca a carta como recebida. Preferências de idioma, condição, variante, preço máximo e flexibilidade controlam a correspondência dos desejos com anúncios publicados e disponíveis.

Notificações internas são persistidas e deduplicadas. Alertas por e-mail precisam de consentimento global e específico, regras de frequência e provedor disponível. Marketing, preços e carrinho possuem preferências separadas; carrinho abandonado permanece sem automação ativa. A fila não depende de manter um processo em memória continuamente na Vercel.

## Preços privados e referências globais autorizadas

`server/market-price-provider.cjs` implementa o conjunto global manual, separado das referências privadas dos clientes. `/api/admin/market-prices` lista provedores e referências autorizadas. A importação usa `/import/preview` e `/import/confirm`: identidade validada, moeda BRL, preço unitário em centavos, fonte, data, erros, duplicatas e confirmação explícita de direitos. O token da prévia é privado, expira e permite confirmação idempotente.

O painel não exibe valores privados dos clientes. O conjunto global está **vazio** neste marco. Os cálculos usam apenas referências conhecidas elegíveis e exibem cobertura, valores ausentes e desatualização. Custos informados não são lucro realizado. Histórico mostra dados registrados e snapshots reais; mudanças de quantidade ou cobertura também afetam o total.

Nenhuma API licenciada da Liga Pokémon foi configurada. Não foi estabelecida autorização para consulta automatizada; bloqueios encontrados não foram contornados. Valor manual não recebe rótulo de cotação oficial, mediana automática ou venda concluída. Alternativas e limites: [PRECOS.md](PRECOS.md).

## Domínio, autenticação própria e Google

`server/domain-policy.cjs` centraliza o domínio oficial e aliases legitimamente possuídos. Não há wildcard de previews nem relaxamento de CSRF. O domínio raiz é canônico e `www` já foi configurado para redirecionar por 308. O núcleo novo já está publicado; a prova completa dos fluxos por ambas as entradas continua parte do QA.

A autenticação BKM existente continua com scrypt, sessão persistida por hash, cookie HttpOnly/SameSite/Secure em HTTPS, CSRF e RBAC. Não foi criado um segundo sistema de contas no Supabase Auth.

`server/google-auth.cjs` implementa Authorization Code OIDC, PKCE, state vinculado à sessão, nonce, validação de assinatura/chaves e claims no servidor, consumo único do estado e retorno restrito a caminhos locais seguros. O callback é `/api/auth/google/callback`, derivado de `BKM_PUBLIC_URL`. A interface só oferece Google quando a configuração pública informa readiness.

Nova identidade Google cria cliente, nunca administrador. Se o e-mail já pertence a uma conta BKM sem vínculo, o usuário precisa entrar nessa conta e vincular Google autenticado; não há associação silenciosa baseada apenas no e-mail do navegador. Contas administrativas mantêm o acesso BKM. Dados, pedidos, coleção e desejos permanecem associados ao usuário existente após vínculo legítimo.

Cliente/segredo foram guardados privadamente e configurados nas variáveis Production. O consentimento/callback controlado retornou inicialmente **`link-required`** para a conta BKM já existente do titular. O titular então autenticou essa conta BKM, confirmou o vínculo explícito, saiu e entrou novamente pelo Google na **mesma conta**, sem associação automática por e-mail. Foram observadas 0 coleções nessa conta, portanto o teste não comprova preservação de acervo preenchido. A audiência do aplicativo foi publicada e a UI confirmou **Externo / Em produção**, com opção de voltar para teste. São usados apenas os scopes básicos `openid`, `email` e `profile`, sem Gmail/Drive. Essa publicação não representa verificação avançada Google nem ausência de limites. Cadastro novo, cancelamento e demais caminhos continuam pendentes; o fluxo controlado não encerra a homologação OAuth em geral. Referências: [OIDC Google](https://developers.google.com/identity/openid-connect/openid-connect), [OAuth para servidor web](https://developers.google.com/identity/protocols/oauth2/web-server).

## Resend, recuperação e eventos de entrega

`server/email.cjs`, `server/email-store.cjs` e `server/email-notifications.cjs` mantêm templates, outbox, idempotência, tentativas com lease, backoff e integração de eventos. Modelos incluem boas-vindas, verificação, recuperação, pedidos e estados financeiros/logísticos, desejos, resumo e preparação de carrinho. A existência de um modelo não implica que toda automação esteja ativada.

Recuperação utiliza token aleatório de uso único, hash persistido, expiração, respostas sem enumeração e links na origem canônica. A redefinição invalida sessões conforme a política. Contas exclusivamente Google recebem tratamento próprio; a interface não promete uma definição local de senha indisponível.

Prévias de desenvolvimento ficam privadas, com destinatários mascarados e tokens omitidos. A exceção de teste controlado em demo exige `RESEND_DEMO_TEST_ENABLED`, destinatários exatos em `RESEND_TEST_RECIPIENTS`, domínio/remetente verificados e todos os gates Resend. Isso não habilita campanhas ou pagamentos. Alertas de desejos seguem também seus consentimentos.

O envio usa a API oficial com idempotência. Aceitação da API é distinta de entrega. O endpoint `/api/email/webhook/resend` exige corpo bruto e valida Svix por ID, timestamp e assinatura; o JSON só é interpretado depois da validação. Eventos são persistidos/deduplicados e mantêm estados como aceito, entregue, adiado, devolvido, reclamação e falha. Não interpretar `SENT` local como entrega confirmada na caixa postal.

As chaves foram armazenadas privadamente e configuradas nas variáveis Production. Em 20/10, um único teste de recuperação para a conta existente do titular confirmou `SENT` e `DELIVERED` por webhook Svix assinado com HTTP 200. Repetir o mesmo evento retornou 200 sem duplicação nem novo envio. A conta e sua senha permaneceram inalteradas; essa evidência comprova envio, entrega e idempotência do evento, não o fluxo completo de redefinição ou todos os modelos de e-mail.

Na Vercel, manter **`NODEJS_HELPERS=0` no ambiente Production** e fazer novo deployment após alterar a variável. Essa configuração corrigiu o acesso ao corpo bruto usado pela validação Svix nesta implantação, sem remover a assinatura. A [documentação oficial de configuração avançada Node.js](https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration) descreve como desativar os helpers por essa variável.

A redefinição completa pelo link, invalidação de sessões e os demais tipos de envio ainda exigem sua própria prova. Não registrar segredo, token de recuperação ou corpo sensível em documentação. Referências: [domínios](https://resend.com/docs/dashboard/domains/introduction), [envio](https://resend.com/docs/api-reference/emails/send-email), [webhooks](https://resend.com/docs/webhooks/introduction), [idempotência](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Mercado Pago: sandbox real e isolamento

`server/payments.cjs` e `server/payment-service.cjs` separam mock e Orders API. A aplicação calcula valores no servidor, persiste pedido/reserva/tentativa antes de acesso externo e conserva a chave idempotente. Cartão utiliza token do SDK; PAN e CVV não são enviados ao backend BKM. Pix depende exclusivamente do código real devolvido pelo provedor, sem QR fictício.

Webhooks exigem HMAC e consulta remota autoritativa; o corpo recebido não confirma pagamento por si só. Confirmação, repetição, recusa, expiração, aprovação tardia, reembolso e reconciliação preservam regras transacionais de estoque/cupom/histórico. Timeout ou resposta inconclusiva não cria nova cobrança automaticamente.

A instalação principal permanece `PAYMENT_PROVIDER=mock`, com produção financeira desativada. O projeto Vercel **`bkm-tcg-sandbox`**, no Hobby, tem deployment Ready **`35ZhSh55MLGoEqW9BEaaBFLxd3pT`** e banco Supabase separado **`secapcqqznlokiqhojsa`**, com **TLS verificado** e **40 tabelas**. Antes da fixture, usuários/produtos/pedidos eram 0. A execução real de `--verify` confirmou `/users/me` como vendedor de teste e `/api/config` em staging/sandbox, com `canCharge=false`. As chaves permanecem privadas. O CLI bloqueia tanto a referência principal antiga (`nxrvmanifngjmdtgnzoq`) quanto a nova (`cxoeompxmgdzufgzxerw`).

O `--run` real criou **2 orders Pix de teste de R$ 50,00 nominais cada**. O cenário `APRO` foi confirmado `APPROVED` no provedor e aplicado por reconciliação; o segundo retornou `PENDING`. A prova registrou **1 reserva `COMMITTED`, 1 `ACTIVE`, estoque 2 → 1 uma única vez e idempotência aprovada**. Nenhum pagamento comercial ou transferência bancária real foi realizado, e o principal foi preservado.

**Entrega de webhook não comprovada (`webhookProven=false`).** O GET da order informa aplicação emissora **`8997426787542730`**, diferente da aplicação configurada no painel **`3540436696764388`**, onde foram salvas URLs, tópico Orders e HMAC. A divergência é um fato observado; relação entre as aplicações e causa da ausência de webhook são hipóteses ainda não confirmadas. Falta conferir a aplicação associada à credencial e a configuração correspondente com o titular autenticado/MFA, depois provar notificação legítima, assinatura e repetição. Reconciliação não substitui essa prova.

Credenciais isoladas não ativam produção. Não liberar a flag de aprovação comercial nem mudar o banco principal para executar testes financeiros externos. Cartão pelo SDK, recusa, expiração, cancelamento, reembolso e entrega/reenvio de webhook ainda exigem provas próprias. Os dois cenários Pix e a idempotência acima não constituem homologação financeira completa. Referências: [Orders API](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/create-order/post), [contas de teste](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/resources/test-accounts), [notificações](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/notifications).

## Logística e backups

`server/shipping-provider.cjs` consulta somente cotação e status de etiquetas já existentes no sandbox Melhor Envio. Origem fixa, validação de CEP/medidas/BRL, limites e timeout foram testados em 11 cenários com transporte controlado. Falta chave e homologação; o adaptador não está conectado ao checkout e não possui compra de etiquetas. Comparação de provedores: [LOGISTICA.md](LOGISTICA.md).

O backup manual exporta PostgreSQL e objetos Storage, verifica hashes e cifra com AES-256-GCM. Após o cutover, o novo principal gerou backup de **40 tabelas, 233 registros e 2 objetos**, restaurado em SQLite novo e isolado com integridade `ok`, zero violações de chave estrangeira e hashes conferidos. Os 233 registros representam um snapshot posterior aos 230 da migração. Não houve restauração no banco remoto. Chave, conteúdo e restauração são privados e não entram em Git/ZIP público. Não há agendamento ou exclusão automática de cópias. Hash e procedimento: [BACKUP.md](BACKUP.md).

## Manutenção temporária no cutover

`BKM_MAINTENANCE_MODE=true` bloqueia toda a API antes da inicialização do banco, com HTTP 503 e `Retry-After: 60`, para futuras manutenções. O cutover desta etapa foi encerrado com **`BKM_MAINTENANCE_MODE=false` em Production** e HTTP 200 confirmado no novo principal. A prova dos fluxos externos permanece delimitada nas seções acima.
