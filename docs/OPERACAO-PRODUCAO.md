# BKM TCG — primeira compra e operação do pedido

Guia do administrador, atualizado em **28/10/2026** a partir do fluxo implementado. Execute após a publicação e a liberação dos provedores pela equipe responsável. Este documento não confirma que o deploy, uma cobrança real ou todas as entregas de e-mail já foram concluídos.

## Cadastrar e publicar o produto de R$ 10,00

1. Entre em [Produtos](https://lojabkm.com.br/admin/produtos) e escolha **Novo produto**. Selecione **Carta avulsa**, **Selado** ou **Personalizado**.
2. Para carta, digite nome ou número e selecione a referência correta; nome, coleção e imagem são preenchidos. Se não encontrar, expanda a alternativa manual após a pesquisa. Para os demais tipos, informe nome e envie uma foto ou adicione um link HTTPS.
3. Em **Venda e estoque**, confira idioma, conservação/acabamento e atributos do exemplar. Digite **10,00** e a quantidade física disponível. Cada versão tem preço e saldo próprios.
4. Revise e salve como rascunho. SKU **BKM1, BKM2…** e endereço são gerados automaticamente; não precisam ser digitados.
5. Reabra, confira os dados e marque **Publicar este produto na loja ao salvar** na revisão. Salve e abra **Ver anúncio**. Confira preço, foto, versão e disponibilidade. Veja o [guia do novo cadastro](CADASTRO-PRODUTOS.md).

Arquivar retira o anúncio do catálogo público e preserva seu histórico. O filtro **Somente arquivados** permite consultar esses cadastros.

## Preparar a retirada em Uberlândia

Em [Configurações](https://lojabkm.com.br/admin/configuracoes), informe **Uberlândia / MG**, o WhatsApp da empresa e habilite **Permitir retirada gratuita na loja**. O endereço público pode ficar vazio: o ponto e o horário serão combinados após o pagamento aprovado.

A entrega local gratuita é uma modalidade diferente e opcional; exige CEP confirmado de Uberlândia/MG. Para a primeira compra com retirada, o cliente deve escolher explicitamente **Retirar na loja — grátis**. Uma compra de R$ 10,00 com retirada gratuita deve totalizar R$ 10,00, na ausência de descontos ou outras alterações apresentadas no resumo.

As tarifas nacionais permanecem desativadas enquanto faltam cotações operacionais. O painel permite configurar preço e prazo manualmente por região; habilite somente destinos que a loja consegue atender pelos valores informados. Essa tabela não é cotação automática dos Correios. O mínimo de frete grátis é configurável e considera os produtos após descontos; retirada gratuita independe desse mínimo.

## Roteiro para a compra do amigo

1. O amigo acessa o anúncio publicado e cria sua própria conta por e-mail e senha ou pelo Google, quando o botão estiver disponível. Se o e-mail já tiver conta BKM sem vínculo Google, entra com a senha BKM e faz o vínculo em **Minha conta > Segurança**.
2. Adiciona a variante ao carrinho, vai ao checkout, informa contato e seleciona **Retirar na loja — grátis**. Confere itens, quantidade, retirada, desconto e total.
3. Escolhe **Pix** ou **Cartão de crédito ou débito** e confirma o pedido. O carrinho não reserva estoque; a confirmação do pedido inicia a reserva de **15 minutos** e abre o acompanhamento do pagamento.
4. No Pix, confere beneficiário e valor no aplicativo do banco antes de pagar o código fornecido pelo Mercado Pago. No cartão, preenche o formulário seguro e confere parcelas, juros e total antes de confirmar. Não enviar dados de cartão por WhatsApp.
5. Se fechar a página, volta a **Minha conta > Meus pedidos**, abre o mesmo pedido e retoma dentro do prazo, quando permitido. Se aparecer processamento ou situação incerta, consulta o status do mesmo pedido antes de tentar outra compra.
6. Só considera o pagamento concluído quando o pedido mostrar **Pagamento aprovado/confirmado**. O comprovante do cliente, sozinho, não substitui a confirmação do provedor no painel.

Ao terminar o prazo, o site bloqueia um novo pagamento nesse pedido e verifica seu encerramento. A rotina de expiração/reconciliação deve estar operando para tratar cobranças remotas e liberar reservas; não basta manter uma aba aberta. A implementação e as condições operacionais estão em [CRON-COMERCIO.md](CRON-COMERCIO.md).

## Separar, avisar e concluir

Abra o pedido em [Pedidos](https://lojabkm.com.br/admin/pedidos). Após a aprovação, confira produto, variante, quantidade, contato e modalidade. O cliente passa a ter o botão para alinhar a retirada pelo WhatsApp.

| Etapa | Ação da equipe | E-mail previsto ao cliente |
| --- | --- | --- |
| Em separação | Conferir e embalar após o pagamento confirmado | Pedido em separação |
| Separado para envio / Pronto para retirada | Registrar quando o pacote estiver pronto | Pedido separado ou pronto para retirada |
| Enviado | Para envio postal/transportadora, registrar a postagem e o rastreio | Pedido enviado |
| Entregue / Retirado pelo cliente | Registrar somente após a entrega ou retirada efetiva | Pedido entregue |

**Retirada e entrega local não usam a etapa postal Enviado:** avance de **Em separação** para **Pronto para retirada/entrega local**, combine pelo WhatsApp e conclua como **Retirado pelo cliente/Entregue** quando realizado. Não invente rastreio para esses casos.

Além das etapas acima, o código prepara mensagens de pedido recebido, pagamento pendente e pagamento aprovado. Na aprovação, também prepara um aviso ao administrador para separar o pedido, usando seu e-mail de notificações configurado ou o e-mail da conta administrativa. Em [E-mails](https://lojabkm.com.br/admin/emails), o status `SENT` indica envio aceito; **Entrega: Entregue** confirma o evento de entrega do provedor. Não marcar uma etapa logística apenas para testar um e-mail.

## Quando habilitar o envio normal

Depois de definir cobertura, tarifas e prazos reais, o cliente informa endereço completo e CEP atendido. A cidade/UF são conferidas pelo servidor. Após separar e embalar, marque **Separado para envio**. Somente depois da postagem, informe **Correios/transportadora**, **código de rastreamento** e **site HTTPS de rastreamento** e marque **Enviado**. A contratação da postagem é uma operação da equipe; preencher esses campos não compra uma etiqueta. Confirme **Entregue** após a entrega efetiva.

## Conferência após a primeira compra real

Registre o número do pedido e confira: total cobrado, aprovação no Mercado Pago e na BKM, baixa de uma única unidade, aviso administrativo, e-mails do cliente e retirada concluída. Se o pagamento exigir revisão financeira ou de estoque, resolva a pendência antes de prometer entrega.

No extrato do Mercado Pago, compare **valor bruto**, **taxas efetivamente cobradas** e **valor líquido a receber/recebido**. Não assuma que uma venda de R$ 10,00 resulta em R$ 10,00 líquidos; não há percentual ou prazo de liberação prometido neste guia. A dedução e o recebimento só ficam comprovados após conferir essa transação real no provedor. Até essa conferência, a primeira compra permanece uma validação a executar, sem declaração de operação completa.
