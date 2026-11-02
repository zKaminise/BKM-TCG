# Mobile e chamadas para os produtos — 02/11/2026

## Alterações

- Removidos os caracteres de estrela e setas diagonais usados como decoração na home e nas chamadas do catálogo. Eles podiam aparecer como emojis coloridos no iPhone. Busca, conta, carrinho e navegação continuam com SVG; a indicação de rolagem também usa vetor.
- Home com ação principal **Explorar produtos** em vermelho, texto de 14 px e altura de 48 px no celular. **Ver a abertura** tem superfície e borda de alto contraste. O destaque dos botões também foi melhorado no desktop.
- A posição e o tamanho do pacote e da carta consideram a área realmente ocupada pelo cabeçalho, texto e controles. Celulares baixos usam composição mais compacta; paisagem usa duas colunas. A sequência de abertura, extração e giro foi preservada.
- Cabeçalho mobile com três controles principais. Favoritos/desejos continuam disponíveis no menu; conta e navegação se recolhem mutuamente. Menu identifica o estado aberto e pode ser fechado pelo teclado.
- Catálogo com filtros recolhíveis no celular e contador de critérios ativos. O formulário e os valores são preservados; no desktop, os filtros continuam expandidos. Mudanças de largura cuidam do foco e os listeners são removidos ao sair da página.
- Textos, preços, condições e áreas de toque maiores em catálogo, produto, carrinho, checkout e conta. Campos usam 16 px no mobile para evitar o zoom automático de foco do Safari. Chamadas de produto passaram a ter aparência clara de botão, em vez de links discretos.
- Empacotamento inclui os novos módulos e estilos. A apresentação offline também incorpora a composição mobile.

## Limites e preservação

Nenhuma regra de preço, estoque, pedido, frete, autenticação, e-mail ou pagamento foi alterada. A validação visual usa SQLite isolado e uma cópia de metadados públicos de cinco anúncios; compras, pagamentos e serviços de envio externos estão desabilitados nesse ambiente.

As verificações de tela usam viewport de navegador Chromium; não equivalem a uma execução em aparelho físico com Safari/iOS. O CSS foi analisado com alvo Safari 15/Chrome 100, sem avisos de sintaxe. Não foram adicionadas dependências, bibliotecas de ícones, migrações ou credenciais.

## Validação

- Suíte completa: **560 testes aprovados**. Os novos casos cobrem a separação das regiões de texto/imagem em retrato/paisagem e o comportamento dos filtros, incluindo foco, contagem e compatibilidade de media queries.
- Sintaxe, build web e geração offline aprovados.
- Dimensões conferidas: 320 × 568, 375 × 667, 390 × 844, 430 × 932 e 844 × 390. Botões principais com pelo menos 46/48 px e ausência de transbordamento horizontal na home.

A conferência visual percorreu a abertura automática até a carta revelada, acesso ao catálogo, expansão/aplicação de filtro por Exeggcute (contador de um critério ativo), escolha de produto, inclusão no carrinho, entrada por conta sintética e formulário de checkout. Também foi conferido um carrinho com nome longo de box em 320 px, sem transbordamento. Nenhum pedido ou pagamento foi criado. No desktop, os filtros permanecem abertos e a navegação completa continua disponível. O contraste do texto branco no vermelho principal é aproximadamente 4,96:1.
