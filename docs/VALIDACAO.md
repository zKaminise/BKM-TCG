# Validação — BKM TCG Fase 3

## Estado em 21/10/2026 — resumos publicados e provas externas

Site canônico: [lojabkm.com.br](https://lojabkm.com.br/). Repositório: [zKaminise/BKM-TCG](https://github.com/zKaminise/BKM-TCG), branch `main`. Diretório: `D:\Importante\Codex\LP Vendas TCG Site`.

O núcleo inicial foi publicado no [commit `d109af2`](https://github.com/zKaminise/BKM-TCG/commit/d109af2), com [CI histórico de 211 testes](https://github.com/zKaminise/BKM-TCG/actions/runs/39399711168). O marco publicado de HMAC aprovou **216/216 testes**, `npm run check` e `npm run build`; o [CI 39527731133](https://github.com/zKaminise/BKM-TCG/actions/runs/39527731133) terminou com sucesso no [commit `e07241b`](https://github.com/zKaminise/BKM-TCG/commit/e07241bb5f0f867f6e645d052337d263649ea3a6). Deployments Ready desse marco: principal **`Ee3sN23zaPVCWC2o88hSpDAbdsvX`** e sandbox **`3P5n5werWo7tMdtxdXX5AsJQrVaG`**. O principal migrado responde HTTP 200. Às **22:31 BRT de 20/10 (01:31 UTC de 21/10)**, callbacks oficiais dos dois cenários Pix sandbox estavam comprovados com HTTP 200 e recibos autenticados. Cartão, reembolso e demais cenários financeiros não estão homologados por essa prova.

A revisão de resumos foi publicada no [commit `0f8388a`](https://github.com/zKaminise/BKM-TCG/commit/0f8388a450ae3a4485d2f48c67e9e1802cb87643), com **260/260 testes**, sintaxe e build aprovados e [CI 39579166466 concluído com sucesso](https://github.com/zKaminise/BKM-TCG/actions/runs/39579166466). Deployments Success desse marco: principal **`6zQ4yMe3sWHjaFwFKdXSZodhq1bv`** e sandbox **`F8P43oDZD5ucUF7XeHZhw2MpycEN`**. Esse marco incluiu migration 008, eventos persistidos, templates e consumidor protegido. A configuração e o disparo manual autorizado do cron foram comprovados posteriormente, conforme a seção própria; resumo controlado entregue; alerta imediato e disparo agendado natural continuam pendentes.

A publicação confirmada do carregador do SDK Mercado Pago está no [commit `09dcc61`](https://github.com/zKaminise/BKM-TCG/commit/09dcc6123d7ebb4c3dd73c8e210ea7350397d513), com [CI 39580433525 concluído com sucesso em 260 testes](https://github.com/zKaminise/BKM-TCG/actions/runs/39580433525). Deployments Success: principal **`HHmKyEQGTwKjVstAvPqpA3SMchtQ`** e sandbox **`BK6ejxE1yYh4gUmeEKnv1E17S2e5`**. Os testes posteriores pelo Brick real comprovaram formulário, tokenização, recusa `OTHE` com liberação e aprovação `APRO` com comprometimento de uma unidade. A prova posterior do cron está registrada abaixo; resumo controlado entregue; alerta imediato e disparo agendado natural continuam pendentes.

A revisão [`4ca7a0c`](https://github.com/zKaminise/BKM-TCG/commit/4ca7a0cfcf119d37dd7738afa6b9f5ea6ad02c96) aprovou **265/265 testes locais, sintaxe e [CI 39581860955](https://github.com/zKaminise/BKM-TCG/actions/runs/39581860955)**. Ela cobre reembolso integral moderno com itens completos ligados ao pagamento e soma exata, sem promover parciais ou mistos a finais. A prova externa integral do APRO foi concluída depois, abaixo. O código atual [`fdbb91c`](https://github.com/zKaminise/BKM-TCG/commit/fdbb91c6bf24f0306c98e2fb17ed407d87bee1a6) também traduz o estado na interface para **Reembolsado**, com [CI 39642646628 aprovado](https://github.com/zKaminise/BKM-TCG/actions/runs/39642646628), suíte de 265 testes e deployments Success: principal **`GRuxVzXNnseYFDWhBYD1a4TrbCij`** e sandbox **`AVSCdA9YAMiJ4LPAxdMzApFMLbVM`**.

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
- Dois testes adicionais para diagnóstico seguro do webhook Mercado Pago: somente marcador e motivo de uma lista permitida nos logs, sem dados da requisição e sem alterar a resposta pública.
- Compatibilidade HMAC entre ID exato da query e forma canônica, com comparação integral em tempo constante e replay unificado; as validações de assinatura, tempo, origem do identificador e reconciliação financeira permanecem exigidas.
- Eventos de resumo persistidos em SQLite e PostgreSQL/PGlite, consolidação diária/semanal por titular, idempotência concorrente, limites de lote, atualização de preferências e revalidação de consentimento, propriedade, desejo e disponibilidade.
- Job `/api/jobs/email` com Bearer privado e comparação em tempo constante, rejeição sem banco antes de autorização, limites de titulares, mensagens e tempo; templates de desejos com identidade, preço, links seguros e escape. Bloqueio de reenvio ambíguo antigo fora da janela segura de idempotência Resend.
- Preparação parcial do resumo somente na primeira tentativa, com claim atual e lease vigente, preservando cartas ainda elegíveis, descartando as removidas e persistindo o payload antes do provedor. Retries mantêm o payload sob a mesma chave idempotente; workers vencidos e alterações posteriores não o reescrevem.

A suíte usa identidades e bancos isolados, incluindo PostgreSQL embarcado via PGlite. Ela não deve carregar o `.env` privado real. Não executar testes financeiros contra o principal para substituir o isolamento. Testes automatizados não equivalem a homologação Google, Resend ou Mercado Pago externos.

## Infraestrutura e dados confirmados nesta etapa

- Migração PostgreSQL para PostgreSQL concluída para **BKM ecommerce** (`cxoeompxmgdzufgzxerw`): **40 tabelas, 230 registros e 2 objetos Storage**, com conferência de SHA-256, relacionamentos, sequências, esquema e origem inalterada. Autenticação BKM e identidades existentes preservadas, sem cadastro Supabase Auth paralelo.
- Após a migration **008**, leitura PostgreSQL no principal e sandbox confirmou **esquema 8, 41 tabelas, 41 com RLS e zero grants públicos**. Nenhum evento de resumo estava pendente no momento da consulta. Nova chave de serviço continua guardada privadamente.
- Vercel Production usa as novas `DATABASE_URL`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`; o `.env` local também foi atualizado. O banco anterior (`nxrvmanifngjmdtgnzoq`) e a configuração `.env.old-main` permanecem preservados.
- Auditoria no novo banco: **3 usuários, 4 pedidos, 2 referências de imagens no novo projeto e 0 no anterior**. Após `BKM_MAINTENANCE_MODE=false`, o domínio respondeu **HTTP 200**, com `/api/config` indicando **demo, mock, `canCharge=false` e Google habilitado**; o catálogo retornou **15 produtos** no momento da consulta.
- Domínio canônico `https://lojabkm.com.br`; `www` e alias com 308 preservando rota/query. O caminho `/cadastro`, por raiz e entrada `www`, foi exercitado no roteiro separado de cadastro abaixo.
- Cliente Google e chaves Resend privados, configurados em Vercel Production. Após o consentimento/callback inicial `link-required`, o titular fez login BKM, confirmou o vínculo explícito e saiu/entrou pelo Google na mesma conta. Foram observadas 0 coleções. A audiência Google foi publicada como **Externo / Em produção**, com scopes básicos `openid`, `email` e `profile`. Isso não alega verificação avançada nem ausência de limites. Resend possui a evidência específica abaixo.
- Mercado Pago `/users/me` confirmou vendedor de teste; principal mock e produção financeira desativada. O Vercel **`bkm-tcg-sandbox`** tem deployment Success **`AVSCdA9YAMiJ4LPAxdMzApFMLbVM`**, com Supabase isolado **`secapcqqznlokiqhojsa`**, **TLS verificado e 41 tabelas no esquema 8**. Antes da fixture, usuários/produtos/pedidos eram 0. A verificação real aprovou staging/sandbox e `canCharge=false`; Pix, cartões `OTHE`/`APRO` e reembolso integral do APRO foram comprovados nos registros abaixo. Chaves permanecem privadas e não houve cobrança comercial.
- Referências globais autorizadas da migration 007 com conjunto vazio neste marco. Nenhuma cotação foi inventada para gerar métricas.

## Backup e restauração reais

Foram registrados os seguintes marcos de backup, sem exposição de conteúdo privado:

| Marco | Conteúdo observado | Resultado |
| --- | --- | --- |
| Snapshot inicial | 22 tabelas, 177 registros, 2 imagens | AES-256-GCM; restauração isolada validada |
| Snapshot posterior, antes da migration 007 | 38 tabelas, 202 registros, 2 imagens | Arquivo criptografado e restauração isolada confirmados |
| Novo principal após o cutover, 20/10 | 40 tabelas, 233 registros, 2 objetos | AES-256-GCM; restauração em SQLite novo, esquema 7, integridade `ok`, zero violações de chave estrangeira e hashes dos objetos conferidos |
| Principal após o vínculo Google, 20/10 | 40 tabelas, 244 registros, 2 objetos | AES-256-GCM; novo SQLite isolado, `restored=true`, `integrity=ok`, `remoteTarget=false` |
| Principal após a migration 008, 21/10 | 41 tabelas, 199 registros, 2 objetos | AES-256-GCM; novo SQLite isolado, `restored=true`, `integrity=ok`, `remoteTarget=false` |

São contagens de momentos distintos: **230 registros na migração**, **233 no primeiro backup após o cutover**, **244 na cópia posterior ao vínculo Google** e **199 após a migration 008**. Os snapshots anteriores permanecem preservados; a contagem varia com o uso, dados de QA e expiração de sessões, sem equivalência com quantidade de clientes ou pedidos. As restaurações foram somente em arquivos SQLite novos e isolados; não houve restauração no PostgreSQL remoto. Bancos restaurados e objetos permanecem privados. Chave de backup fica fora do repositório e do ZIP público, com necessidade de cópia segura separada. Retenção é manual; não existe automação de backup ou descarte ativa. Arquivos, SHA-256 e procedimento em [BACKUP.md](BACKUP.md).

## Cron publicado e disparo manual autorizado

A interface Vercel confirmou o cron diário **Enabled / 12:00 UTC**. Um disparo manual pelo painel alcançou a função do deployment diretamente, sem depender do redirecionamento do alias. O log de **21/10 às 09:44:59 UTC (06:44:59 BRT)** registrou **401 `JOB_UNAUTHORIZED`** por falta da chave. Isso comprova encaminhamento e guard de autorização; **não representa execução autorizada, processamento da fila ou envio de e-mail**.

Após configurar a chave Secret em Production e redeploy, o disparo manual pelo painel Vercel alcançou **`GET /api/jobs/email` com HTTP 200 em 21/10 às 17:16:27 UTC (14:16:27 BRT), horário do log Vercel**. Isso comprova o caminho autenticado do scheduler; a chamada local com Bearer diferente continuou **401** e não é contada como aprovada. Os 401 anteriores permanecem históricos. Um Run manual posterior causou a entrega do resumo controlado abaixo. Ainda faltam alerta imediato e observação de disparo agendado natural. `/api/config` manteve HTTP 200, Google habilitado, demo, mock e `canCharge=false`.

## Resumo de desejos entregue — teste controlado em 21/10

O helper privado `work/test-owner-wishlist-digest.cjs` preparou somente o evento de homologação destinado ao único titular autorizado. A prova `work/resend-owner-digest-delivered.json` confirmou **1 evento QUEUED, 1 e-mail SENT/DELIVERED e 1 callback real `email.delivered`**, sem reenvio. O Run manual da Vercel acionou o consumidor; aceitação e entrega não foram inferidas apenas do HTTP 200.

Para exercitar o fluxo no mesmo dia, somente o vencimento desse evento de homologação foi antecipado de **22/10 às 12 UTC para 21/10**; a preferência de **24 horas permaneceu inalterada**. Essa prova valida consolidação, envio e entrega controlados, **sem provar disparo natural diário/semanal nem alerta imediato**. Relógios dos helpers e logs Vercel apresentaram diferença; não calcular latência nem ordenar precisamente eventos de fontes distintas pelos timestamps.

O encerramento em `work/resend-owner-digest-observation.json` confirmou **`preferencesRestored=true`, `temporaryWishRemoved=true` e zero pendências alheias**. A conta do titular manteve suas preferências originais e o desejo temporário foi removido. Não houve envio a outros destinatários ou ampliação da lista autorizada. Essa evidência não homologa os demais modelos de e-mail.

## QA funcional pela API publicada

O registro privado `work/phase3-published-collection-qa.json` concluiu **41 verificações com sucesso** em `https://lojabkm.com.br`. Foram exercitados login com sessão rotacionada, bloqueio anônimo, acompanhamento idempotente de coleção, checklist independente do estoque, lotes distintos por condição/idioma/variante, alteração de quantidade, filtros, desejos compatíveis com anúncios publicados, CSV válido/inválido, confirmação idempotente, exportação, logout, novo login e persistência. Essa prova usa HTTP na aplicação publicada, sem representar QA visual ou OAuth.

Na conta de QA de Heróis Excelsos ficaram preservadas **9 unidades**, **3 unidades com referência manual** e **6 sem cotação**; valor conhecido de **R$ 45,00** e custo unitário multiplicado de **R$ 55,00**, sem transformar custo em cotação. O objetivo básico confirmou **217 cartas**; o personalizado, **295 identidades com secretas** e **590 alvos** ao exigir duas variantes. Posse de reversa não preencheu automaticamente a variante normal.

Uma segunda sessão administrativa existente recebeu **404** ao tentar ler checklist, alterar lote, alterar desejo e confirmar token CSV de outra conta. Leituras pessoais, referências privadas e exportação dessa segunda conta não expuseram os dados do cliente de QA. A função administrativa não sobrepôs a propriedade dos registros pessoais.

Limites observados: a primeira inclusão de desejo recebeu **503 `CATALOG_UNAVAILABLE`** da integração TCGdex e passou na repetição; a dependência externa pode ficar indisponível. Uma credencial antiga alternativa recebeu **401**; a prova entre contas utilizou outra sessão administrativa existente, sem reset ou recriação. O roteiro não publicou produto nem enviou e-mail e conservou o consentimento de alertas desativado. A entrega real de desejos permanece uma prova separada.

## Autenticação, catálogo e domínios — QA HTTP publicado

`work/phase3-published-auth-qa.json` concluiu o roteiro no domínio publicado, com login de cliente e administrador **HTTP 200**, cookies **Secure, HttpOnly e SameSite=Lax**, sessão persistente, rejeição de POST por origem inválida e CSRF ausente **403**, e sessão do cliente rejeitada **401** após logout. O carrinho manteve **1 item antes e depois**, sem criar pedido ou alterar os dados da conta. A credencial antiga recusada 401 permanece no histórico; não houve reset para contornar essa falha.

O catálogo público tinha **15 produtos** e o administrativo **16**, incluindo registros não públicos. A raiz HTTPS respondeu **200**; `www` e alias Vercel responderam **308**, preservando caminho e query. Cliente não obteve acesso ao catálogo administrativo. O relatório confirmou `complete=true`, zero e-mails externos e zero pedidos criados; login administrativo não é prova de todas as escritas do painel. Esse primeiro roteiro não incluiu cadastro novo, coberto separadamente abaixo, nem caminhos Google adicionais ou matriz visual completa. A revogação após logout foi comprovada explicitamente para a sessão do cliente.

## Cadastro pelas entradas raiz e www — QA HTTP publicado

`work/phase3-published-signup-qa.json` concluiu dois cadastros com fixtures fictícias em domínio reservado inválido, sem usar dados do titular. Para raiz e entrada `www`, o fluxo conferiu redirecionamento **308 preservando caminho/query**, GET da origem canônica **200** e POST canônico **201**, com papel **CUSTOMER**. Cookies **Secure/HttpOnly/SameSite=Lax**, sessão/perfil **200**, carrinho vazio, logout com revogação **401**, novo login **200** e nova revogação **401** foram comprovados.

A leitura PostgreSQL confirmou os e-mails de boas-vindas das fixtures em **FAILED / `EMAIL_TEST_RECIPIENT_FORBIDDEN`**, com `provider_id=null` e uma tentativa definitiva: a lista estrita do titular impediu envio externo. Não interpretar esses registros como e-mails enviados ou como homologação de entrega de boas-vindas.

No principal, usuários passaram de **3 para 5**, exclusivamente pelas duas fixtures de QA. **Pedidos 4 → 4, produtos administrativos 16 → 16, estoque agregado 70 → 70 e outbox pendente 0 → 0** permaneceram preservados. Credenciais das fixtures ficam privadas; nenhum reset de conta existente foi realizado. Essa prova não inclui cadastro Google ou toda a matriz visual.

## Validação visual da Fase 3

Foram preparados layout de conta/fichário, SVGs locais no header, checklist visual, formulários e painel de referências. A execução principal conferiu a coleção no domínio publicado em viewport móvel **390 × 844**, sem overflow horizontal: largura do documento observada de 375 px para viewport de 390 px. A captura `outputs/fase3-colecao-mobile-validada.png` registra essa prova. Ela não representa toda a matriz visual de conta, checkout e administração.

A tentativa anterior do subagente recebeu inventário de navegador vazio e não gerou screenshots, portanto continua **sem valor de prova visual**. A captura móvel posterior foi obtida pela execução principal, separadamente. A navegação corrigida do menu de perfil também possui a captura `outputs/fase3-perfil-menu-corrigido.png`; os demais fluxos desktop/mobile ainda exigem conferência própria.

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
- Atualização de diagnóstico no commit `bbd5cc0`, com [CI histórico de 215 testes aprovado](https://github.com/zKaminise/BKM-TCG/actions/runs/39449322132). A correção seguinte de HMAC está em `e07241bb5f0f867f6e645d052337d263649ea3a6`, com [CI 39527731133 aprovado e 216 testes](https://github.com/zKaminise/BKM-TCG/actions/runs/39527731133). Deployments Ready desse marco: principal `Ee3sN23zaPVCWC2o88hSpDAbdsvX` e sandbox `3P5n5werWo7tMdtxdXX5AsJQrVaG`; a publicação posterior de `0f8388a` está registrada no início deste documento.
- Configuração Production trocada para o novo principal após a migração, manutenção desativada e HTTP 200. As contagens, referências Storage e permissões auditadas estão registradas acima.
- Após o retorno Google inicial `link-required`, o titular autenticou sua conta BKM, confirmou o vínculo explícito, saiu e entrou novamente pelo Google. O nome e a identidade observados continuaram na mesma conta; foram observadas 0 coleções. Isso comprova vínculo e novo login controlados, sem associação automática por e-mail, mas não preservação de um acervo preenchido.
- A audiência Google foi publicada; a interface mostrou **Em produção**, **Externo** e a opção **Voltar para o teste**, com captura `outputs/google-login-publicado.png`. O escopo é apenas login básico `openid`, `email` e `profile`, sem Gmail/Drive. Essa prova não representa verificação avançada Google nem comprova ausência de limites; cadastro novo, cancelamento e demais caminhos continuam sem prova própria.
- Em 20/10, um único teste de recuperação para a conta existente do titular confirmou `SENT` e `DELIVERED` por webhook Svix assinado com HTTP 200. Repetir o mesmo evento retornou 200 sem duplicação nem novo envio. A conta e sua senha permaneceram inalteradas; essa evidência comprova envio, entrega e idempotência do evento, não o fluxo completo de redefinição ou todos os modelos de e-mail.
- `NODEJS_HELPERS=0` em Production, seguido de redeploy, corrigiu a disponibilidade do corpo bruto para validação Svix. O endpoint continuou exigindo assinatura válida; não houve desativação da verificação. Receita e [fonte oficial Vercel](https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration) em [DEPLOY.md](DEPLOY.md).

O QA HTTP de conta/coleção, CSV, desejos, sessão, isolamento, carrinho preservado, catálogo administrativo, redirecionamentos e cadastro pelas entradas raiz/`www` está consolidado acima. Ainda faltam demais operações do painel e matriz visual desktop/mobile. Demais caminhos Google, uso final do link de recuperação com mudança de senha, alerta imediato, disparo agendado natural e cenários financeiros não cobertos pelas provas Pix/cartão/reembolso integral continuam pendentes. O resumo controlado entregue não homologa todos os modelos de e-mail.

## Mercado Pago: prova real no sandbox de 20/10

- Histórico inicial: `--verify` confirmou vendedor `test_user`, staging/sandbox e **`canCharge=false`**. O `--run` criou **2 orders Pix técnicas de R$ 50,00 nominais cada**: uma aprovada por reconciliação e outra pendente. Havia 1 reserva `COMMITTED`, 1 `ACTIVE`, uma baixa de estoque e idempotência comprovada. O relatório inicial com **`webhookProven=false`** e `complete=false` foi preservado; `backups/mp-sandbox-before-signature-rotation.json` conserva a evidência histórica. Não houve transferência bancária real nem cobrança comercial.
- A aplicação emissora `8997426787542730` foi conferida na conta vendedora de teste, com URLs e evento Order. O usuário redefiniu a assinatura; após recarregar o painel, sua igualdade com a configuração privada foi confirmada. As tentativas que ainda retornaram 401 após essa etapa permanecem históricas.
- Causa confirmada pelo log com assinatura real em **`2026-10-21T01:23:46.564Z`**: **`exactIdMatches=true`**. O emissor assinava o ID exato em maiúsculas e a implementação validava somente a forma canônica em minúsculas. O commit `e07241b` compara ambos os HMACs integrais em tempo constante, com replay unificado. Query única, janela temporal, GET autoritativo e validações financeiras foram preservados.
- Prova oficial após deploy: callbacks do simulador do painel para os **mesmos IDs aprovados e expirados**, ambos **HTTP 200**. Capturas `outputs/mercadopago-webhook-aprovado-200.png` e `outputs/mercadopago-webhook-expirado-200.png`. Deployments Ready: principal **`Ee3sN23zaPVCWC2o88hSpDAbdsvX`**, sandbox **`3P5n5werWo7tMdtxdXX5AsJQrVaG`**.
- **`backups/mp-sandbox-final-evidence.json`**, obtido por GET Mercado Pago e leitura PostgreSQL em **`2026-10-21T01:31:42.569Z` (20/10 às 22:31 BRT)**: primeira order **APPROVED** no provedor e na BKM, reserva **COMMITTED**; segunda, antes pendente, **EXPIRED** em ambos, reserva **RELEASED**. Foram conferidos **2 recibos autenticados por order**, **2 pedidos**, **1 reserva comprometida**, **1 liberada**, uma única baixa e estoque físico **2 → 1**. A evidência registra **`idempotencyPreviouslyConfirmed=true`** e **`observedScenariosConfirmed=true`**.
- A prova final Pix comprova os cenários observados e seus callbacks oficiais, com recurso verdadeiro consultado. Ela não representa cobrança comercial nem prova de cartão ou reembolso. Os cartões recusado e aprovado pelo Brick foram comprovados depois, em registros separados abaixo; pendência por cartão, cancelamento solicitado, reembolso parcial e retries de longa duração continuam pendentes.

## Limites conhecidos

### Carregador do SDK Mercado Pago — 21/10

`loadMercadoPagoSDK` apontava para `https://js.mercadopago.com/v2`, que falhava por resolução DNS (`ENOTFOUND`). A correção publicada em `09dcc61` usa [o endereço oficial `https://sdk.mercadopago.com/js/v2`](https://github.com/mercadopago/sdk-js), consultado com HTTP 200 e conteúdo JavaScript. A obtenção isolada do script não prova o fluxo financeiro; o teste posterior abaixo acrescenta a prova de formulário, tokenização e recusa.

### Cartão recusado pelo Brick real — 21/10 às 06:56 BRT

O navegador abriu o Card Payment Brick com iframes de campos seguros do Mercado Pago. Um cartão oficial de teste, cenário `OTHE`, foi tokenizado pelo SDK e originou a order BKM `4f216189-84a4-44bd-8029-80219d2cfeb2`, com valor nominal sandbox de **R$ 50,00**. A captura `outputs/mercadopago-cartao-primeira-observacao.png` registra a interface; não inclui credenciais em documentação.

A auditoria somente de leitura `work/mp-card-rejected-observation.json`, em **`2026-10-21T09:56:54.075Z`**, conferiu vendedor de teste e aplicação emissora corretos, GET autoritativo e PostgreSQL: order **CANCELLED**, pagamento **REJECTED**, provedor **failed/failed**, **1 recibo webhook autenticado**, reserva **RELEASED/1** e estoque ainda **1**. Naquele momento havia **3 pedidos**; comprometimento e baixa acumulados continuavam **1/1**, provenientes do Pix aprovado. Os relatórios Pix permaneceram inalterados.

A tentativa conservou `creationState=CREATED` e o código histórico `PAYMENT_PROVIDER_ERROR` da resposta inicial inconclusiva. O evento automático resolveu o estado para recusa, sem presumir que a primeira falha significasse ausência de order nem criar uma substituta automaticamente. Essa prova homologa o cenário observado de recusa pelo Brick, **sem homologar aprovação por cartão, cancelamento solicitado ou reembolso**. PAN, documento, token e credenciais não integram a evidência pública.

### Cartão aprovado pelo Brick real — 21/10

Uma segunda tokenização com cartão oficial de teste, cenário `APRO`, criou o pedido BKM **`7004c725-bde3-4aac-92f7-726d3293ea81`**, order **`ORDTST01M5EYMSJEGCBN6Z63NWFMXM78`**, valor nominal sandbox de **R$ 50,00**. A auditoria somente de leitura `work/mp-card-approved-observation.json` confirmou vendedor de teste e aplicação emissora corretos, GET autoritativo e banco: **CONFIRMED/APPROVED**, provedor **processed/accredited**, **1 recibo webhook autenticado** e reserva **COMMITTED/1**. Na observação após APRO havia **4 pedidos, estoque 0 e 2 unidades comprometidas e baixadas acumuladas**, uma do Pix e outra do cartão. Os relatórios Pix permaneceram inalterados.

Isso comprova aprovação do cenário de cartão observado e baixa de uma unidade, sem cobrança comercial. A prova posterior de reembolso integral está abaixo. Pendência por cartão, cancelamento solicitado e reembolso parcial não foram comprovados. Dados de cartão, documento e token não integram a documentação.

### Reembolso integral do cartão APRO — 21/10 às 14:15 BRT

O mesmo par de pedido/order APRO recebeu **um único POST de reembolso no sandbox, HTTP 201**, registrado em `work/mp-card-refund-post-result.json`. O GET autoritativo confirmou **REFUNDED**, um reembolso concluído e valor integral de **5.000 centavos**. A leitura posterior `work/mp-card-refund-observation.json`, concluída em **`2026-10-21T17:15:29.873Z`**, confirmou estado local e registro financeiro **REFUNDED**, com **2 recibos webhook autenticados acumulados**, um da aprovação e outro do reembolso.

A conferência independente `work/mp-card-refund-event-counts.json` distinguiu **1 transição financeira REFUNDED e 1 recibo autenticado REFUNDED**; não são duas transições de reembolso. Reserva continuou **COMMITTED/1** e permaneceram **estoque 0, 2 unidades comprometidas/baixadas e 4 pedidos**. O reembolso financeiro não repôs o produto nem criou nova order. O e-mail `order-refunded` ficou **PENDING**, no provedor development do sandbox; não houve prova de prévia ou envio Resend desse e-mail. O cenário integral está comprovado; repetição de POST de reembolso, reembolso parcial e demais cenários continuam sem prova externa própria.

Operação principal demonstrativa, `noindex` e Hobby não comercial. Mercado Pago comprovou Pix, cartões `OTHE`/`APRO` pelo Brick e reembolso integral do APRO no sandbox; pendência por cartão, cancelamento solicitado, reembolso parcial e demais cenários continuam pendentes. Google comprovou vínculo e novo login na mesma conta, com aplicativo básico Externo/Em produção; demais caminhos exigem prova própria. Resend comprovou recuperação e resumo controlado entregues, sem homologar alerta imediato, disparo agendado natural ou todos os modelos. Preços Liga automáticos seguem sem acesso licenciado, raridade TCGdex parcial, fotos pessoais sem upload privado, logística sem chave/checkout, carrinho automático desativado e dados empresariais/políticas incompletos. Dependências em [PENDENCIAS.md](PENDENCIAS.md).

## Proteção durante a migração

A suíte de **265/265 testes e sintaxe** passou em `4ca7a0c`; o CI posterior de `fdbb91c` também foi aprovado, com deployments Success e o rótulo Reembolsado corrigido na interface. O CI histórico de `09dcc61` passou em 260, além de sintaxe e build. O marco anterior de `e07241b`, com 216, incluiu regressão do guard `BKM_MAINTENANCE_MODE` em `api/index.js`, diagnóstico seguro e compatibilidade HMAC Mercado Pago. Quando ativo, o guard retorna HTTP 503 com `Retry-After: 60` em toda a API antes de inicializar o banco. Separadamente, o cutover real foi encerrado com **`BKM_MAINTENANCE_MODE=false` e HTTP 200**. As provas financeiras observadas estão registradas acima; os fluxos restantes seguem com seus próprios limites.
