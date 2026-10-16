# Validação — BKM TCG Fase 2

## Automatizada

Execução local em 15/10/2026: `npm test` passou com **106 testes**, zero falhas e zero ignorados. `npm run check` e `npm run build` passaram.

Cobertura: catálogo TCGdex/identidade/idiomas; autenticação/RBAC/CSRF; CRUD; variantes e uploads; preços/cupom/frete no servidor; carrinho/favoritos de conta; seed idempotente e protegido; bootstrap administrativo; checkout/pedidos/histórico; cinco resultados mock; reserva/liberação/baixa; última unidade concorrente; idempotência; propriedade do pedido; envios; recuperação de senha; outbox/retry; Storage; adapter Mercado Pago e webhook/consulta autoritativa com transporte controlado; prevenção de mistura de ambientes.

PostgreSQL foi exercitado com PGlite e as migrations SQL reais, inclusive RLS. Isso não substitui teste multipool no Supabase. Pagamentos e e-mails não usaram credenciais externas; não houve cobranças nem envios reais.

## Navegador: execução efetiva

- Home completa no servidor, logo e animação preservadas: conferidas.
- Vitrine populada com 14 produtos de demonstração: conferida.
- Listagem de lacrados: cinco produtos; todas as imagens carregadas.
- Página do Booster Heróis Excelsos: imagem, descrição, preço, estoque e relacionados conferidos.
- Adição ao drawer: 1 unidade R$ 14,90; aumento para 2 unidades R$ 29,80; progresso de frete mudou de R$ 135,10 restantes para R$ 120,20: conferidos.
- Screenshot `bkm-fase2-lacrados.jpg` salvo como evidência local na pasta de entregas da conversa.

Após a retomada, o navegador estava na página de erro e o controle de navegador não conseguiu obter permissão para observá-la. Foi solicitado ao usuário recarregar localhost:4173, com o servidor em segundo plano ativo. Ainda não marcar como aprovados nesta rodada: checkout visual final, CRUD administrativo visual, PNG 4K otimizado, mobile completo e persistência após reinício pelo navegador. Esses fluxos têm cobertura automatizada, mas precisam de execução visual.

## Serviços externos

GitHub: repositório oficial confirmado com acesso de escrita; código-base enviado à branch main, commit inicial af355c7baa840a7caf9effd05798c376101383a3. A atualização Fase 2 deve ser identificada pelo commit final no Git.

Supabase: solicitou login; projeto remoto, tabelas e Storage não foram confirmados.

Vercel: conta autenticada Hobby; painel mostrou cotas gratuitas de CPU/memória excedidas. Deploy e cenários online ainda não aprovados.

Nunca inferir aprovação de deploy apenas pela presença de arquivos vercel.json, migrations ou módulos de integração.
