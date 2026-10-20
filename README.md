# BKM TCG — Fase 3

E-commerce demonstrativo de Pokémon TCG e gerenciador privado de coleções pessoais. A identidade BKM — preto, vermelho, ciano e prata — e a animação 3D do booster com Pikachu foram preservadas.

- Site oficial: [lojabkm.com.br](https://lojabkm.com.br/).
- Repositório: [zKaminise/BKM-TCG](https://github.com/zKaminise/BKM-TCG), branch `main`.
- Diretório de trabalho: `D:\Importante\Codex\LP Vendas TCG Site`.
- Endereço anterior de demonstração: [bkm-tcg-demo.vercel.app](https://bkm-tcg-demo.vercel.app/).

**Estado em 20/10/2026:** o núcleo da Fase 3 foi publicado no domínio oficial, com o [commit `d109af2`](https://github.com/zKaminise/BKM-TCG/commit/d109af2), deployment Ready e [CI histórico aprovado com 211 testes](https://github.com/zKaminise/BKM-TCG/actions/runs/39399711168). O redeploy `NMSQa4gw1WfNTMa1BYQtvLVH1KFA` também ficou Ready. A migração do banco principal e a troca da configuração em Production foram concluídas; o site voltou a responder HTTP 200. A rodada local posterior aprovou **213 testes**, sintaxe e build. Provas e limites dos demais fluxos em [docs/VALIDACAO.md](docs/VALIDACAO.md).

O principal usa agora o Supabase **BKM ecommerce** (`cxoeompxmgdzufgzxerw`). A migração PostgreSQL para PostgreSQL preservou **40 tabelas, 230 registros e 2 objetos Storage**, com conferência de SHA-256, integridade, RLS e origem inalterada. As migrations **1–7** estão aplicadas, com **RLS nas 40 tabelas** e nenhum grant de tabelas para `anon`, `authenticated` ou `PUBLIC`. A auditoria posterior encontrou 3 usuários, 4 pedidos e as 2 referências de imagens apontando ao novo projeto, sem referência persistida ao Storage anterior.

As variáveis privadas de banco e Storage da Vercel Production e o `.env` local apontam ao novo principal. O banco anterior (`nxrvmanifngjmdtgnzoq`) e o `.env.old-main` foram preservados para continuidade. A manutenção foi encerrada; `/api/config` confirmou demonstração, pagamento mock, `canCharge=false` e Google habilitado, com 15 produtos observados no catálogo. Esse principal permanece separado da homologação financeira.

A instalação principal permanece em **demonstração, sem vendas ou cobranças reais**. Preços, estoque, frete e pedidos comerciais usados no QA são ilustrativos. A homologação Mercado Pago deve ocorrer em projeto e banco separados.

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
- Carrinho com drawer, favoritos de produtos, cupons e checkout demonstrativo. Pedidos mantêm snapshots, histórico, reserva e baixa transacional de estoque; repetições idempotentes não criam nova baixa.
- Painel para produtos, variantes, estoque, imagens, coleções e aliases, pedidos, rastreamento informado, cupons, banners, configurações, e-mails e status das integrações.
- Importação de identidade e metadados pela TCGdex, separada do preço, condição e estoque comercial.
- Header com SVGs locais reconhecíveis e navegação de perfil em desktop e celular.

O seed inicial contém 14 produtos e quatro coleções; o conteúdo atual pode incluir edições e produtos de QA posteriores. Números históricos de estoque ou preços de teste não constituem oferta comercial vigente.

## Minha conta e Minha coleção

`/conta` reúne visão geral, fichários, cartas pessoais, faltantes, desejos, pedidos, endereços, dados, preferências, segurança e notificações. Essas informações são privadas por padrão, protegidas no servidor por sessão e propriedade dos registros.

O cliente pode acompanhar coleções de referência, definir objetivo básico ou personalizado, consultar checklist visual e adicionar cartas individualmente ou em lote. Lotes distintos preservam quantidade, idioma, condição, variante, custo unitário, aquisição e notas. Cartas pessoais não precisam estar anunciadas na loja e não alteram seu estoque. Uma compra não é marcada automaticamente como carta recebida.

Desejos guardam identidade e preferências, inclusive para cartas sem anúncio. Disponibilidade considera anúncio publicado, estoque e compatibilidade. Há notificações internas e preparação de alertas por e-mail com consentimento e deduplicação. Preferências de marketing e carrinho são separadas; a automação de carrinho abandonado permanece desligada.

Importação CSV oferece validação, prévia, erros, duplicatas, confirmação e consolidação opcional; exportação preserva lotes e referências disponíveis. Fotos pessoais são URLs HTTPS informadas pelo titular; **não existe upload privado de fotos pessoais nesta entrega**. O upload administrativo de produtos continua no Storage Supabase.

## Referências de valor

A avaliação mostra valor conhecido, unidades sem cotação e cobertura, mantendo custo de aquisição separado. Histórico nasce de registros e snapshots reais, sem reconstruir preços passados.

Há referências manuais privadas do cliente e referências globais administradas em `/admin/precos`, com CSV, fonte, data, moeda BRL e confirmação de direitos. Elas são armazenadas separadamente. O conjunto global está vazio nesta etapa: não foram inventadas cotações para preencher a interface. Referência manual não é mediana automática nem preço oficial da Liga Pokémon.

Não foi estabelecido acesso automatizado autorizado à Liga Pokémon. Não há scraping, contorno de bloqueios ou equivalência presumida entre preços estrangeiros e o mercado brasileiro. Consulte [docs/PRECOS.md](docs/PRECOS.md).

## Arquitetura e integrações

Frontend HTML/CSS/JavaScript, `personal-ui.js` para o espaço do colecionador e Three.js local para a animação. Backend Node modular, PostgreSQL Supabase e Storage dedicado. A publicação Vercel usa frontend em `dist/` e função Node em `api/index.js`; não depende de processo permanente ou filesystem persistente da função.

A autenticação BKM foi mantida: scrypt, sessões com token armazenado como hash, cookie HttpOnly/SameSite/Secure em HTTPS, CSRF e RBAC. As migrations versionadas incluem coleção pessoal, identidades OAuth, eventos de e-mail e referências globais; RLS protege tabelas da aplicação. Não houve migração para um segundo cadastro Supabase Auth.

Google OIDC usa Authorization Code, PKCE, state/nonce e validação no servidor. O titular autenticou sua conta BKM, confirmou o vínculo explícito e conseguiu sair e entrar novamente pelo Google na mesma conta. Foram observadas 0 coleções nessa conta; o teste não comprova preservação de um acervo preenchido. O aplicativo foi publicado como **Externo, Em produção**, para login básico com `openid`, `email` e `profile`. Isso não constitui verificação avançada pelo Google nem prova dos demais caminhos. Cliente Google e segredos Resend estão privados e configurados em Production. Resend teve envio e entrega de recuperação confirmados em teste controlado, com webhook assinado e replay idempotente; nenhuma senha foi alterada. Na Vercel, `NODEJS_HELPERS=0` preserva o corpo bruto necessário ao webhook. Receita e limites em [docs/DEPLOY.md](docs/DEPLOY.md).

Mercado Pago permanece mock na instalação principal. O sandbox separado está publicado no deployment Ready `35ZhSh55MLGoEqW9BEaaBFLxd3pT`, com Supabase `secapcqqznlokiqhojsa`, TLS verificado e 40 tabelas. A verificação real confirmou vendedor de teste, staging e `canCharge=false`. A execução técnica criou duas orders Pix de teste, de valor nominal **R$ 50,00** cada: uma aprovada após reconciliação e outra pendente. Idempotência passou e o estoque baixou de 2 para 1 uma única vez. **A entrega do webhook financeiro ainda não foi comprovada**; existe divergência entre a aplicação emissora e a configurada no painel, em investigação. Cartão e os demais cenários continuam pendentes. Não houve cobrança comercial ou transferência Pix real. Detalhes em [docs/VALIDACAO.md](docs/VALIDACAO.md).

O adaptador Melhor Envio permite somente cotação e consulta de etiquetas existentes no sandbox; foi testado com transporte controlado, está sem chave e não está ligado ao checkout. Não compra etiquetas. Detalhes: [docs/LOGISTICA.md](docs/LOGISTICA.md).

## Segurança operacional, testes e publicação

```powershell
npm run check
npm test
npm run build
```

A rodada integral local mais recente registrou **213 testes aprovados**, além de `npm run check` e `npm run build`. O CI publicado citado no início é o marco histórico de 211 testes. Os testes usam identidades e bancos isolados; não comprovam OAuth, entrega Resend ou pagamento externo por conta própria. Confira o escopo e as provas externas separadas em [docs/VALIDACAO.md](docs/VALIDACAO.md).

Após o cutover, um backup manual AES-256-GCM do novo principal registrou **40 tabelas, 233 registros e 2 objetos**. A restauração em SQLite novo e isolado confirmou integridade e nenhuma violação de chave estrangeira; não houve restauração no banco remoto. Essa contagem pertence a um snapshot posterior aos 230 registros da migração. Chave e conteúdo ficam privados, fora de Git e ZIP público. Retenção continua manual, sem agendamento ativo. Hash e procedimento em [docs/BACKUP.md](docs/BACKUP.md).

O Vercel Hobby continua destinado a demonstração não comercial, com `noindex`. Abertura comercial requer infraestrutura elegível, dados empresariais e políticas definitivas, logística e homologações. Não há autorização automática para cobranças reais.

Configuração e estado: [docs/DEPLOY.md](docs/DEPLOY.md). Contratos: [docs/INTEGRACOES.md](docs/INTEGRACOES.md). Dependências restantes: [docs/PENDENCIAS.md](docs/PENDENCIAS.md).

## Recursos visuais

Logo, pacote e Pikachu foram fornecidos pelo proprietário. Fontes dos produtos demonstrativos: [docs/IMAGENS-DEMO.md](docs/IMAGENS-DEMO.md). Three.js mantém licença MIT em `vendor/LICENSE`. A animação é uma reconstrução própria em tempo real, sem reutilização dos frames de referência ou inclusão de graduação/slab.

O guard `BKM_MAINTENANCE_MODE=true` permite bloquear a API antes de inicializar o banco, com HTTP 503 e `Retry-After: 60`, em futuras manutenções. Após esta migração, Production está com `BKM_MAINTENANCE_MODE=false` e HTTP 200 confirmado.
