# Integrações — BKM TCG Fase 3

Estado em **20/10/2026, antes do deploy da Fase 3**. Código implementado e testes automatizados não substituem homologação externa. O domínio canônico é `https://lojabkm.com.br`; a publicação e suas evidências finais serão registradas em [VALIDACAO.md](VALIDACAO.md).

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

`server/domain-policy.cjs` centraliza o domínio oficial e aliases legitimamente possuídos. Não há wildcard de previews nem relaxamento de CSRF. O domínio raiz é canônico e `www` já foi configurado para redirecionar por 308. O código novo ainda precisa da prova pós-deploy dos fluxos por ambas as entradas.

A autenticação BKM existente continua com scrypt, sessão persistida por hash, cookie HttpOnly/SameSite/Secure em HTTPS, CSRF e RBAC. Não foi criado um segundo sistema de contas no Supabase Auth.

`server/google-auth.cjs` implementa Authorization Code OIDC, PKCE, state vinculado à sessão, nonce, validação de assinatura/chaves e claims no servidor, consumo único do estado e retorno restrito a caminhos locais seguros. O callback é `/api/auth/google/callback`, derivado de `BKM_PUBLIC_URL`. A interface só oferece Google quando a configuração pública informa readiness.

Nova identidade Google cria cliente, nunca administrador. Se o e-mail já pertence a uma conta BKM sem vínculo, o usuário precisa entrar nessa conta e vincular Google autenticado; não há associação silenciosa baseada apenas no e-mail do navegador. Contas administrativas mantêm o acesso BKM. Dados, pedidos, coleção e desejos permanecem associados ao usuário existente após vínculo legítimo.

Cliente/segredo foram guardados privadamente e configurados nas variáveis Production. O fluxo real Google — consentimento, callback, cadastro, retorno e vínculo — continua **pendente de homologação externa** neste marco. Referências: [OIDC Google](https://developers.google.com/identity/openid-connect/openid-connect), [OAuth para servidor web](https://developers.google.com/identity/protocols/oauth2/web-server).

## Resend, recuperação e eventos de entrega

`server/email.cjs`, `server/email-store.cjs` e `server/email-notifications.cjs` mantêm templates, outbox, idempotência, tentativas com lease, backoff e integração de eventos. Modelos incluem boas-vindas, verificação, recuperação, pedidos e estados financeiros/logísticos, desejos, resumo e preparação de carrinho. A existência de um modelo não implica que toda automação esteja ativada.

Recuperação utiliza token aleatório de uso único, hash persistido, expiração, respostas sem enumeração e links na origem canônica. A redefinição invalida sessões conforme a política. Contas exclusivamente Google recebem tratamento próprio; a interface não promete uma definição local de senha indisponível.

Prévias de desenvolvimento ficam privadas, com destinatários mascarados e tokens omitidos. A exceção de teste controlado em demo exige `RESEND_DEMO_TEST_ENABLED`, destinatários exatos em `RESEND_TEST_RECIPIENTS`, domínio/remetente verificados e todos os gates Resend. Isso não habilita campanhas ou pagamentos. Alertas de desejos seguem também seus consentimentos.

O envio usa a API oficial com idempotência. Aceitação da API é distinta de entrega. O endpoint `/api/email/webhook/resend` exige corpo bruto e valida Svix por ID, timestamp e assinatura; o JSON só é interpretado depois da validação. Eventos são persistidos/deduplicados e mantêm estados como aceito, entregue, adiado, devolvido, reclamação e falha. Não interpretar `SENT` local como entrega confirmada na caixa postal.

As chaves foram armazenadas privadamente e configuradas nas variáveis Production. DNS/remetente, envio/entrega efetivos e recuperação completa pelo domínio precisam de prova externa após o deploy. Não registrar segredo, token de recuperação ou corpo sensível em documentação. Referências: [domínios](https://resend.com/docs/dashboard/domains/introduction), [envio](https://resend.com/docs/api-reference/emails/send-email), [webhooks](https://resend.com/docs/webhooks/introduction), [idempotência](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Mercado Pago: preparação e isolamento

`server/payments.cjs` e `server/payment-service.cjs` separam mock e Orders API. A aplicação calcula valores no servidor, persiste pedido/reserva/tentativa antes de acesso externo e conserva a chave idempotente. Cartão utiliza token do SDK; PAN e CVV não são enviados ao backend BKM. Pix depende exclusivamente do código real devolvido pelo provedor, sem QR fictício.

Webhooks exigem HMAC e consulta remota autoritativa; o corpo recebido não confirma pagamento por si só. Confirmação, repetição, recusa, expiração, aprovação tardia, reembolso e reconciliação preservam regras transacionais de estoque/cupom/histórico. Timeout ou resposta inconclusiva não cria nova cobrança automaticamente.

A instalação principal permanece `PAYMENT_PROVIDER=mock`, com produção financeira desativada. `/users/me` confirmou vendedor de teste; isso valida a conta, não uma transação. A homologação precisa de projeto e banco separados. A organização anterior ainda mostrava dois projetos Free na verificação de 19/10. Em 20/10, o projeto Supabase **BKM ecommerce** (`cxoeompxmgdzufgzxerw`) foi criado em nova conta autorizada pelo titular. Migração e configuração desse projeto ainda estão pendentes; não foi declarada conexão da aplicação ou homologação financeira concluída. Nenhuma pausa ou exclusão de outro projeto foi realizada pelo agente.

Credenciais isoladas não ativam produção. Não liberar a flag de aprovação comercial nem mudar o banco principal para executar testes financeiros externos. Pix/cartão reais de sandbox, assinatura, reenvio e reconciliação continuam pendentes. Referências: [Orders API](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/create-order/post), [contas de teste](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/resources/test-accounts), [notificações](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/notifications).

## Logística e backups

`server/shipping-provider.cjs` consulta somente cotação e status de etiquetas já existentes no sandbox Melhor Envio. Origem fixa, validação de CEP/medidas/BRL, limites e timeout foram testados em 11 cenários com transporte controlado. Falta chave e homologação; o adaptador não está conectado ao checkout e não possui compra de etiquetas. Comparação de provedores: [LOGISTICA.md](LOGISTICA.md).

O backup manual exporta PostgreSQL e objetos Storage, verifica hashes e cifra com AES-256-GCM. Restauração isolada foi executada sem tocar o principal. Chave, conteúdo e restauração são privados e não entram em Git/ZIP público. Não há agendamento ou exclusão automática de cópias. Procedimento: [BACKUP.md](BACKUP.md).
