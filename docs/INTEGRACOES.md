# Integrações — BKM TCG Fase 3

Estado em **21/10/2026**: revisão de resumos persistidos e consumidor independente publicada no [commit `0f8388a`](https://github.com/zKaminise/BKM-TCG/commit/0f8388a450ae3a4485d2f48c67e9e1802cb87643), com **260 testes**, sintaxe e build aprovados e [CI 39579166466 com sucesso](https://github.com/zKaminise/BKM-TCG/actions/runs/39579166466). Deployments Success: principal `6zQ4yMe3sWHjaFwFKdXSZodhq1bv` e sandbox `F8P43oDZD5ucUF7XeHZhw2MpycEN`. Cron registrado como Enabled; chave Production, execução autenticada e entrega real de alerta/resumo ainda pendentes. Resend tem prova controlada de envio/entrega de recuperação; Google, de vínculo explícito, novo login na mesma conta e publicação básica Externo/Em produção; Mercado Pago, de Pix sandbox aprovado e expirado, com callbacks oficiais HTTP 200 e recibos autenticados. Cartão e demais cenários financeiros ainda precisam de validação. Evidências e limites em [VALIDACAO.md](VALIDACAO.md).

O Supabase **BKM ecommerce** (`cxoeompxmgdzufgzxerw`) é agora o principal. A migração transferiu **40 tabelas, 230 registros e 2 objetos Storage**, com SHA-256, integridade e origem inalterada conferidos. Após a migration **008**, a leitura PostgreSQL de principal e sandbox confirmou **41 tabelas, 41 com RLS, zero grants públicos e zero eventos de resumo pendentes** no momento da consulta. A auditoria do cutover havia encontrado 3 usuários, 4 pedidos e as 2 referências de imagens apontando ao novo Storage, sem referência persistida ao antigo.

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

Notificações internas são persistidas e deduplicadas. Alertas por e-mail precisam de consentimento global e específico, regras de frequência e provedor disponível. A migration 008 publicada persiste eventos de resumos e permite consolidação por titular, sem perder ocorrências por simples limitação de frequência. Cada lote considera até 50 eventos e revalida titularidade, desejo atual, consentimento, supressão, anúncio, variante, preço e estoque. Eventos fora do lote permanecem pendentes. Marketing, preços e carrinho possuem preferências separadas; carrinho abandonado permanece sem automação ativa.

O diário fecha às **12:00 UTC (09:00 BRT)** e o semanal, **segunda-feira às 12:00 UTC**. O consumidor independente `/api/jobs/email` exige Bearer com `CRON_SECRET` privado e comparação em tempo constante, processa até 5 titulares e consome até 20 mensagens em janela de 40 segundos. O cron diário está registrado como Enabled. Um disparo manual do painel chegou à função e recebeu **401 `JOB_UNAUTHORIZED`**, sem chave, comprovando rota e guard; isso não comprova execução autorizada nem envio. A chave Production e a execução autenticada ainda estão pendentes. A fila permanece no banco e não exige processo residente. O Hobby tem precisão de hora e pode deixar backlog: essa frequência não é SLA de operação comercial. Configuração e fontes oficiais em [DEPLOY.md](DEPLOY.md).

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

Os templates de desejos exibem nome, coleção, idioma, variante, preço BRL e link elegível, com escape e revalidação dos dados atuais. A suíte local cobre esses modelos; **não há ainda prova de `DELIVERED` real para alerta ou resumo de desejos**. Respostas ambíguas de envio com mais de 23 horas são bloqueadas para reconciliação manual, preservando a proteção contra duplicação fora da janela segura de idempotência do provedor.

Na primeira tentativa de um resumo, `prepareDigest` retira somente os itens que perderam elegibilidade, conserva os válidos e persiste o payload antes de chamar o provedor. Essa preparação exige o claim atual e lease vigente; um worker vencido não pode alterar o resumo. Os retries conservam o payload preparado sob a mesma chave idempotente, sem incorporar alterações posteriores de conteúdo; consentimento e disponibilidade ainda podem bloquear o envio.

As chaves foram armazenadas privadamente e configuradas nas variáveis Production. Em 20/10, um único teste de recuperação para a conta existente do titular confirmou `SENT` e `DELIVERED` por webhook Svix assinado com HTTP 200. Repetir o mesmo evento retornou 200 sem duplicação nem novo envio. A conta e sua senha permaneceram inalteradas; essa evidência comprova envio, entrega e idempotência do evento, não o fluxo completo de redefinição ou todos os modelos de e-mail.

Na Vercel, manter **`NODEJS_HELPERS=0` no ambiente Production** e fazer novo deployment após alterar a variável. Essa configuração corrigiu o acesso ao corpo bruto usado pela validação Svix nesta implantação, sem remover a assinatura. A [documentação oficial de configuração avançada Node.js](https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration) descreve como desativar os helpers por essa variável.

A redefinição completa pelo link, invalidação de sessões e os demais tipos de envio ainda exigem sua própria prova. Não registrar segredo, token de recuperação ou corpo sensível em documentação. Referências: [domínios](https://resend.com/docs/dashboard/domains/introduction), [envio](https://resend.com/docs/api-reference/emails/send-email), [webhooks](https://resend.com/docs/webhooks/introduction), [idempotência](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Mercado Pago: sandbox real e isolamento

`server/payments.cjs` e `server/payment-service.cjs` separam mock e Orders API. A aplicação calcula valores no servidor, persiste pedido/reserva/tentativa antes de acesso externo e conserva a chave idempotente. Cartão utiliza token do SDK; PAN e CVV não são enviados ao backend BKM. Pix depende exclusivamente do código real devolvido pelo provedor, sem QR fictício.

Webhooks exigem HMAC integral e consulta remota autoritativa; o corpo recebido não confirma pagamento por si só. A validação aceita o manifesto com ID exato da query ou sua forma canônica em minúsculas, comparando ambos em tempo constante e mantendo um replay unificado. Query única, janela temporal e validações de vendedor, moeda, total e referência permanecem obrigatórias. Confirmação, repetição, recusa, expiração, aprovação tardia, reembolso e reconciliação preservam regras transacionais de estoque/cupom/histórico. Timeout ou resposta inconclusiva não cria nova cobrança automaticamente.

A instalação principal permanece `PAYMENT_PROVIDER=mock`, com produção financeira desativada. O projeto Vercel **`bkm-tcg-sandbox`**, no Hobby, tem deployment Success **`F8P43oDZD5ucUF7XeHZhw2MpycEN`** e banco Supabase separado **`secapcqqznlokiqhojsa`**, com **TLS verificado** e **41 tabelas no esquema 8**. Antes da fixture, usuários/produtos/pedidos eram 0. A execução real de `--verify` confirmou `/users/me` como vendedor de teste e `/api/config` em staging/sandbox, com `canCharge=false`. As chaves permanecem privadas. O CLI bloqueia tanto a referência principal antiga (`nxrvmanifngjmdtgnzoq`) quanto a nova (`cxoeompxmgdzufgzxerw`).

O `--run` real criou **2 orders Pix de teste de R$ 50,00 nominais cada**. O cenário `APRO` foi aprovado; o segundo foi inicialmente confirmado `PENDING`, com essa prova histórica preservada. Na conferência final do provedor e do banco, a primeira continuava **APPROVED**, com reserva **COMMITTED**, e a segunda estava **EXPIRED**, com reserva **RELEASED**. O simulador oficial notificou os mesmos IDs com **HTTP 200**; foram conferidos **2 recibos autenticados por order**, 2 pedidos no total e uma única baixa de estoque **2 → 1**. A idempotência previamente comprovada foi mantida. Nenhum pagamento comercial ou transferência bancária real foi realizado, e o principal foi preservado.

**Callbacks oficiais dos dois cenários Pix sandbox comprovados.** O diagnóstico confirmou que o emissor assinava o ID exato da query, incompatível com a validação anterior somente em minúsculas. A correção no commit `e07241b` foi publicada e os callbacks aprovados foram confrontados com os recursos verdadeiros e recibos persistidos. A evidência final de **`2026-10-21T01:31:42.569Z` (20/10 às 22:31 BRT)** está em `backups/mp-sandbox-final-evidence.json`, com **`observedScenariosConfirmed=true`**. O relatório inicial com `webhookProven=false` e o snapshot `backups/mp-sandbox-before-signature-rotation.json` continuam históricos e não foram reescritos. A cronologia e os limites estão em [HOMOLOGACAO-MP.md](HOMOLOGACAO-MP.md).

Credenciais isoladas não ativam produção. Não liberar a flag de aprovação comercial nem mudar o banco principal para executar testes financeiros externos. Cartão pelo SDK, recusa, cancelamento, reembolso e demais cenários ainda exigem provas próprias. Pix aprovado, pendência histórica, expiração, callbacks e idempotência comprovados no sandbox não constituem homologação financeira completa. Referências: [Orders API](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/create-order/post), [contas de teste](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/resources/test-accounts), [notificações](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/notifications).

## Logística e backups

`server/shipping-provider.cjs` consulta somente cotação e status de etiquetas já existentes no sandbox Melhor Envio. Origem fixa, validação de CEP/medidas/BRL, limites e timeout foram testados em 11 cenários com transporte controlado. Falta chave e homologação; o adaptador não está conectado ao checkout e não possui compra de etiquetas. Comparação de provedores: [LOGISTICA.md](LOGISTICA.md).

O backup manual exporta PostgreSQL e objetos Storage, verifica hashes e cifra com AES-256-GCM. A última cópia comprovada, após a migration 008, contém **41 tabelas, 199 registros e 2 objetos**, restaurados em SQLite novo e isolado com integridade `ok` e `remoteTarget=false`. Os snapshots anteriores de 233 e 244 registros e a migração de 230 permanecem preservados; contagens variam com o uso e a expiração de sessões. Não houve restauração no banco remoto. Chave, conteúdo e restaurações são privados e não entram em Git/ZIP público. Não há agendamento ou exclusão automática de cópias. Hashes e procedimento: [BACKUP.md](BACKUP.md).

## Manutenção temporária no cutover

`BKM_MAINTENANCE_MODE=true` bloqueia toda a API antes da inicialização do banco, com HTTP 503 e `Retry-After: 60`, para futuras manutenções. O cutover desta etapa foi encerrado com **`BKM_MAINTENANCE_MODE=false` em Production** e HTTP 200 confirmado no novo principal. A prova dos fluxos externos permanece delimitada nas seções acima.
