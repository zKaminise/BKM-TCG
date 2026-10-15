# BKM TCG

Loja local em desenvolvimento com a logo fornecida, cores preta, vermelha, ciano e prata e animação 3D preservada. O banco começa sem anúncios, preços, estoque ou vendas fictícias.

## Abrir

Use Node.js **22.13 ou mais recente**. Dê dois cliques em **ABRIR SITE.cmd** e mantenha a janela aberta. Ou execute `npm start` nesta pasta. Acesse o endereço exibido, por padrão `http://127.0.0.1:4173`. O servidor aceita acesso apenas neste computador.

Não é necessário instalar dependências para usar a loja. Node fornece o backend/SQLite e Three.js já está incluído.

**ABRIR.html contém somente a apresentação animada**, sem catálogo, contas, painel ou checkout. Abre diretamente no navegador, sem servidor. Para a loja, use ABRIR SITE.cmd.

## Primeiro administrador

Dê dois cliques em **CONFIGURAR ADMIN.cmd** ou execute `npm run admin:create`. O assistente pede nome, e-mail e senha de 12 a 128 caracteres, sem exibir a senha. Não existe senha padrão. Também aceita:

```powershell
npm run admin:create -- --email seu@email.com --name "Seu nome"
```

Entre em `/entrar` e abra `/admin`. O comando cria somente o primeiro administrador; não promove contas existentes silenciosamente.

## Produtos e cartas

No painel, crie um lacrado ou uma carta. Preencha SKU, coleção, imagens, descrição e variantes. Cada combinação de idioma, condição e acabamento tem preço e estoque próprios. Valores são persistidos em centavos e exibidos em BRL. Publicar torna o anúncio visível no catálogo; despublicar o retira.

Para cartas, selecione idioma e coleção e procure pelo número. Confira a imagem e os metadados antes de usá-los. A TCGdex fornece referências, não inventário: a consulta nunca cria um anúncio automaticamente. Não há correspondência automática entre nomes comerciais brasileiros e coleções internacionais. O cadastro manual continua disponível.

Metadados de identificação da carta são separados do anúncio comercial. Imagens de referência são ilustrativas; fotos reais devem ser fornecidas pelo vendedor. Upload administrativo aceita PNG/JPEG/WebP até 8 MB, salvo em `uploads/`. SVG e executáveis não são aceitos.

## Arquitetura e banco

HTML/CSS/JavaScript com Three.js para a apresentação (`app.js`) e módulo comercial separado (`store.js`). Backend modular Node em `server/`, SQLite transacional persistente em `data/bkm.sqlite`. A escolha permite operação local sem infraestrutura adicional; PostgreSQL e hospedagem produtiva não foram provisionados.

Migrations são aplicadas na inicialização. Também podem ser executadas com `npm run db:migrate`. O schema separa usuários, sessões, cartas, anúncios, variantes, cupons, configurações e auditoria. A estrutura de pedidos/reservas está preparada; o fluxo financeiro ainda não cria pedidos ou movimenta estoque de vendas.

Senhas usam scrypt com salt; sessões usam tokens aleatórios armazenados como hash, cookie HttpOnly/SameSite e proteção CSRF. A autorização administrativa é validada na API. Banco, scripts, arquivos de ambiente e código do servidor não são servidos como arquivos públicos.

## Carrinho, frete e cupons

Carrinho e favoritos de visitantes persistem no navegador; contas autenticadas têm persistência no banco e mesclagem ao entrar. A API revalida preços, disponibilidade e quantidades. Adicionar ao carrinho não reserva estoque.

O frete começa desabilitado. Configure no painel uma regra própria de frete fixo com prazo e faixas de CEP, quando corresponder à operação real. Frete grátis só aparece quando configurado e depende da elegibilidade validada pelo servidor. Não há cotação de transportadoras ou contratação de etiquetas nesta etapa.

Cupons básicos suportam valor fixo/percentual, mínimo, validade e limite global. Segmentação e consumo concorrente de cupons no pagamento ainda dependem da conclusão do fluxo de pedidos.

## Pagamentos e limites atuais

**Cobranças permanecem indisponíveis.** Não há Pix fictício ou confirmação simulada. Nenhuma chave isoladamente habilita vendas nesta entrega. A preparação Mercado Pago inclui configuração, HMAC e idempotência, mas ainda faltam criação de Orders, componentes oficiais de pagamento, webhooks integrados aos pedidos, confirmação remota, conciliação e reservas transacionais verificadas em sandbox.

Recuperação/verificação de e-mail, gestão completa de endereços/operadores, logística integrada e políticas finais também estão pendentes. Consulte `docs/PENDENCIAS.md` e `docs/INTEGRACOES.md`. Não houve deploy ou cobrança.

## Configuração e backup

`.env.example` documenta variáveis; o servidor não carrega `.env` automaticamente. Exemplo no PowerShell:

```powershell
$env:PORT = '4173'
$env:BKM_DB_PATH = 'D:\dados-privados\bkm.sqlite'
npm start
```

Use o mesmo BKM_DB_PATH para migrations e criação do administrador. Faça backup do banco e da pasta uploads com o servidor encerrado. Dados empresariais, contato e políticas devem ser preenchidos com informações reais antes de operação comercial. Uma publicação futura exige HTTPS, cookies Secure, infraestrutura, backups e revisão de segurança.

## Verificação e build

`npm run check` verifica a sintaxe. `npm test` executa testes com bancos temporários e dados sintéticos isolados, sem semear o inventário da loja. Cobrem autenticação, permissões, CSRF, persistência, catálogo, variantes, preço/estoque, cupons, frete, uploads e contratos dos provedores.

Para reconstruir somente ABRIR.html: `npm install` e `npm run build`. O build não empacota o backend na apresentação offline.

## Recursos visuais

Logo, frente do pacote e Pikachu fornecidos pelo usuário. PNG masters preservam os recursos enviados; WebP otimiza a transferência. Verso da carta: https://tcg.pokemon.com/assets/img/global/tcg-card-back-2x.jpg. Texturas procedurais próprias. Three.js 0.186.1 inclui licença MIT em vendor/. Pokémon e nomes das cartas pertencem aos respectivos titulares.

A animação foi inspirada nos vídeos e em Star Grading, com reconstrução própria em tempo real. Não reutiliza os frames do site de referência e não inclui graduação/slab.
