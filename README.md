# BKM TCG — Fase 3

E-commerce demonstrativo de Pokémon TCG e gerenciador privado de coleções pessoais. A identidade BKM — preto, vermelho, ciano e prata — e a animação 3D do booster com Pikachu foram preservadas.

- Site oficial: [lojabkm.com.br](https://lojabkm.com.br/).
- Repositório: [zKaminise/BKM-TCG](https://github.com/zKaminise/BKM-TCG), branch `main`.
- Diretório de trabalho: `D:\Importante\Codex\LP Vendas TCG Site`.
- Endereço anterior de demonstração: [bkm-tcg-demo.vercel.app](https://bkm-tcg-demo.vercel.app/).

**Estado em 20/10/2026, antes da publicação da Fase 3:** código local preparado para validação, 211 testes automatizados aprovados e migrations 1–7 aplicadas ao Supabase principal. O domínio canônico e o redirecionamento de `www` já foram corrigidos na hospedagem. O push/deploy da Fase 3 e a prova final dos novos fluxos no domínio público ainda precisam ser registrados em [docs/VALIDACAO.md](docs/VALIDACAO.md). Alterações locais ou variáveis configuradas não comprovam homologação online.

Em 20/10 foi criado o novo projeto Supabase **BKM ecommerce** (`cxoeompxmgdzufgzxerw`) em nova conta autorizada pelo titular. Migração e configuração permanecem pendentes. A existência do projeto não significa que a loja publicada já o utilize.

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

Google OIDC usa Authorization Code, PKCE, state/nonce e validação no servidor. Resend utiliza outbox, idempotência e webhook Svix com corpo bruto. Cliente Google e segredos Resend foram guardados privadamente e configurados nas variáveis Production; **OAuth real e entrega de e-mail ainda dependem de prova externa**. A configuração não equivale à homologação.

Mercado Pago permanece mock na instalação principal. A conta de vendedor de teste foi conferida; a homologação externa de Pix/cartão, webhook e reconciliação ocorrerá em infraestrutura separada. Produção financeira continua desativada.

O adaptador Melhor Envio permite somente cotação e consulta de etiquetas existentes no sandbox; foi testado com transporte controlado, está sem chave e não está ligado ao checkout. Não compra etiquetas. Detalhes: [docs/LOGISTICA.md](docs/LOGISTICA.md).

## Segurança operacional, testes e publicação

```powershell
npm run check
npm test
npm run build
```

A rodada integral da Fase 3 registrou **211 testes aprovados**. Os testes usam identidades e bancos isolados; não comprovam OAuth, entrega Resend ou pagamento externo por conta própria. Confira o escopo em [docs/VALIDACAO.md](docs/VALIDACAO.md).

Backup manual criptografado com AES-256-GCM e restauração isolada foram executados com dados reais, sem publicar conteúdo. A chave fica no `.env` privado e deve ter cópia segura separada; não integra Git ou ZIP público. Retenção é um procedimento manual, sem agendamento ativo. Veja [docs/BACKUP.md](docs/BACKUP.md).

O Vercel Hobby continua destinado a demonstração não comercial, com `noindex`. Abertura comercial requer infraestrutura elegível, dados empresariais e políticas definitivas, logística e homologações. Não há autorização automática para cobranças reais.

Configuração e estado: [docs/DEPLOY.md](docs/DEPLOY.md). Contratos: [docs/INTEGRACOES.md](docs/INTEGRACOES.md). Dependências restantes: [docs/PENDENCIAS.md](docs/PENDENCIAS.md).

## Recursos visuais

Logo, pacote e Pikachu foram fornecidos pelo proprietário. Fontes dos produtos demonstrativos: [docs/IMAGENS-DEMO.md](docs/IMAGENS-DEMO.md). Three.js mantém licença MIT em `vendor/LICENSE`. A animação é uma reconstrução própria em tempo real, sem reutilização dos frames de referência ou inclusão de graduação/slab.

Durante a migração, `BKM_MAINTENANCE_MODE=true` permite manutenção temporária: a API responde HTTP 503 com `Retry-After: 60` antes de inicializar o banco. Esse estado não indica migração ou publicação concluída.
