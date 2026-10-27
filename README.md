# BKM TCG

E-commerce de Pokémon TCG e gerenciador privado de coleções. A identidade BKM e a animação 3D do booster com Pikachu são preservadas. Produção e homologação financeira usam projetos e bancos separados.

- Loja: [lojabkm.com.br](https://lojabkm.com.br/).
- [Guia de operação e compra com retirada](docs/OPERACAO-PRODUCAO.md).
- [Worker de reservas e e-mails, incluindo Supabase Cron no Hobby](docs/CRON-COMERCIO.md).
- [Relatórios históricos da fase 3](docs/RELATORIO-FASE3.md) e [validações anteriores](docs/VALIDACAO.md).

Esta versão acrescenta reserva de estoque de 15 minutos antes do pagamento, retomada do pedido, frete grátis configurável, tarifas regionais, retirada/entrega local e comunicação por etapa. O catálogo demonstrativo do banco principal foi arquivado com backup: a oferta comercial depende de cadastrar e publicar estoque real pelo painel. Contas, pedidos e coleções pessoais foram preservados.

Credenciais, ativação de pagamentos e execução do scheduler são configurações privadas do ambiente; a presença do código não comprova uma compra real. A validação final de recebimento e liquidação ocorre na compra realizada pelo cliente e na conta Mercado Pago do vendedor.

## Abrir localmente

Use Node.js **22.13 ou mais recente na versão 22**. No Windows, execute **ABRIR SITE.cmd**. O inicializador prepara as dependências e abre a loja em [localhost:4173](http://localhost:4173/). Administração: [localhost:4173/admin](http://localhost:4173/admin). Mantenha o servidor aberto.

Em uma instalação nova:

```powershell
npm ci
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
npm run db:migrate
npm run demo:seed
npm start
```

O `.env` privado determina o banco. `DATABASE_URL` usa PostgreSQL; sem ela, o desenvolvimento utiliza SQLite. Confira o destino antes de migrar, importar ou popular dados. O seed é restrito à demonstração e preserva alterações administrativas. `ABRIR.html` contém somente a animação offline; no servidor esse endereço redireciona à loja completa.

Para um banco novo, `CONFIGURAR ADMIN.cmd` ou `npm run admin:create` cria o primeiro administrador por entrada interativa. Não há senha padrão no código. A instalação principal já possui administração; não repita bootstrap para apenas entrar nela. Nunca publique credenciais.

## Loja e administração

- Catálogo persistente de lacrados e cartas avulsas, organizado por coleção, com busca, filtros, ordenação, imagens, zoom e relacionados.
- Carrinho com drawer, favoritos de produtos, cupons e checkout Pix/cartão quando configurado; simulação apenas em demonstração. Pedidos mantêm snapshots, histórico, reserva e baixa transacional de estoque; repetições idempotentes não criam nova baixa.
- Painel para produtos, variantes, estoque, imagens, coleções e aliases, pedidos, rastreamento informado, cupons, banners, configurações, e-mails e status das integrações.
- Importação de identidade e metadados pela TCGdex, separada do preço, condição e estoque comercial.
- Header com SVGs locais reconhecíveis e navegação de perfil em desktop e celular.

O seed inicial contém 14 produtos e quatro coleções; o conteúdo atual pode incluir edições e produtos de QA posteriores. Números históricos de estoque ou preços de teste não constituem oferta comercial vigente.

## Minha conta e Minha coleção

`/conta` reúne visão geral, fichários, cartas pessoais, faltantes, desejos, pedidos, endereços, dados, preferências, segurança e notificações. Essas informações são privadas por padrão, protegidas no servidor por sessão e propriedade dos registros.

O cliente pode acompanhar coleções de referência, definir objetivo básico ou personalizado, consultar checklist visual e adicionar cartas individualmente ou em lote. Lotes distintos preservam quantidade, idioma, condição, variante, custo unitário, aquisição e notas. Cartas pessoais não precisam estar anunciadas na loja e não alteram seu estoque. Uma compra não é marcada automaticamente como carta recebida.

Desejos guardam identidade e preferências, inclusive para cartas sem anúncio. Disponibilidade considera anúncio publicado, estoque e compatibilidade. Há notificações internas e alertas por e-mail com consentimento e deduplicação. Um resumo controlado foi efetivamente enviado ao único titular autorizado e confirmado **DELIVERED** por webhook real, com um evento e um e-mail, sem reenvio. O teste antecipou somente o evento de homologação e usou Run manual da Vercel; não comprova disparo natural do calendário nem alerta imediato. Preferências foram restauradas e o desejo temporário removido. Marketing e carrinho são separados; carrinho abandonado permanece sem automação ativa.

O QA pela API publicada passou **41 verificações** de coleção, lotes, filtros, avaliação manual, CSV, persistência e privacidade. A conta de QA conserva 9 unidades: 3 avaliadas por referência manual, total conhecido de R$ 45,00, e 6 sem cotação. O objetivo básico tem 217 cartas; o personalizado comprovou 295 identidades com secretas e 590 alvos ao exigir duas variantes. Esses valores são dados de teste, sem cotação automática de mercado. A coleção também foi conferida em viewport móvel de 390 × 844, sem overflow horizontal; isso não encerra a matriz visual das demais jornadas.

O QA HTTP publicado também confirmou login de cliente e administrador, cookies Secure/HttpOnly/SameSite=Lax, bloqueios 403 de origem inválida e CSRF ausente, sessão revogada após logout e carrinho preservado com um item. O catálogo público tinha 15 produtos e o painel, 16 incluindo registros não públicos. Raiz respondeu 200 e `www`/alias, 308 preservando rota e parâmetros. Outro roteiro cadastrou **duas contas fictícias CUSTOMER**, uma por entrada raiz e outra por `www`, sempre com POST na origem canônica; login posterior e revogação passaram. O e-mail de boas-vindas foi bloqueado pela lista estrita de destinatários, sem envio externo. Caminhos Google adicionais e toda a matriz visual permanecem sem prova completa.

Importação CSV oferece validação, prévia, erros, duplicatas, confirmação e consolidação opcional; exportação preserva lotes e referências disponíveis. Fotos pessoais são URLs HTTPS informadas pelo titular; **não existe upload privado de fotos pessoais nesta entrega**. O upload administrativo de produtos continua no Storage Supabase.

## Referências de valor

A avaliação mostra valor conhecido, unidades sem cotação e cobertura, mantendo custo de aquisição separado. Histórico nasce de registros e snapshots reais, sem reconstruir preços passados.

Há referências manuais privadas do cliente e referências globais administradas em `/admin/precos`, com CSV, fonte, data, moeda BRL e confirmação de direitos. Elas são armazenadas separadamente. O conjunto global está vazio nesta etapa: não foram inventadas cotações para preencher a interface. Referência manual não é mediana automática nem preço oficial da Liga Pokémon.

Não foi estabelecido acesso automatizado autorizado à Liga Pokémon. Não há scraping, contorno de bloqueios ou equivalência presumida entre preços estrangeiros e o mercado brasileiro. Consulte [docs/PRECOS.md](docs/PRECOS.md).

## Arquitetura e integrações

Frontend HTML/CSS/JavaScript, `personal-ui.js` para o espaço do colecionador e Three.js local para a animação. Backend Node modular, PostgreSQL Supabase e Storage dedicado. A publicação Vercel usa frontend em `dist/` e função Node em `api/index.js`; não depende de processo permanente ou filesystem persistente da função.

A autenticação BKM foi mantida: scrypt, sessões com token armazenado como hash, cookie HttpOnly/SameSite/Secure em HTTPS, CSRF e RBAC. As migrations versionadas incluem coleção pessoal, identidades OAuth, eventos de e-mail e referências globais; RLS protege tabelas da aplicação. Não houve migração para um segundo cadastro Supabase Auth.

Google OIDC usa Authorization Code, PKCE, state/nonce e validação no servidor. O titular autenticou sua conta BKM, confirmou o vínculo explícito e conseguiu sair e entrar novamente pelo Google na mesma conta. Foram observadas 0 coleções nessa conta; o teste não comprova preservação de um acervo preenchido. O aplicativo foi publicado como **Externo, Em produção**, para login básico com `openid`, `email` e `profile`. Isso não constitui verificação avançada pelo Google nem prova dos demais caminhos. Cliente Google e segredos Resend estão privados e configurados em Production. Resend teve envio e entrega de recuperação confirmados em teste controlado, com webhook assinado e replay idempotente; nenhuma senha foi alterada. Na Vercel, `NODEJS_HELPERS=0` preserva o corpo bruto necessário ao webhook. Receita e limites em [docs/DEPLOY.md](docs/DEPLOY.md).

Mercado Pago permanece mock na instalação principal. No sandbox separado, as duas orders Pix técnicas originais, de R$ 50,00 nominais cada, foram consultadas no provedor e no banco: uma **APPROVED**, com reserva **COMMITTED**, e a outra, antes pendente, agora **EXPIRED**, com reserva **RELEASED**. O simulador oficial enviou callbacks para ambas com **HTTP 200**, e foram conferidos **2 recibos autenticados por order**. Naquele snapshot havia 2 pedidos, uma única baixa de estoque de 2 para 1 e idempotência comprovada; essa evidência histórica foi preservada. A incompatibilidade HMAC do ID exato foi corrigida com validação integral das formas exata e canônica, comparação em tempo constante e replay unificado. Não houve cobrança comercial ou transferência Pix real. Cronologia e limites em [docs/HOMOLOGACAO-MP.md](docs/HOMOLOGACAO-MP.md).

O carregador do SDK Mercado Pago foi corrigido para o endereço [oficial `https://sdk.mercadopago.com/js/v2`](https://github.com/mercadopago/sdk-js), publicado em `09dcc61`. O Brick real tokenizou cartões oficiais de teste: `OTHE` foi recusado e liberou a reserva; `APRO` foi aprovado e comprometeu uma unidade. O mesmo APRO foi depois reembolsado integralmente: **um POST 201**, R$ 50,00 nominais confirmados no provedor, estado local **REFUNDED** e segundo recibo webhook autenticado. Permaneceram **4 pedidos, estoque 0 e 2 baixas acumuladas**; reembolso financeiro não repôs automaticamente o produto. Pendência por cartão, cancelamento solicitado, reembolso parcial e demais cenários continuam pendentes. Nenhuma cobrança comercial foi realizada.

O adaptador Melhor Envio permite somente cotação e consulta de etiquetas existentes no sandbox; foi testado com transporte controlado, está sem chave e não está ligado ao checkout. Não compra etiquetas. Detalhes: [docs/LOGISTICA.md](docs/LOGISTICA.md).

## Segurança operacional, testes e publicação

```powershell
npm run check
npm test
npm run build
```

A revisão `4ca7a0c` aprovou **265 testes locais, sintaxe e CI**, com deployments Success. Ela reconhece reembolso integral moderno somente com itens de reembolso completos vinculados ao pagamento e soma exata; o cenário integral do cartão APRO foi comprovado externamente no sandbox. Os CIs de `09dcc61`, com 260 testes, e `e07241b`, com 216, permanecem históricos. Os testes usam identidades e bancos isolados; provas externas e limites estão em [docs/VALIDACAO.md](docs/VALIDACAO.md).

A última cópia manual AES-256-GCM comprovada do principal, após a migration 008, registrou **41 tabelas, 199 registros e 2 objetos**, com restauração em SQLite novo e isolado, `integrity=ok` e `remoteTarget=false`. Os snapshots anteriores de 233 e 244 registros e a migração de 230 permanecem preservados; contagens variam com o uso e a expiração de sessões. Chave e conteúdo ficam privados, fora de Git e ZIP público. Retenção continua manual, sem agendamento ativo. Hashes e procedimento em [docs/BACKUP.md](docs/BACKUP.md).

A hospedagem mantém o plano escolhido pelo proprietário. O scheduler frequente pode ser executado pelo Supabase; o cron nativo diário da Vercel é mantido. A ativação comercial é explícita e depende de credenciais de produção e catálogo real, conforme os guias de operação e worker.

Configuração e estado: [docs/DEPLOY.md](docs/DEPLOY.md). Contratos: [docs/INTEGRACOES.md](docs/INTEGRACOES.md). Dependências restantes: [docs/PENDENCIAS.md](docs/PENDENCIAS.md).

## Recursos visuais

Logo, pacote e Pikachu foram fornecidos pelo proprietário. Fontes dos produtos demonstrativos: [docs/IMAGENS-DEMO.md](docs/IMAGENS-DEMO.md). Three.js mantém licença MIT em `vendor/LICENSE`. A animação é uma reconstrução própria em tempo real, sem reutilização dos frames de referência ou inclusão de graduação/slab.

O guard `BKM_MAINTENANCE_MODE=true` permite bloquear a API antes de inicializar o banco, com HTTP 503 e `Retry-After: 60`, em futuras manutenções. Após esta migração, Production está com `BKM_MAINTENANCE_MODE=false` e HTTP 200 confirmado.
