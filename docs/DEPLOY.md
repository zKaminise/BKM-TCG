# Provisionamento e publicação — Fase 3

## Estado em 21/10/2026 — resumos publicados e cron registrado

A revisão atual está publicada, com **265 testes** e CI aprovado. A leitura PostgreSQL confirmou esquema 8 nos dois ambientes: **41 tabelas, 41 com RLS, zero grants públicos e zero eventos de resumo pendentes** no momento da consulta. O cron está Enabled às 12 UTC e o disparo manual do painel Vercel respondeu **200 em 21/10 às 17:16:27 UTC**, após configurar a chave Production. A chamada local com Bearer continuou 401 e não é apresentada como aprovada. **Resumo controlado entregue; alerta imediato e disparo agendado natural ainda não comprovados.**

O ajuste de `4ca7a0c` reconhece reembolso integral moderno somente após conferir itens completos vinculados ao pagamento e soma exata. O reembolso integral do cartão APRO foi comprovado no sandbox, com um POST 201, GET autoritativo, estado local REFUNDED e segundo recibo webhook autenticado; essa prova é separada dos 265 testes e do CI.

- Domínio canônico: [lojabkm.com.br](https://lojabkm.com.br/); `www` redireciona por 308, preservando a rota.
- Repositório: [zKaminise/BKM-TCG](https://github.com/zKaminise/BKM-TCG), branch `main`; código publicado no [commit `fdbb91c`](https://github.com/zKaminise/BKM-TCG/commit/fdbb91c6bf24f0306c98e2fb17ed407d87bee1a6).
- Projeto Vercel principal: `bkm-tcg-demo`, deployment Success `GRuxVzXNnseYFDWhBYD1a4TrbCij`. Sandbox separado: deployment Success `AVSCdA9YAMiJ4LPAxdMzApFMLbVM`. Alias histórico principal: `bkm-tcg-demo.vercel.app`. Esses identificadores registram o código validado; um redeploy posterior da configuração do cron não comprova sua autorização.
- Última rodada concluída: **265 testes e sintaxe aprovados**, com [CI 39642646628](https://github.com/zKaminise/BKM-TCG/actions/runs/39642646628) concluído com sucesso em `fdbb91c` e deployments Success. CIs anteriores de 260 e 216 testes permanecem históricos.
- O [commit inicial `d109af2`](https://github.com/zKaminise/BKM-TCG/commit/d109af2), o redeploy `NMSQa4gw1WfNTMa1BYQtvLVH1KFA` e o [CI de 211 testes](https://github.com/zKaminise/BKM-TCG/actions/runs/39399711168) são marcos históricos.

O cutover para o Supabase **BKM ecommerce** (`cxoeompxmgdzufgzxerw`) foi concluído. A migração PostgreSQL para PostgreSQL transferiu **40 tabelas, 230 registros e 2 objetos Storage**, com SHA-256 e integridade conferidos, RLS nas 40 tabelas, zero grants de tabelas para `anon`, `authenticated` ou `PUBLIC` e origem verificada como inalterada. Migrations **1–7** aplicadas. O banco principal anterior (`nxrvmanifngjmdtgnzoq`) permanece preservado.

As variáveis `DATABASE_URL`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` da Vercel Production foram atualizadas privadamente, assim como o `.env` local; `.env.old-main` preserva a configuração anterior. Após retirar a manutenção, o domínio respondeu HTTP 200 e `/api/config` confirmou demo, mock, `canCharge=false` e Google habilitado. Foram observados 15 produtos, 3 usuários e 4 pedidos; as 2 referências de imagens persistidas usam o novo Storage e nenhuma usa o anterior.

A autenticação BKM foi preservada. Não há migração para Supabase Auth nem recriação dos usuários existentes. A conexão PostgreSQL usa o pooler Transaction/6543 e TLS verificado; imagens administrativas usam o bucket dedicado `bkm-public`.

## Separação de ambientes

| Ambiente | Banco e finalidade | Pagamento |
| --- | --- | --- |
| Principal demonstrativo | `cxoeompxmgdzufgzxerw`, dados e imagens migrados; origem antiga preservada | `PAYMENT_PROVIDER=mock`, `canCharge=false` |
| Desenvolvimento isolado | SQLite dedicado ou PostgreSQL de desenvolvimento explicitamente escolhido | Testes sem cobrança externa |
| Homologação Mercado Pago | Supabase `secapcqqznlokiqhojsa`, TLS e 41 tabelas no esquema 8; Vercel Success `AVSCdA9YAMiJ4LPAxdMzApFMLbVM`; verificação real em staging | `canCharge=false`; Pix sandbox aprovado/expirado e callbacks oficiais autenticados comprovados |
| Operação comercial futura | Infraestrutura compatível e liberação posterior | Somente após homologação e autorização explícita |

Não reutilizar dados de clientes do principal em homologação financeira, nem ativar pagamentos externos no projeto principal para contornar a separação. O Vercel Hobby continua exclusivamente demonstrativo, sem vendas reais e com `noindex`.

## Instalação local e configuração privada

Diretório oficial: `D:\Importante\Codex\LP Vendas TCG Site`. Use Node 22.x, versão mínima 22.13. A loja local é [http://localhost:4173/](http://localhost:4173/) e a administração, [http://localhost:4173/admin](http://localhost:4173/admin).

`.env.example` contém somente nomes e valores de desenvolvimento. O `.env` real é privado e carregado automaticamente. Nunca passe senha de banco, token ou chave por chat, argumento de terminal, commit ou captura. Preserve um `.env` existente ao instalar.

`CONECTAR SUPABASE.cmd` / `npm run db:configure` permite informar a conexão do pooler e a senha de forma interativa. O assistente codifica a senha e atualiza os campos de conexão; ele não cria infraestrutura nem substitui a validação de conectividade. A chave de serviço do Storage é configurada separadamente no servidor.

Variáveis básicas:

| Grupo | Configuração |
| --- | --- |
| Origem principal | `BKM_PUBLIC_URL=https://lojabkm.com.br` |
| Demonstração | `BKM_ENVIRONMENT=demo`, `HOSTING_DEMO_ONLY=true`, `PAYMENT_PROVIDER=mock` |
| PostgreSQL | `DATABASE_URL` privado, `BKM_DB_POOL_SIZE=1`, verificação TLS; `DATABASE_CA_CERT` se necessário |
| Storage | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` privados no servidor; `SUPABASE_STORAGE_BUCKET=bkm-public` |
| E-mail padrão seguro | `EMAIL_PROVIDER=development` no exemplo local; Production tem Resend para teste controlado descrito abaixo |
| Corpo bruto na Vercel | `NODEJS_HELPERS=0` em Production, seguido de redeploy; necessário à validação Svix nesta implantação |
| Financeiro | `MERCADO_PAGO_ENABLED=false`, `MERCADO_PAGO_PRODUCTION_APPROVED=false` no principal |

Não desative verificação de TLS para resolver certificado. Quando fornecer CA explícita ao driver, evite parâmetros SSL na URI que sobreponham essa configuração. Use o host de pooler do próprio projeto; não copie host, referência ou senha de outro ambiente.

## Banco, migrações e Storage

O novo principal já contém os dados migrados e o administrador existente. Não repetir bootstrap, seed ou importação inicial para apenas utilizá-lo. O banco e a configuração privados anteriores foram preservados. Antes de outra migração, gere backup e confira origem, destino e credenciais.

A transferência principal desta etapa foi PostgreSQL para PostgreSQL, com guarda explícita dos projetos de origem/destino e validação do destino antes de importar. Incluiu as 40 tabelas, identidades BKM, relacionamentos, sequências e os 2 objetos Storage; as URLs persistidas foram atualizadas ao novo projeto. O importador SQLite abaixo é um procedimento distinto para instalações novas, não o mecanismo desse cutover.

Em um ambiente **novo e dedicado**, após escolher o `.env` correto:

```powershell
npm ci
npm run db:migrate
npm run demo:seed
npm run storage:configure
npm run admin:create
```

As migrations 1–3 cobrem a base comercial e permissões; 4 adiciona coleção pessoal; 5, identidades Google; 6, eventos e entrega de e-mail; 7, referências globais de preços e importações autorizadas. A **008**, já confirmada no principal e sandbox, acrescenta eventos persistidos de resumos de desejos, com RLS e revogação de grants públicos. São versionadas em `server/migrations/`, com bloqueio transacional de aplicação. Não trate as contagens históricas de 22 tabelas da Fase 2 ou 40 do cutover como o esquema atual de 41 tabelas.

O seed é idempotente e restrito a bancos vazios/demonstrativos. Para migrar um SQLite existente para PostgreSQL **dedicado vazio**, use `npm run db:import -- "caminho/do/banco.sqlite"` no lugar do seed. O importador preserva a origem e invalida sessões; arquivos legados em `/uploads/` exigem transferência separada ao Storage.

O bucket público dedicado aceita imagens administrativas PNG/JPEG/WebP, com limite de 8 MB. O navegador otimiza imagens maiores antes do envio pela função; o servidor valida formato e autorização. Tabelas pessoais, sessões e pedidos não são expostos por políticas públicas. Fotos pessoais por URL HTTPS não equivalem a upload privado de imagens.

## Vercel e domínios

O projeto existente importa `main` com preset Other e Node 22.x. `vercel.json` define `npm run build`, saída `dist/`, função Node em `api/index.js`, rotas SPA e headers. O build inclui `personal-ui.js`, mantendo banco, scripts, `.env` e segredos fora da saída estática. O filesystem temporário da função não armazena dados persistentes.

O erro de origem encontrado no cadastro por `www` foi tratado com domínio canônico e redirecionamento. O código centraliza origens legitimamente possuídas, conserva CSRF/cookies seguros e não aceita previews por sufixo ou CORS irrestrito. O QA publicado de `/cadastro` conferiu raiz e entrada `www` com 308 preservando rota/query, GET canônico 200 e POST canônico 201 para duas contas fictícias CUSTOMER. Sessão, perfil, novo login e revogação passaram; a allowlist estrita bloqueou os e-mails das fixtures sem envio externo. Isso não comprova cadastro Google nem todos os fluxos visuais.

A publicação do núcleo está registrada acima. Para fechar a prova dos fluxos e conferir cada novo deployment:

1. Conferir CI aprovado, deployment Ready e commit servido.
2. Conferir raiz, `www`, alias anterior, caminhos e parâmetros de retorno seguros.
3. Abrir `/api/config` e verificar status públicos, sem expor variáveis privadas.
4. Exercitar cadastro/login/logout/sessão, conta, carrinho, pedidos, administração e refresh de rotas.
5. Exercitar coleção pessoal, lotes, desejos, CSV, preços manuais e isolamento entre usuários.
6. Completar as provas externas dos provedores separadamente e atualizar [VALIDACAO.md](VALIDACAO.md) com resultados reais.

Salvar variáveis na Vercel exige novo deployment para alcançarem a função. Ter um segredo no ambiente Production não é prova de integração funcionando.

## Google e Resend

O cliente Google e os segredos Resend foram armazenados privadamente e configurados nas variáveis Production; seus valores não integram esta documentação. O callback implementado é **`https://lojabkm.com.br/api/auth/google/callback`**, derivado do domínio canônico. `GOOGLE_REDIRECT_URI`, quando fornecido, deve corresponder exatamente a ele.

Google requer `GOOGLE_AUTH_ENABLED`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, consentimento e callback autorizados. O código utiliza state vinculado à sessão, PKCE e nonce. Após o retorno inicial `link-required`, o titular fez login BKM, confirmou o vínculo explícito, saiu e entrou novamente pelo Google na mesma conta. A conta tinha 0 coleções observadas; não foi provada migração de um acervo preenchido nesse fluxo. A audiência foi publicada, com UI **Externo / Em produção** e opção de voltar para teste. O login solicita somente `openid`, `email` e `profile`, sem acesso Gmail/Drive. Isso comprova a publicação básica, sem alegar verificação avançada ou ausência de limites do Google. Cadastro novo, cancelamento e demais caminhos ainda precisam de validação própria.

Resend requer domínio/remetente verificados, `EMAIL_PROVIDER=resend`, `RESEND_ENABLED`, `RESEND_DOMAIN_VERIFIED`, `RESEND_API_KEY`, `RESEND_FROM` e `RESEND_WEBHOOK_SECRET` para os eventos. O endpoint é `/api/email/webhook/resend`; a assinatura Svix utiliza o corpo bruto. O status HTTP da API de envio representa aceitação, não comprova entrega.

Na Vercel, manter **`NODEJS_HELPERS=0` no ambiente Production** e fazer novo deployment após alterar a variável. Essa configuração corrigiu o acesso ao corpo bruto usado pela validação Svix nesta implantação, sem remover a assinatura. A [documentação oficial de configuração avançada Node.js](https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration) descreve como desativar os helpers por essa variável.

Em 20/10, um único teste de recuperação para a conta existente do titular confirmou `SENT` e `DELIVERED` por webhook Svix assinado com HTTP 200. Repetir o mesmo evento retornou 200 sem duplicação nem novo envio. A conta e sua senha permaneceram inalteradas; essa evidência comprova envio, entrega e idempotência do evento, não o fluxo completo de redefinição ou todos os modelos de e-mail.

O padrão demonstrativo continua com prévias privadas. Existe uma exceção explícita para teste transacional controlado em demo: `RESEND_DEMO_TEST_ENABLED=true` e `RESEND_TEST_RECIPIENTS` com destinatários exatos autorizados, além de todos os gates do provedor. Isso não libera pagamentos, campanhas, ou envio a qualquer cliente. Alertas de desejos continuam sujeitos ao consentimento e às regras do código. `ABANDONED_CART_ENABLED` permanece falso; não existe automação ativa de carrinho nesta etapa.

## Resumos e consumidor independente de e-mails

Implementados, publicados e testados, com cron Enabled e **disparo manual pelo painel Vercel com HTTP 200** após salvar a chave Production. A chamada local com Bearer ainda recebeu 401; ela não comprova execução autorizada. **Resumo controlado entregue; alerta imediato e disparo agendado natural permanecem pendentes.** A migration 008 conserva eventos elegíveis, incluindo identidade e titularidade. O resumo diário fecha às **12:00 UTC (09:00 BRT)** e o semanal, **segunda-feira às 12:00 UTC**. Antes de enfileirar e novamente antes de enviar, a aplicação confere titular, desejo atual, consentimento, supressão, anúncio, variante, preço e estoque. Eventos fora do lote ficam pendentes; cada lote examina até 50 eventos e o job, até 5 titulares.

No primeiro envio do resumo, itens que perderam elegibilidade são retirados sem suprimir as demais cartas válidas. A preparação exige claim e lease vigentes, persiste o payload elegível antes da chamada ao Resend e descarta os eventos removidos. Tentativas posteriores preservam esse payload, impedindo mudança de conteúdo sob a mesma chave idempotente; continuam sujeitas às verificações que podem bloquear o envio.

`GET /api/jobs/email` exige `Authorization: Bearer <CRON_SECRET>`. A chave deve ser aleatória, privada, com 32–256 caracteres base64url, salva como Secret somente em Production. A comparação usa hash e tempo constante; User-Agent não autoriza o job. Sem chave válida, o endpoint responde 401 antes de inicializar o banco. Não publicar a chave nem incluí-la em URL, documentação ou log.

O `vercel.json` registra uma execução diária em **`0 12 * * *`**, conferida como Enabled no painel. No Hobby, o disparo pode ocorrer dentro da hora prevista, sem precisão de minuto, e não constitui SLA de envio comercial. O worker consolida os resumos vencidos e consome até 20 mensagens, respeitando uma janela de trabalho de 40 segundos e claims individuais. Pendências continuam duráveis para a próxima execução; o cron diário pode deixar backlog e não substitui um consumidor mais frequente na operação comercial. Referências: [limites de cron](https://vercel.com/docs/cron-jobs/usage-and-pricing), [proteção de cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).

Em 21/10, um teste controlado do resumo ao único titular autorizado confirmou **um evento QUEUED, um e-mail SENT/DELIVERED e um callback real `email.delivered`**, sem reenvio. Somente o evento de homologação teve vencimento antecipado de **22/10 às 12 UTC para 21/10**, mantendo a preferência de 24 horas. Um Run manual da Vercel disparou o envio; **não é prova de execução natural do calendário nem de alerta imediato**. Ao terminar, foram confirmados `preferencesRestored=true`, `temporaryWishRemoved=true` e zero pendências alheias. Evidências privadas: `work/resend-owner-digest-delivered.json` e `work/resend-owner-digest-observation.json`.

Validação restante: alerta imediato e observação de disparo agendado natural. A chamada local com Bearer divergente permanece 401. `/api/config` respondeu HTTP 200 com Google habilitado, demo, mock e `canCharge=false`. A lista de destinatários controlados continua restrita ao titular autorizado. Respostas ambíguas de envio com mais de **23 horas** exigem reconciliação manual em vez de reenvio automático fora da janela segura de idempotência. Relógios dos helpers e logs Vercel diferiram; não inferir latência nem sequência precisa entre fontes por seus timestamps.

## Mercado Pago, preços e logística

O commit `09dcc61` corrigiu o carregamento do SDK para [o endereço oficial `https://sdk.mercadopago.com/js/v2`](https://github.com/mercadopago/sdk-js), observado com HTTP 200 e JavaScript. O endereço anterior `https://js.mercadopago.com/v2` falhava por DNS (`ENOTFOUND`). Após a correção, o Brick real abriu no navegador e `OTHE` foi tokenizado e recusado: GET autoritativo e banco confirmaram **CANCELLED/REJECTED**, **1 recibo webhook autenticado**, reserva **RELEASED** e estoque ainda 1 naquele momento. As provas posteriores de APRO e reembolso integral estão registradas a seguir.

O cenário posterior de cartão `APRO`, também pelo Brick real, foi confirmado por GET autoritativo e PostgreSQL como **CONFIRMED/APPROVED**, provedor **processed/accredited**, valor nominal sandbox de R$ 50,00, **1 recibo webhook autenticado** e reserva **COMMITTED/1**. O mesmo pedido recebeu depois um reembolso integral: **um POST 201**, um item concluído de 5.000 centavos, GET REFUNDED e estado local REFUNDED após webhook. Foram conferidos **1 transição financeira REFUNDED e 1 recibo REFUNDED**, totalizando 2 recibos com a aprovação. Permaneceram **4 pedidos, estoque 0 e 2 baixas acumuladas**, sem reposição automática. O e-mail de reembolso ficou **PENDING** no provedor development do sandbox, sem envio Resend. Pendência por cartão, cancelamento solicitado, reembolso parcial e outros cenários continuam pendentes.

O projeto **`bkm-tcg-sandbox`**, no Hobby, está no deployment Success **`AVSCdA9YAMiJ4LPAxdMzApFMLbVM`** e usa o Supabase separado **`secapcqqznlokiqhojsa`**, com **TLS verificado** e **41 tabelas no esquema 8**. O banco estava sem usuários, produtos ou pedidos antes da fixture técnica; essa contagem zero é histórica. A verificação real `--verify` confirmou vendedor de teste e `/api/config` em staging, sandbox e `canCharge=false`.

O `--run` real criou duas orders Pix técnicas de valor nominal **R$ 50,00** cada: cenário `APRO` aprovado e segundo inicialmente pendente. Esse estado inicial foi preservado separadamente. Na prova final de **20/10 às 22:31 BRT (21/10 às 01:31 UTC)**, GET no provedor e leitura do banco confirmaram **APPROVED/COMMITTED** para a primeira e **EXPIRED/RELEASED** para a segunda. Os callbacks do simulador oficial retornaram **HTTP 200** para os mesmos IDs, com **2 recibos autenticados por order**. Naquele snapshot havia 2 pedidos, uma única unidade baixada e estoque de **2 para 1**, sem baixa adicional. O teste posterior de cartão recusado acrescentou uma terceira order sem alterar a evidência Pix. Não houve cobrança comercial ou transferência bancária real. O principal continua mock, sem alteração financeira.

O relatório inicial com **`webhookProven=false`** é histórico e foi preservado. A prova final Pix está em `backups/mp-sandbox-final-evidence.json`, com **`observedScenariosConfirmed=true`**, consulta do recurso verdadeiro e recibos autenticados. A causa da rejeição foi confirmada: o emissor assinava o ID exato, enquanto a implementação validava somente a forma canônica em minúsculas. O commit `e07241b` valida integralmente ambas as formas com comparação em tempo constante e replay unificado; query, janela temporal, GET autoritativo e validações financeiras foram mantidos. Pendência por cartão, cancelamento solicitado, reembolso parcial e outros cenários ainda exigem provas próprias. Consulte [INTEGRACOES.md](INTEGRACOES.md) e [HOMOLOGACAO-MP.md](HOMOLOGACAO-MP.md).

O provedor global de preços disponível é o manual autorizado, administrado em `/admin/precos`; sua base permanece vazia nesta revisão. Não existe API licenciada Liga Pokémon configurada. Referências privadas dos clientes não são promovidas silenciosamente ao conjunto global.

Melhor Envio possui adaptador restrito ao sandbox, testado com transporte controlado. Sem chave e sem conexão ao checkout, ele não contrata frete. Veja [LOGISTICA.md](LOGISTICA.md).

## Backups e abertura comercial

O último backup AES-256-GCM comprovado do principal, após a migration 008, registrou **41 tabelas, 199 registros e 2 objetos**, restaurados em SQLite novo e isolado com integridade `ok` e `remoteTarget=false`. Preservam-se os snapshots anteriores de 233 e 244 registros e a migração de 230; contagens variam com o uso e a expiração de sessões. `BKM_BACKUP_KEY`, arquivos criptografados e restaurações privadas ficam fora do Git e do ZIP público. Retenção/cópia separada são procedimentos manuais, sem agendamento ativo. Hashes, comandos e limites em [BACKUP.md](BACKUP.md).

Abertura comercial depende de infraestrutura elegível, dados empresariais, políticas definitivas, logística e homologações. Nada desta fase autoriza assinatura, upgrade, compra de etiqueta ou cobrança real automática. [Regras do Vercel Hobby](https://vercel.com/docs/plans/hobby).

## Manutenção temporária no cutover

`BKM_MAINTENANCE_MODE=true` bloqueia toda a API antes da inicialização do banco, com HTTP 503 e `Retry-After: 60`. O guard permanece disponível para futuras migrações. No fechamento deste cutover, a configuração Production foi publicada com **`BKM_MAINTENANCE_MODE=false`** e o domínio respondeu **HTTP 200** utilizando o novo principal. Esse retorno não substitui o QA completo dos fluxos descrito acima.
