# Cadastro de produtos BKM TCG

Atualizado em **28/10/2026**. A criação e a edição ficam em [Produtos](https://lojabkm.com.br/admin/produtos), com o fluxo **Tipo → Identificação → Venda e estoque → Revisão**. A identidade visual segue Minha Coleção; o inventário comercial continua separado da coleção particular.

## Carta avulsa

1. Escolha **Carta avulsa** e digite nome, número ou código. A busca acompanha a digitação, aceita números parciais e permite filtrar idioma de referência/coleção. Números ambíguos exibem as alternativas; selecione a imagem e a expansão corretas.
2. Nome, coleção, numeração, raridade e imagem de referência vêm do catálogo TCGdex. O servidor resolve a identidade novamente; não aceita substituir esses dados por um nome/imagem arbitrários enviados pelo navegador. Fotos próprias do exemplar podem ser adicionadas.
3. Informe idioma do exemplar, conservação **M, NM, SP, MP, HP ou D**, acabamento e atributos opcionais. Promo, carimbo, primeira edição e edição especial são atributos separados; Poké Ball/Master Ball são acabamentos. Não há conservação marcada silenciosamente para cartas novas.
4. Defina **seu preço em reais** e a **quantidade física**. O preço do anúncio não é preenchido a partir de uma cotação internacional. Cada versão possui seu próprio preço/saldo; duas versões que só diferem em atributos também são distintas.
5. Revise e salve como rascunho ou marque a publicação. O cadastro gera **BKM1, BKM2…** e um endereço único no servidor. Na edição, SKU e endereço existentes permanecem preservados.

### Carta não encontrada

Depois de uma pesquisa concluída sem correspondência, aparece **Não encontrou a carta na base de dados?**. Ao expandir e confirmar o preenchimento manual, informe nome, número, coleção e imagem por upload/link, além dos dados de venda. Em indisponibilidade externa, a alternativa é explicitamente identificada como tal; uma falha não é apresentada como resultado vazio comprovado.

A autorização é vinculada à sessão, expira em 15 minutos e é consumida somente quando a gravação termina com sucesso. Se expirar enquanto você preenche os dados, **Verificar catálogo novamente** renova a consulta sem apagar nome, foto, preço ou estoque. Uma pesquisa que encontra cartas não libera esse caminho. Alterar a identidade de uma carta manual já cadastrada exige nova pesquisa; editar seu preço/estoque conserva o comprovante anterior.

## Selado e personalizado

- **Selado:** nome, tipo (booster, blister, deck, ETB, box, lata, acessório ou outro), linha/coleção opcional, descrição e imagens. Depois, idioma, preço e quantidade por versão.
- **Personalizado:** nome, descrição opcional e imagens; depois preço e quantidade. É um tipo real de produto, sem aparecer como lacrado na loja.
- Há duas alternativas de imagem: **upload de PNG/JPEG/WebP até 8 MB**, com otimização antes do envio, e **link HTTPS**. Fotos reais e imagens de referência são identificadas separadamente; podem coexistir no anúncio.
- Campos de fabricante, conteúdo e dimensões ficam em informações adicionais, sem interromper o fluxo principal.

## Edição, estoque e publicação

Rascunhos ficam fora da loja. Salvar um rascunho grava seu estoque; publicar torna o anúncio visível. Há link **Ver anúncio** para os produtos publicados. Alterações de estoque continuam gerando movimentação administrativa. Variantes com unidades reservadas não podem ser removidas, ter identidade trocada ou receber quantidade inferior à reserva; a própria carta/coleção/tipo também não pode ser trocada enquanto houver reserva ativa.

Condição, idioma, acabamento e atributos seguem até a página do produto, o carrinho, a cotação e o snapshot do pedido. E-mails usam o snapshot original. Desejos sem critérios de atributos especiais não recebem ofertas de promo/carimbo/primeira edição como se fossem exemplares comuns.

## Validação e publicação desta entrega

- **416 testes aprovados** na suíte completa, incluindo SQLite e PostgreSQL/PGlite; sintaxe, build e diff verificados.
- Componentes reais de frontend exercitados em host DOM: tipos, busca automática/cancelamento, campos automáticos, conservação obrigatória, dinheiro/estoque, upload/link, versões, revisão/publicação, volta entre etapas, edição e renovação manual.
- Backend: concorrência da sequência SKU, colisão de endereço, metadados canônicos, três tipos, variantes/atributos, snapshots, reserva/rollback, autorização manual entre sessões/expiração/consumo e migração v9→v10 com pedidos e chaves estrangeiras existentes.
- Navegador em banco SQLite isolado: Bulbasaur 166/165 real, R$ 10/3 unidades e outra versão promo R$ 12/1 unidade; rascunho/reabertura/publicação; selado com upload efetivo e segunda foto por link, japonês e 8 unidades; personalizado de 2 unidades; carta manual com HP/Master Ball/carimbo, pesquisa expirada revalidada sem perda. SKUs BKM1–BKM4 foram gerados nesse banco de QA.
- Conferência móvel a 390 px: escolha de tipo, página pública e carrinho com atributos corretos e sem overflow da página.
- Produtos de QA não foram publicados no banco principal. Nenhuma cobrança real ou contratação de frete foi feita. O teste comercial de R$ 10 com o amigo continua sendo uma compra real a executar pelo titular.

A migração 010 adiciona CUSTOM, sequência de SKU, metadados de variantes e autorizações de fallback. Preserva IDs e referências existentes, com RLS nas novas tabelas PostgreSQL. Um backup criptografado do banco principal foi gerado antes da mudança; a publicação deve conferir a preservação de produtos, variantes, pedidos, movimentos e reservas.

## Ajustes de 29/10/2026

Depois de cadastrar ou salvar, a administração vê uma tela de conclusão baseada na publicação real retornada pelo servidor: produto publicado ou rascunho salvo. Ela mostra SKU, preço e unidades e oferece Ver anúncio, Cadastrar outro, Ver todos e Editar. O formulário não reabre automaticamente. O catálogo público agora exibe os códigos de conservação das cartas, com nome acessível e indicação de versão esgotada, antes de abrir o produto.

A suíte foi ampliada para 443 testes aprovados. O novo fluxo de frete, CEP automático e limites operacionais estão documentados em [Logística](LOGISTICA.md).
