# Provisionamento e publicação — Fase 3

## Estado em 20/10/2026 — núcleo publicado e principal migrado

- Domínio canônico: [lojabkm.com.br](https://lojabkm.com.br/); `www` redireciona por 308, preservando a rota.
- Repositório: [zKaminise/BKM-TCG](https://github.com/zKaminise/BKM-TCG), branch `main`; [commit publicado `d109af2`](https://github.com/zKaminise/BKM-TCG/commit/d109af2).
- Projeto Vercel principal: `bkm-tcg-demo`, com deployment Ready e redeploy Ready `NMSQa4gw1WfNTMa1BYQtvLVH1KFA`. Alias histórico: `bkm-tcg-demo.vercel.app`.
- [CI 39399711168](https://github.com/zKaminise/BKM-TCG/actions/runs/39399711168) aprovado com **211 testes**.
- Rodada local posterior: **213 testes aprovados**, `npm run check` e `npm run build` concluídos; não é uma nova execução do CI acima.

O cutover para o Supabase **BKM ecommerce** (`cxoeompxmgdzufgzxerw`) foi concluído. A migração PostgreSQL para PostgreSQL transferiu **40 tabelas, 230 registros e 2 objetos Storage**, com SHA-256 e integridade conferidos, RLS nas 40 tabelas, zero grants de tabelas para `anon`, `authenticated` ou `PUBLIC` e origem verificada como inalterada. Migrations **1–7** aplicadas. O banco principal anterior (`nxrvmanifngjmdtgnzoq`) permanece preservado.

As variáveis `DATABASE_URL`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` da Vercel Production foram atualizadas privadamente, assim como o `.env` local; `.env.old-main` preserva a configuração anterior. Após retirar a manutenção, o domínio respondeu HTTP 200 e `/api/config` confirmou demo, mock, `canCharge=false` e Google habilitado. Foram observados 15 produtos, 3 usuários e 4 pedidos; as 2 referências de imagens persistidas usam o novo Storage e nenhuma usa o anterior.

A autenticação BKM foi preservada. Não há migração para Supabase Auth nem recriação dos usuários existentes. A conexão PostgreSQL usa o pooler Transaction/6543 e TLS verificado; imagens administrativas usam o bucket dedicado `bkm-public`.

## Separação de ambientes

| Ambiente | Banco e finalidade | Pagamento |
| --- | --- | --- |
| Principal demonstrativo | `cxoeompxmgdzufgzxerw`, dados e imagens migrados; origem antiga preservada | `PAYMENT_PROVIDER=mock`, `canCharge=false` |
| Desenvolvimento isolado | SQLite dedicado ou PostgreSQL de desenvolvimento explicitamente escolhido | Testes sem cobrança externa |
| Homologação Mercado Pago | Supabase `secapcqqznlokiqhojsa`, TLS e 40 tabelas; Vercel Ready `35ZhSh55MLGoEqW9BEaaBFLxd3pT`; verificação real em staging | `canCharge=false`; duas orders Pix técnicas de teste, webhook ainda não comprovado |
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

As migrations 1–3 cobrem a base comercial e permissões; 4 adiciona coleção pessoal; 5, identidades Google; 6, eventos e entrega de e-mail; 7, referências globais de preços e importações autorizadas. São versionadas em `server/migrations/`, com bloqueio transacional de aplicação. Não trate a contagem histórica de 22 tabelas da Fase 2 como o esquema atual.

O seed é idempotente e restrito a bancos vazios/demonstrativos. Para migrar um SQLite existente para PostgreSQL **dedicado vazio**, use `npm run db:import -- "caminho/do/banco.sqlite"` no lugar do seed. O importador preserva a origem e invalida sessões; arquivos legados em `/uploads/` exigem transferência separada ao Storage.

O bucket público dedicado aceita imagens administrativas PNG/JPEG/WebP, com limite de 8 MB. O navegador otimiza imagens maiores antes do envio pela função; o servidor valida formato e autorização. Tabelas pessoais, sessões e pedidos não são expostos por políticas públicas. Fotos pessoais por URL HTTPS não equivalem a upload privado de imagens.

## Vercel e domínios

O projeto existente importa `main` com preset Other e Node 22.x. `vercel.json` define `npm run build`, saída `dist/`, função Node em `api/index.js`, rotas SPA e headers. O build inclui `personal-ui.js`, mantendo banco, scripts, `.env` e segredos fora da saída estática. O filesystem temporário da função não armazena dados persistentes.

O erro de origem encontrado no cadastro por `www` foi tratado com domínio canônico e redirecionamento já configurados. O código da Fase 3 também centraliza origens legitimamente possuídas, conserva CSRF/cookies seguros e não aceita previews por sufixo ou CORS irrestrito. A prova final deve visitar `/cadastro` por raiz e `www`, não apenas a home.

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

## Mercado Pago, preços e logística

O projeto **`bkm-tcg-sandbox`**, no Hobby, está no deployment Ready **`35ZhSh55MLGoEqW9BEaaBFLxd3pT`** e usa o Supabase separado **`secapcqqznlokiqhojsa`**, com **TLS verificado** e **40 tabelas**. O banco estava sem usuários, produtos ou pedidos antes da fixture técnica; essa contagem zero é histórica. A verificação real `--verify` confirmou vendedor de teste e `/api/config` em staging, sandbox e `canCharge=false`.

O `--run` real criou duas orders Pix técnicas de valor nominal **R$ 50,00** cada: cenário `APRO` aprovado no provedor e aplicado após reconciliação, segundo cenário confirmado pendente. A prova registrou uma reserva `COMMITTED`, uma `ACTIVE`, estoque de **2 para 1 uma única vez** e idempotência aprovada. Não houve cobrança comercial ou transferência bancária real. O principal continua mock, sem alteração financeira.

**`webhookProven=false`**: a aprovação por reconciliação não comprova entrega de webhook. As URLs e o tópico Orders foram configurados no painel de uma aplicação diferente daquela informada pela order emitida. É preciso conferir a aplicação associada à credencial, sua configuração de webhook e o HMAC correspondente; a relação entre as aplicações e a causa da divergência ainda não foram confirmadas. O acesso depende da autenticação/MFA do titular. Cartão e demais cenários também continuam pendentes. Consulte [INTEGRACOES.md](INTEGRACOES.md) e [VALIDACAO.md](VALIDACAO.md).

O provedor global de preços disponível é o manual autorizado, administrado em `/admin/precos`; sua base permanece vazia nesta revisão. Não existe API licenciada Liga Pokémon configurada. Referências privadas dos clientes não são promovidas silenciosamente ao conjunto global.

Melhor Envio possui adaptador restrito ao sandbox, testado com transporte controlado. Sem chave e sem conexão ao checkout, ele não contrata frete. Veja [LOGISTICA.md](LOGISTICA.md).

## Backups e abertura comercial

Após o cutover, backup AES-256-GCM do novo principal registrou **40 tabelas, 233 registros e 2 objetos**. A restauração em SQLite novo e isolado retornou integridade `ok`, zero violações de chave estrangeira e hashes de objetos conferidos. Os 233 registros são um snapshot posterior aos 230 da migração. `BKM_BACKUP_KEY`, arquivo criptografado e restauração privada ficam fora do Git e do ZIP público. Retenção/cópia separada são procedimentos manuais, sem agendamento ativo. Hash, comandos e limites em [BACKUP.md](BACKUP.md).

Abertura comercial depende de infraestrutura elegível, dados empresariais, políticas definitivas, logística e homologações. Nada desta fase autoriza assinatura, upgrade, compra de etiqueta ou cobrança real automática. [Regras do Vercel Hobby](https://vercel.com/docs/plans/hobby).

## Manutenção temporária no cutover

`BKM_MAINTENANCE_MODE=true` bloqueia toda a API antes da inicialização do banco, com HTTP 503 e `Retry-After: 60`. O guard permanece disponível para futuras migrações. No fechamento deste cutover, a configuração Production foi publicada com **`BKM_MAINTENANCE_MODE=false`** e o domínio respondeu **HTTP 200** utilizando o novo principal. Esse retorno não substitui o QA completo dos fluxos descrito acima.
