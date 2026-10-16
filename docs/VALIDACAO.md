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

GitHub: repositório oficial confirmado com acesso de escrita; Fase 2 publicada na main, commit e5e04b6aac397aa2472560cce41730186732c130, seguido da correção de função Vercel 0d0c27196265c6b3f83894e30518494cd84b0ba2. O CI da Fase 2 concluiu com sucesso: https://github.com/zKaminise/BKM-TCG/actions/runs/38834029240. O Git registra o commit final vigente.

Supabase: solicitou login; projeto remoto, tabelas e Storage não foram confirmados.

Vercel: projeto gratuito bkm-tcg-demo criado e conectado ao repositório. O primeiro build identificou entrada .cjs não reconhecida; corrigida para api/index.js. O push 0d0c271 acionou automaticamente outro deploy, que ficou Ready. Domínio bkm-tcg-demo.vercel.app com Valid Configuration; URL pública aberta no navegador e animação carregada. /api/config confirmou HTTP 503 NOT_CONFIGURED, pois o Supabase ainda não foi provisionado. Catálogo e checkout online continuam não aprovados. Não houve bloqueio desse deploy por cota, apesar do aviso de uso excedido na conta.

Diretório oficial D: atualizado, dependências instaladas, seed de 14 produtos aplicado ao banco local dedicado e 106 testes aprovados novamente nesse diretório. O servidor foi reiniciado usando os arquivos oficiais; a API manteve os 14 produtos e as quatro coleções. O endereço /ABRIR.html redirecionou corretamente à loja completa.

Nunca inferir aprovação de deploy apenas pela presença de arquivos vercel.json, migrations ou módulos de integração.

## Verificação complementar da entrega

No servidor oficial em localhost:4173, foi criado pelo HTTP um cliente fictício e um pedido DEMO com dois boosters. O servidor calculou R$ 29,80 de produtos + R$ 15,00 de frete = R$ 44,80, aprovou somente a simulação e baixou estoque de 20 para 18. Repetir a mesma solicitação retornou o mesmo pedido sem outra baixa. Após reiniciar o processo Node, pedido, sessão e estoque continuaram armazenados. Essa verificação usa a API real da aplicação; não foi uma execução visual do formulário.

A URL pública final foi recarregada após o push 7554aed e mostrou DEMONSTRAÇÃO e a mensagem explícita de conexão Supabase pendente. Home/animação verificadas online em viewport 390x844: pacote, carta saindo de costas e Pikachu revelado; sem overflow horizontal. Evidências bkm-online-mobile.jpg e bkm-online-carta-mobile.jpg. Os demais cenários comerciais online continuam bloqueados pela ausência de banco remoto.

CI também aprovado no commit 7554aed: https://github.com/zKaminise/BKM-TCG/actions/runs/38834710878.
