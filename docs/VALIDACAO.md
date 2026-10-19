# Validação — BKM TCG Fase 2

Estado verificado em **19/10/2026**. Loja pública: [bkm-tcg-demo.vercel.app](https://bkm-tcg-demo.vercel.app/). Repositório: [zKaminise/BKM-TCG](https://github.com/zKaminise/BKM-TCG).

## Automatizada e publicação

O CI do commit `e3dff6c` passou com **119 testes**, zero falhas e zero ignorados, além de sintaxe e build. O commit `085351a`, com ajustes de carregamento e CTA do frontend, foi publicado posteriormente. O histórico Git e os checks do commit vigente registram os deploys seguintes.

Cobertura: catálogo TCGdex/identidade/idiomas; autenticação/RBAC/CSRF; CRUD; variantes e uploads; preços/cupom/frete no servidor; carrinho/favoritos de conta; seed idempotente e protegido; bootstrap administrativo; checkout/pedidos/histórico; cinco resultados mock; reserva/liberação/baixa; idempotência; propriedade do pedido; envios; recuperação de senha; outbox/retry; Storage; adaptador Mercado Pago e webhook/consulta autoritativa com transporte controlado; prevenção de mistura de ambientes; configuração privada e isolamento dos testes.

Os testes automatizados usam bancos e identidades sintéticas isoladas, incluindo PostgreSQL via PGlite. Há proteção para impedir que a suíte carregue o `.env` real do desenvolvedor. A prova de concorrência no Supabase descrita abaixo foi um script de QA autorizado, separado da suíte.

## Serviços externos confirmados

- **Supabase:** projeto dedicado `bkm-tcg-demo`, referência `nxrvmanifngjmdtgnzoq`, região São Paulo, plano Free, estado Healthy no painel. Conexão pelo pooler Transaction/6543 com TLS verificado. Migrations 1, 2 e 3 aplicadas; **22 tabelas** da aplicação conferidas com RLS ativo e sem permissão `SELECT` para `anon`.
- **Dados:** SQLite da demonstração importado ao PostgreSQL, preservando os 14 produtos originais e dois pedidos existentes. A autenticação BKM foi mantida; não há um cadastro Supabase Auth paralelo. O primeiro administrador foi criado e seu login foi exercitado na URL Vercel. Senhas e chaves não integram esta documentação.
- **Storage:** bucket público dedicado `bkm-public` criado. Upload pelo painel administrativo online de PNG 4K com aproximadamente 6,98 MB foi otimizado pelo navegador para WebP e salvo no Supabase. A imagem foi aplicada ao Booster Heróis Excelsos e continuou carregando após refresh.
- **Vercel:** projeto `bkm-tcg-demo` conectado à branch `main`, com frontend estático e função Node em `api/index.js`. A loja online usa o banco e o armazenamento remotos; a antiga resposta `503/NOT_CONFIGURED` por falta de banco foi resolvida. Pagamentos permanecem mock e e-mails permanecem em desenvolvimento.

## Administração exercitada no navegador

- Login administrativo na hospedagem Vercel e abertura do painel.
- Importação TCGdex em português, coleção `sv09`, número `003`: carta Butterfree criada e publicada. Alterações comerciais de preço de R$ 8,90 para R$ 9,90 e estoque persistiram.
- Catálogo com os 14 produtos originais mais a Butterfree, totalizando **15 produtos públicos** nessa rodada.
- Produto lacrado adicional de QA criado e publicado; continuou disponível após refresh. Depois foi arquivado de forma recuperável, e sua URL pública passou a responder 404.
- Imagem de produto enviada ao Supabase pelo formulário administrativo, aplicada e conferida após refresh.
- Após o teste concorrente, estoque da Butterfree reposto para **3 unidades pelo painel**. O checkout móvel posterior consumiu uma unidade, encerrando a rodada com estoque **2**.

## Concorrência real no PostgreSQL remoto

Foram iniciados dois servidores HTTP em loopback, cada um com seu próprio store/pool PostgreSQL, e duas sessões independentes do mesmo cliente fictício existente. O teste foi restrito à Butterfree `butterfree-003-159`, preço R$ 9,90 e uma unidade disponível.

As duas solicitações de checkout aprovado foram disparadas simultaneamente. Uma retornou **201/APPROVED** e criou o pedido demonstrativo `9a3f83f4-f02f-4808-92ab-58845ef5c5e8`; a outra retornou **409/INSUFFICIENT_STOCK**. Estoque físico e público passaram de 1 para 0, com exatamente um novo pedido aprovado e uma nova baixa. O total fictício foi R$ 24,90, incluindo R$ 15,00 de frete.

A solicitação vencedora foi repetida pelo outro servidor e pela outra sessão, com a mesma chave de idempotência. Retornou o mesmo pedido, sem novo pedido ou baixa. Os dois servidores enxergaram estoque zero. Servidores e pools de QA foram encerrados; o script não repôs estoque nem alterou outros produtos, contas ou configurações.

O relatório não secreto `remote-concurrency-result.json` foi salvo na pasta privada de trabalho da conversa. Scripts, credenciais e checkpoints dessa verificação não fazem parte do código público da loja.

## Loja e checkout no navegador

- Home, marca BKM e animação verificadas em desktop e celular: pacote fechado, carta saindo de costas e Pikachu revelado. No viewport móvel final de largura 375 px, o conteúdo também mediu 375 px, sem overflow horizontal.
- Menu móvel, login do cliente fictício, navegação, filtro por coleção e número `003`, página da Butterfree e adição ao drawer exercitados online.
- Drawer móvel, valor de R$ 9,90, formulário de entrega, cálculo de frete de R$ 15,00 e total de **R$ 24,90** conferidos visualmente.
- Checkout móvel criou pedido **PENDING**; o botão de simular aprovação o mudou para **APPROVED**, com histórico exibido. O refresh preservou o pedido aprovado.
- Pedido visual: `07ba1364-9136-4cd1-8636-06b5b1e56a42`, número `DEMO-20261019-024AA75C70`, total fictício de R$ 24,90.
- Após reiniciar o processo Node local da instalação oficial, nova consulta confirmou esse mesmo pedido **APPROVED**, Butterfree a R$ 9,90 e estoque **2** no Supabase. A persistência foi comprovada entre a aplicação Vercel e a aplicação local reiniciada.

Evidências da conversa: `bkm-admin-online.jpg`, `bkm-ecommerce-online-catalogo.jpg`, `bkm-upload-supabase-online.jpg`, `bkm-login-mobile.jpg`, `bkm-carrinho-online-mobile.jpg`, `bkm-checkout-online-mobile.jpg`, `bkm-pedido-online-mobile.jpg` e `bkm-home-online-mobile.jpg`. As capturas de animação incluem `bkm-online-mobile.jpg` e `bkm-online-carta-mobile.jpg`. Esses arquivos ficam na pasta de entregas da conversa.

## Limites da validação

Todas as compras, preços, estoques, fretes e pedidos usados no QA são demonstrativos. Não houve venda, cobrança, envio de produto ou e-mail externo real. Mercado Pago foi exercitado com transporte controlado; sua homologação real e a entrega Resend dependem de configuração segura em ambientes apropriados. As dependências comerciais estão em [PENDENCIAS.md](PENDENCIAS.md).
