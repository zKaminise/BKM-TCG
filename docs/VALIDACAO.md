# Validação — BKM TCG Fase 3

## Marco de 20/10/2026 — núcleo publicado e cutover concluído

Site canônico: [lojabkm.com.br](https://lojabkm.com.br/). Repositório: [zKaminise/BKM-TCG](https://github.com/zKaminise/BKM-TCG), branch `main`. Diretório: `D:\Importante\Codex\LP Vendas TCG Site`.

O núcleo da Fase 3 foi publicado no [commit `d109af2`](https://github.com/zKaminise/BKM-TCG/commit/d109af2), com deployment Ready. O [CI histórico 39399711168](https://github.com/zKaminise/BKM-TCG/actions/runs/39399711168) aprovou **211 testes**. A rodada local posterior aprovou **213 testes**, `npm run check` e `npm run build`; não é uma nova execução desse CI. O redeploy `NMSQa4gw1WfNTMa1BYQtvLVH1KFA` também ficou Ready. Posteriormente, a migração e a troca de configuração do principal foram concluídas, com HTTP 200 no domínio. As provas de dados, Google, Resend e Pix sandbox abaixo têm escopos distintos; a homologação financeira completa permanece pendente.

## Cobertura automatizada da Fase 3

- Domínio/origens e caminhos de retorno seguros, perfil, endereços, autenticação, sessão/CSRF e isolamento de contas.
- Google OIDC com PKCE, state/nonce, tokens, conflitos/vínculo e manutenção de papéis. Transporte controlado não comprova consentimento e callback reais.
- Coleção pessoal, checklist e objetivos, lotes/duplicatas/variantes, quantidade/custo, filtros, propriedade e isolamento entre usuários.
- Desejos e correspondência com anúncios disponíveis, consentimento, notificações internas e deduplicação.
- Referências privadas e globais segregadas, valor conhecido/cobertura/desatualização e snapshots reais; importação/exportação CSV, prévia, erros, direitos e idempotência.
- E-mails, outbox, entrega/eventos, corpo bruto, assinatura Svix, repetição, destinatários controlados e falhas.
- Backup, criptografia/autenticação, chave incorreta, objetos, constraints e restauração isolada.
- Logística sandbox: 11 testes controlados para readiness, CEP/medidas/conversões, preço/prazo personalizados, BRL, limites, timeout, origem fixa, redirecionamentos e tracking.
- Regressão do catálogo, TCGdex, estoque, pedidos, reserva/baixa/idempotência, permissões, uploads, carrinho, cupons, mock e preparação Mercado Pago.

A suíte usa identidades e bancos isolados, incluindo PostgreSQL embarcado via PGlite. Ela não deve carregar o `.env` privado real. Não executar testes financeiros contra o principal para substituir o isolamento. Testes automatizados não equivalem a homologação Google, Resend ou Mercado Pago externos.

## Infraestrutura e dados confirmados nesta etapa

- Migração PostgreSQL para PostgreSQL concluída para **BKM ecommerce** (`cxoeompxmgdzufgzxerw`): **40 tabelas, 230 registros e 2 objetos Storage**, com conferência de SHA-256, relacionamentos, sequências, esquema e origem inalterada. Autenticação BKM e identidades existentes preservadas, sem cadastro Supabase Auth paralelo.
- Novo principal com migrations **1–7**, **40 tabelas, 40 com RLS**, e **zero grants de tabelas para `anon`, `authenticated` e `PUBLIC`**. Nova chave guardada privadamente.
- Vercel Production usa as novas `DATABASE_URL`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`; o `.env` local também foi atualizado. O banco anterior (`nxrvmanifngjmdtgnzoq`) e a configuração `.env.old-main` permanecem preservados.
- Auditoria no novo banco: **3 usuários, 4 pedidos, 2 referências de imagens no novo projeto e 0 no anterior**. Após `BKM_MAINTENANCE_MODE=false`, o domínio respondeu **HTTP 200**, com `/api/config` indicando **demo, mock, `canCharge=false` e Google habilitado**; o catálogo retornou **15 produtos** no momento da consulta.
- Domínio canônico `https://lojabkm.com.br`; `www` com redirecionamento 308. A prova completa deve incluir caminhos como `/cadastro`, além da home.
- Cliente Google e chaves Resend privados, configurados em Vercel Production. Após o consentimento/callback inicial `link-required`, o titular fez login BKM, confirmou o vínculo explícito e saiu/entrou pelo Google na mesma conta. Foram observadas 0 coleções. A audiência Google foi publicada como **Externo / Em produção**, com scopes básicos `openid`, `email` e `profile`. Isso não alega verificação avançada nem ausência de limites. Resend possui a evidência específica abaixo.
- Mercado Pago `/users/me` confirmou vendedor de teste; principal mock e produção financeira desativada. O Vercel **`bkm-tcg-sandbox`** tem deployment Ready **`35ZhSh55MLGoEqW9BEaaBFLxd3pT`**, com Supabase isolado **`secapcqqznlokiqhojsa`**, **TLS verificado e 40 tabelas**. Antes da fixture, usuários/produtos/pedidos eram 0; o teste agora mantém seus próprios registros técnicos. A verificação real aprovou staging/sandbox e `canCharge=false`; duas orders Pix técnicas foram criadas, conforme a prova detalhada abaixo. Chaves permanecem privadas e não houve cobrança comercial.
- Referências globais autorizadas da migration 007 com conjunto vazio neste marco. Nenhuma cotação foi inventada para gerar métricas.

## Backup e restauração reais

Foram registrados os seguintes marcos de backup, sem exposição de conteúdo privado:

| Marco | Conteúdo observado | Resultado |
| --- | --- | --- |
| Snapshot inicial | 22 tabelas, 177 registros, 2 imagens | AES-256-GCM; restauração isolada validada |
| Snapshot posterior, antes da migration 007 | 38 tabelas, 202 registros, 2 imagens | Arquivo criptografado e restauração isolada confirmados |
| Novo principal após o cutover, 20/10 | 40 tabelas, 233 registros, 2 objetos | AES-256-GCM; restauração em SQLite novo, esquema 7, integridade `ok`, zero violações de chave estrangeira e hashes dos objetos conferidos |

São contagens de snapshots distintos: os **233 registros do backup posterior** não são a contagem dos **230 registros da migração**. A restauração mais recente foi somente em arquivo SQLite novo e isolado; não houve restauração no PostgreSQL remoto. Banco restaurado e objetos permanecem privados. Chave de backup fica fora do repositório e do ZIP público, com necessidade de cópia segura separada. Retenção é manual; não existe automação de backup ou descarte ativa. Arquivo, SHA-256 e procedimento em [BACKUP.md](BACKUP.md).

## Validação visual da Fase 3

Foram preparados layout de conta/fichário, SVGs locais no header, checklist visual, formulários e painel de referências. A tentativa de QA do subagente recebeu inventário de navegador vazio e não gerou screenshots, portanto **não é prova visual**. A execução principal deve completar e registrar desktop/mobile e persistência dos fluxos no domínio publicado.

Correções estáticas incluem layout inicial por rota sem flash da animação em produto/admin, banner neutro durante inicialização, imagem de destaque conforme o DTO, seis variantes no objetivo, fonte/data e referência desatualizada sinalizada. Sintaxe e build foram conferidos após as alterações. Isso não substitui testar a interface no navegador.

## Registro histórico da Fase 2

Os itens abaixo documentam o que já havia sido exercitado online antes da Fase 3; não provam as novas rotas ou integrações:

- CI anterior com 119 testes no commit `e3dff6c` e publicação posterior do ajuste de carregamento/CTA `085351a`.
- PostgreSQL e Storage conectados; dados SQLite importados, administrador existente e RLS das tabelas daquela versão verificado.
- Login administrativo, importação TCGdex, publicação/edição de Butterfree, produto de QA arquivado de forma recuperável e upload 4K otimizado para WebP no Storage.
- Home e animação verificadas em desktop/celular; no viewport móvel de 375 px a página media 375 px, sem overflow horizontal.
- Carrinho e checkout móvel criaram pedido demonstrativo pendente, depois aprovado por simulação; refresh e reinício local preservaram estado no banco remoto.
- Concorrência em dois pools PostgreSQL sobre a última unidade: uma aprovação e uma resposta de estoque insuficiente, com apenas uma baixa; repetir a chave idempotente devolveu o mesmo pedido.

As evidências históricas da pasta de entregas incluem `bkm-admin-online.jpg`, `bkm-ecommerce-online-catalogo.jpg`, `bkm-upload-supabase-online.jpg`, `bkm-login-mobile.jpg`, `bkm-carrinho-online-mobile.jpg`, `bkm-checkout-online-mobile.jpg`, `bkm-pedido-online-mobile.jpg` e capturas de home/animação. Não renomear essas imagens como prova da Fase 3.

## Publicação, cutover e provedores: evidência online de 20/10

- Núcleo servido no domínio oficial a partir de `d109af2`, com deployment Ready, CI 39399711168 aprovado e redeploy Ready `NMSQa4gw1WfNTMa1BYQtvLVH1KFA`.
- Configuração Production trocada para o novo principal após a migração, manutenção desativada e HTTP 200. As contagens, referências Storage e permissões auditadas estão registradas acima.
- Após o retorno Google inicial `link-required`, o titular autenticou sua conta BKM, confirmou o vínculo explícito, saiu e entrou novamente pelo Google. O nome e a identidade observados continuaram na mesma conta; foram observadas 0 coleções. Isso comprova vínculo e novo login controlados, sem associação automática por e-mail, mas não preservação de um acervo preenchido.
- A audiência Google foi publicada; a interface mostrou **Em produção**, **Externo** e a opção **Voltar para o teste**, com captura `outputs/google-login-publicado.png`. O escopo é apenas login básico `openid`, `email` e `profile`, sem Gmail/Drive. Essa prova não representa verificação avançada Google nem comprova ausência de limites; cadastro novo, cancelamento e demais caminhos continuam sem prova própria.
- Em 20/10, um único teste de recuperação para a conta existente do titular confirmou `SENT` e `DELIVERED` por webhook Svix assinado com HTTP 200. Repetir o mesmo evento retornou 200 sem duplicação nem novo envio. A conta e sua senha permaneceram inalteradas; essa evidência comprova envio, entrega e idempotência do evento, não o fluxo completo de redefinição ou todos os modelos de e-mail.
- `NODEJS_HELPERS=0` em Production, seguido de redeploy, corrigiu a disponibilidade do corpo bruto para validação Svix. O endpoint continuou exigindo assinatura válida; não houve desativação da verificação. Receita e [fonte oficial Vercel](https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration) em [DEPLOY.md](DEPLOY.md).

A prova completa de cadastro raiz/www, sessão/login/logout, conta/coleção, CSV, desejos, administração e visual desktop/mobile ainda precisa de registro consolidado. Os demais caminhos Google, uso final do link de recuperação com mudança de senha e conclusão da homologação Mercado Pago isolada também permanecem pendentes. Não tratar a entrega de uma recuperação como homologação de todos os fluxos de e-mail.

## Mercado Pago: prova real no sandbox de 20/10

- Deployment Vercel **`35ZhSh55MLGoEqW9BEaaBFLxd3pT` Ready**, em `bkm-tcg-sandbox`. `--verify` real confirmou vendedor `test_user`, configuração staging/sandbox e **`canCharge=false`**. O principal demonstrativo foi preservado e segue mock.
- `--run` real criou **2 orders Pix técnicas de R$ 50,00 nominais cada**. O cenário `APRO` tornou-se **`APPROVED` no provedor** e foi aplicado após reconciliação; o segundo foi confirmado **`PENDING`**. Não houve transferência bancária real nem cobrança comercial.
- Resultado persistido: **1 reserva `COMMITTED`, 1 reserva `ACTIVE`, estoque de 2 para 1 uma única vez**. Reenvios idempotentes passaram, sem order substituta nem baixa adicional.
- **`webhookProven=false`**. A aprovação foi confirmada por consulta/reconciliação e não comprova entrega de webhook. A order informa aplicação emissora **`8997426787542730`**, diferente da aplicação configurada no painel **`3540436696764388`**, onde foram salvos URLs, tópico Orders e HMAC. A relação entre as aplicações e a causa da divergência ainda não foram confirmadas.
- Próxima prova: conferir aplicação associada à credencial e configuração/HMAC correspondente, com autenticação/MFA do titular, e observar webhook legítimo e replay. Cartão pelo SDK, recusa, expiração, cancelamento e reembolso continuam pendentes. O resultado parcial não é homologação financeira completa nem autorização de produção.

## Limites conhecidos

Operação principal demonstrativa, `noindex` e Hobby não comercial, mesmo após o cutover concluído. Mercado Pago comprovou Pix aprovado/pendente, reconciliação e idempotência no sandbox; webhook e demais cenários continuam pendentes. Google comprovou vínculo explícito e novo login na mesma conta do titular, com aplicativo básico publicado como Externo/Em produção; demais caminhos ainda exigem validação própria. Resend teve entrega controlada comprovada, mas redefinição completa e demais fluxos ainda exigem validação. Preços Liga automáticos sem acesso licenciado, raridade resumida TCGdex parcial, fotos pessoais sem upload privado, logística sem chave e sem checkout real, automação de carrinho desativada, dados empresariais/políticas ainda incompletos. Dependências atuais em [PENDENCIAS.md](PENDENCIAS.md).

## Proteção durante a migração

A rodada integral local mais recente aprovou **213/213 testes**, além de sintaxe e build, incluindo regressão do guard `BKM_MAINTENANCE_MODE` em `api/index.js`. Quando ativo, toda a API retorna HTTP 503 com `Retry-After: 60` antes de inicializar o banco. O teste comprova esse bloqueio. Separadamente, o cutover real foi encerrado com **`BKM_MAINTENANCE_MODE=false` e HTTP 200**, conforme a verificação de infraestrutura acima; o QA completo dos fluxos segue com os limites registrados.
