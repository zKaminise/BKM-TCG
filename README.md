# BKM TCG

Loja de demonstração de Pokémon TCG com a marca BKM, catálogo persistente, administração e abertura 3D do pacote preservada. Produtos, preços, estoques, frete e pedidos de demonstração são fictícios. Nenhuma venda, cobrança ou entrega real é feita nesse modo.

Repositório oficial: [zKaminise/BKM-TCG](https://github.com/zKaminise/BKM-TCG).

Demonstração online: [bkm-tcg-demo.vercel.app](https://bkm-tcg-demo.vercel.app/). PostgreSQL e Storage Supabase estão conectados. Administração, upload 4K, catálogo TCGdex, checkout móvel e concorrência real de estoque foram exercitados na integração remota; os cenários e evidências estão em [docs/VALIDACAO.md](docs/VALIDACAO.md).

## Abrir a loja completa

Use Node.js **22.13 ou mais recente na versão 22**. No Windows, dê dois cliques em **ABRIR SITE.cmd**. O inicializador instala as dependências se necessário, prepara a demonstração sem sobrescrever alterações administrativas, inicia o servidor e abre o navegador. Mantenha a janela aberta.

A entrada da loja é **http://localhost:4173/**. Administração: **http://localhost:4173/admin**.

Para usar o terminal:

```powershell
npm ci
# Na primeira instalação, copie .env.example para .env. Preserve um .env já existente.
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
npm run db:migrate
npm run demo:seed
npm start
```

O `.env` é privado e carregado automaticamente. O servidor local escuta apenas neste computador. `ABRIR.html` é uma apresentação offline opcional, apenas da animação. No servidor, esse endereço redireciona à loja completa para evitar confusão.

## Primeiro administrador

Depois de configurar o `.env`, execute **CONFIGURAR ADMIN.cmd** ou `npm run admin:create`. Informe nome, e-mail e uma senha de 12 a 128 caracteres. A senha não é exibida nem salva no código. Não existe administrador ou senha padrão nos dados de demonstração.

O administrador da instalação online dedicada já foi criado. Esse bootstrap é para um banco novo e não precisa ser repetido para entrar na loja existente.

O comando cria somente o primeiro administrador, no mesmo banco configurado para o servidor. Não promove outra conta silenciosamente. Entre em `/entrar` e abra `/admin`. No Supabase, o bootstrap usa a conexão PostgreSQL privada do `.env` local; não exponha a conexão no navegador.

## O que a demonstração permite

- Navegar pela home, animação, lacrados, avulsas, coleções e páginas de produto com zoom e relacionados.
- Buscar por nome ou número e filtrar coleção, idioma, condição, acabamento, preço e disponibilidade.
- Gerenciar favoritos e carrinho com drawer, quantidades, cupons, subtotal e progresso para frete grátis.
- Cadastrar conta, entrar e consultar pedidos próprios.
- Simular checkout aprovado, pendente, recusado, cancelado ou expirado, com pedidos persistidos, snapshots de preço, histórico e controle transacional de estoque.
- Administrar produtos, variantes, imagens, coleções e aliases, cupons, estoque, pedidos, rastreamento, banners e configurações.
- Importar a identidade de uma carta pela TCGdex, conferindo idioma + coleção + número antes de preencher os campos comerciais e publicar.
- Ver prévias privadas de e-mails de teste e reenviar mensagens transacionais pela fila administrativa.

O seed cria 14 produtos e quatro coleções em banco dedicado: cartas em português/inglês, variantes, lacrados e exemplos esgotados. O cupom ilustrativo `BKMDEMO` concede 10% a partir de R$ 50. O frete demonstrativo é R$ 15, com gratuidade a partir de R$ 150 em CEPs cobertos. Tudo pode ser alterado no painel. Reexecutar o seed preserva as edições; um banco com produtos sem a identificação de demonstração é recusado.

## Arquitetura e persistência

Frontend HTML/CSS/JavaScript; Three.js local para a animação. Backend Node modular. `server/store.cjs` usa PostgreSQL quando `DATABASE_URL` está configurada e SQLite somente no desenvolvimento local. Não há catálogo fixo no frontend nem dependência de localStorage como banco principal.

As migrations PostgreSQL versionadas ficam em `server/migrations/` e são aplicadas transacionalmente. As tabelas incluem usuários, sessões, cartas, produtos, variantes, coleções, carrinho/favoritos de contas, cupons, pedidos/itens, reservas, movimentos, pagamentos/eventos, endereços, remessas, configurações, auditoria e outbox de e-mails. As tabelas da aplicação têm RLS e não concedem acesso direto aos papéis anon/authenticated. A API aplica propriedade da conta e autorização administrativa.

A autenticação existente foi preservada: scrypt com salt, sessões com tokens armazenados como hash, cookie HttpOnly/SameSite e CSRF. Na hospedagem HTTPS o cookie usa Secure. Não foi criado um segundo sistema paralelo de usuários no Supabase Auth.

Em pedidos pendentes, unidades ficam reservadas. Aprovação efetiva a baixa uma vez; recusa, cancelamento e expiração liberam a reserva. Alterações no anúncio não mudam o snapshot de um pedido existente. Preços, estoque, cupom e entrega são sempre recalculados no servidor.

## Supabase e hospedagem

Veja [docs/DEPLOY.md](docs/DEPLOY.md) para o estado implantado e as etapas exatas. A publicação Vercel usa frontend em `dist/` e uma função Node para `/api/*`; não depende de um processo Node permanente. PostgreSQL e uploads estão no projeto Supabase dedicado `bkm-tcg-demo`, região São Paulo, plano Free. O filesystem da Vercel nunca é usado como armazenamento persistente.

O upload administrativo aceita PNG/JPEG/WebP de até 8 MB. Imagens grandes são otimizadas no navegador antes de atravessar o limite do servidor de hospedagem. O servidor valida o formato e envia a imagem a um bucket Supabase dedicado. O fallback `uploads/` é permitido apenas localmente.

Para importar um SQLite existente em um PostgreSQL dedicado vazio, use `npm run db:import -- "caminho/do/banco.sqlite"`. O script recusa um destino já populado e invalida sessões, sem apagar o banco de origem.

O deploy Hobby é **exclusivamente demonstrativo e não comercial**. `HOSTING_DEMO_ONLY=true` mantém pagamentos e e-mails externos desativados. Antes de vendas reais, use infraestrutura/plano comercialmente compatível, domínio e políticas definitivas, logística e as validações dos provedores. Consulte as [regras Hobby da Vercel](https://vercel.com/docs/plans/hobby).

## Mercado Pago e Resend

Há adaptadores, fluxo de pedidos, interface oficial tokenizada de cartão/Pix, webhook com validação de assinatura e confirmação remota, idempotência e reconciliação. A demonstração usa exclusivamente `MockPaymentProvider` e não carrega o SDK de cartão. Não existe QR Pix fictício.

E-mails usam `DevelopmentEmailProvider` em demonstração. `ResendEmailProvider` depende de chave, remetente/domínio verificado e ativação explícita. A outbox persiste tentativas, falhas e reenvios. Templates BKM incluem boas-vindas, pedido, estados de pagamento, envio, rastreio e recuperação de senha. Prévias de desenvolvimento não divulgam tokens de recuperação.

As integrações externas reais **ainda exigem credenciais seguras e validação de sandbox/domínio**. Testes com transporte controlado não equivalem a cobranças ou envios reais aprovados pelos provedores. Configurações em `.env.example`; detalhes em [docs/INTEGRACOES.md](docs/INTEGRACOES.md).

## Verificação e builds

```powershell
npm run check
npm test
npm run build
```

Os testes usam bancos e identidades sintéticas isoladas, incluindo PostgreSQL via PGlite. Não enviam e-mail externo nem cobram pagamentos. `npm run build` gera o frontend da loja para hospedagem. `npm run build:offline` reconstrói somente a animação autônoma e requer esbuild.

Estado de provisionamento e evidências reais: [docs/VALIDACAO.md](docs/VALIDACAO.md). Bloqueios externos e ativação comercial: [docs/PENDENCIAS.md](docs/PENDENCIAS.md).

## Recursos visuais

Logo, frente do pacote e Pikachu fornecidos pelo proprietário. Imagens de referência e fontes dos produtos de teste: [docs/IMAGENS-DEMO.md](docs/IMAGENS-DEMO.md). Three.js inclui licença MIT em `vendor/LICENSE`. A animação é uma reconstrução própria em tempo real inspirada no material de referência; não reutiliza os frames da Star Grading nem inclui graduação/slab.
