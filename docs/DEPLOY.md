# Provisionamento e publicação — Fase 3

## Estado em 20/10/2026, antes do deploy da Fase 3

- Domínio canônico: [https://lojabkm.com.br](https://lojabkm.com.br/). O endereço `www` já redireciona por 308 ao domínio raiz, preservando a rota.
- Repositório: [zKaminise/BKM-TCG](https://github.com/zKaminise/BKM-TCG), branch `main`.
- Projeto principal Vercel existente: `bkm-tcg-demo`; alias anterior: `bkm-tcg-demo.vercel.app`. O ajuste final desse alias e a publicação do novo código ainda precisam ser conferidos após o deploy.
- Supabase principal dedicado: `bkm-tcg-demo`, referência `nxrvmanifngjmdtgnzoq`, região São Paulo, com migrations **1–7 aplicadas**. Não criar outro projeto para substituir essa instalação.
- Código da Fase 3 preparado localmente; rodada integral com **211 testes aprovados**. O push, o deploy Ready e a prova final online da Fase 3 ainda não estão registrados nesta revisão.

A conexão principal utiliza PostgreSQL pelo pooler Transaction/6543 e TLS verificado; imagens administrativas usam o bucket dedicado `bkm-public`. A autenticação própria BKM foi preservada. Não há migração para Supabase Auth nem instrução para recriar os usuários existentes.

## Separação de ambientes

| Ambiente | Banco e finalidade | Pagamento |
| --- | --- | --- |
| Principal demonstrativo | Projeto Supabase existente, catálogo, contas, coleção pessoal e pedidos de teste | `PAYMENT_PROVIDER=mock`, produção financeira desativada |
| Desenvolvimento isolado | SQLite dedicado ou PostgreSQL de desenvolvimento explicitamente escolhido | Testes sem cobrança externa |
| Homologação Mercado Pago | Projeto Vercel e banco separados, ainda em preparação nesta revisão | Contas/credenciais sandbox; nunca apontar para o banco principal |
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
| E-mail padrão seguro | `EMAIL_PROVIDER=development`; envio externo requer configuração específica descrita abaixo |
| Financeiro | `MERCADO_PAGO_ENABLED=false`, `MERCADO_PAGO_PRODUCTION_APPROVED=false` no principal |

Não desative verificação de TLS para resolver certificado. Quando fornecer CA explícita ao driver, evite parâmetros SSL na URI que sobreponham essa configuração. Use o host de pooler do próprio projeto; não copie host, referência ou senha de outro ambiente.

## Banco, migrações e Storage

A instalação principal já está populada e possui administrador. Não repetir bootstrap ou importação inicial nela. Antes de alterações de esquema, gere backup e confira seu destino.

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

Após publicar:

1. Conferir CI aprovado, deployment Ready e commit servido.
2. Conferir raiz, `www`, alias anterior, caminhos e parâmetros de retorno seguros.
3. Abrir `/api/config` e verificar status públicos, sem expor variáveis privadas.
4. Exercitar cadastro/login/logout/sessão, conta, carrinho, pedidos, administração e refresh de rotas.
5. Exercitar coleção pessoal, lotes, desejos, CSV, preços manuais e isolamento entre usuários.
6. Completar as provas externas dos provedores separadamente e atualizar [VALIDACAO.md](VALIDACAO.md) com resultados reais.

Salvar variáveis na Vercel exige novo deployment para alcançarem a função. Ter um segredo no ambiente Production não é prova de integração funcionando.

## Google e Resend

O cliente Google e os segredos Resend foram armazenados privadamente e configurados nas variáveis Production; seus valores não integram esta documentação. O callback implementado é **`https://lojabkm.com.br/api/auth/google/callback`**, derivado do domínio canônico. `GOOGLE_REDIRECT_URI`, quando fornecido, deve corresponder exatamente a ele.

Google requer `GOOGLE_AUTH_ENABLED`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, consentimento e callback autorizados. O código utiliza state vinculado à sessão, PKCE e nonce. O fluxo externo completo ainda precisa ser homologado após a publicação.

Resend requer domínio/remetente verificados, `EMAIL_PROVIDER=resend`, `RESEND_ENABLED`, `RESEND_DOMAIN_VERIFIED`, `RESEND_API_KEY`, `RESEND_FROM` e `RESEND_WEBHOOK_SECRET` para os eventos. O endpoint é `/api/email/webhook/resend`; a assinatura Svix utiliza o corpo bruto. O status HTTP de envio representa aceitação, não comprova entrega.

O padrão demonstrativo continua com prévias privadas. Existe uma exceção explícita para teste transacional controlado em demo: `RESEND_DEMO_TEST_ENABLED=true` e `RESEND_TEST_RECIPIENTS` com destinatários exatos autorizados, além de todos os gates do provedor. Isso não libera pagamentos, campanhas, ou envio a qualquer cliente. Alertas de desejos continuam sujeitos ao consentimento e às regras do código. `ABANDONED_CART_ENABLED` permanece falso; não existe automação ativa de carrinho nesta etapa.

## Mercado Pago, preços e logística

A consulta `/users/me` confirmou vendedor de teste. Produção continua desligada. Após o limite de dois projetos Free observado na organização anterior, em 20/10 foi criado o novo projeto Supabase BKM ecommerce, referência `cxoeompxmgdzufgzxerw`, em nova conta autorizada pelo titular. Migração e configuração estão pendentes; criação de projeto não comprova conexão, isolamento financeiro ou homologação. Nenhuma pausa ou exclusão de outro projeto foi feita pelo agente. Não declarar cobrança, webhook ou conciliação financeira homologados por apenas validar o token. Consulte [INTEGRACOES.md](INTEGRACOES.md).

O provedor global de preços disponível é o manual autorizado, administrado em `/admin/precos`; sua base permanece vazia nesta revisão. Não existe API licenciada Liga Pokémon configurada. Referências privadas dos clientes não são promovidas silenciosamente ao conjunto global.

Melhor Envio possui adaptador restrito ao sandbox, testado com transporte controlado. Sem chave e sem conexão ao checkout, ele não contrata frete. Veja [LOGISTICA.md](LOGISTICA.md).

## Backups e abertura comercial

Backups reais criptografados e restaurações SQLite isoladas foram executados. `BKM_BACKUP_KEY`, arquivo criptografado e restauração privada ficam fora do Git e do ZIP público. Retenção/cópia separada são procedimentos manuais, sem agendamento ativo. Comandos e limites em [BACKUP.md](BACKUP.md).

Abertura comercial depende de infraestrutura elegível, dados empresariais, políticas definitivas, logística e homologações. Nada desta fase autoriza assinatura, upgrade, compra de etiqueta ou cobrança real automática. [Regras do Vercel Hobby](https://vercel.com/docs/plans/hobby).

## Manutenção temporária no cutover

`BKM_MAINTENANCE_MODE=true` bloqueia toda a API antes da inicialização do banco, com HTTP 503 e `Retry-After: 60`. Use a manutenção durante a migração/configuração para impedir escrita no banco em transição. Após concluir migração, conferir o destino e validar os dados, a execução responsável deve retirar a flag e publicar a configuração final. Não interpretar a resposta 503 de manutenção como prova de integração concluída.
