# Produção e primeiro teste real

A loja principal foi habilitada em **https://lojabkm.com.br/** com `BKM_ENVIRONMENT=production`, Mercado Pago em produção e `canCharge=true`. O sandbox continua separado, em staging e sem cobranças comerciais. O proprietário optou por manter a hospedagem Hobby nesta etapa.

## Configuração verificada

- Google habilitado no domínio canônico. O vínculo da conta existente já havia sido validado; o novo cadastro Google do comprador integra o teste real abaixo.
- Recuperação de senha: fluxo completo validado com uma conta de QA, incluindo token de uso único e revogação de sessão. Um novo e-mail ao titular autorizado foi **DELIVERED** no ambiente de produção, confirmado também pelo webhook assinado; a senha do titular permaneceu inalterada.
- Credencial Mercado Pago validada na conta real. A consulta autenticada de meios de pagamento confirmou Pix, crédito e débito ativos. Não foi criada cobrança de produção pelo agente.
- Webhook da aplicação real configurado para `/api/payments/webhook/mercadopago`. A confirmação financeira de uma compra real ainda depende do pagamento feito pelo comprador.
- Consumidor Supabase Cron ativo a cada minuto, com chamada natural **HTTP 200** ao worker. O endpoint rejeitou ausência de autenticação e assinatura vencida. Vault guarda a chave; a fila HTTP recebe apenas assinatura temporária e timestamp.
- **318 testes automatizados passaram**, além de sintaxe/build e conferências de interface. A matriz financeira externa anterior foi feita exclusivamente no sandbox.

## Estoque, frete e comunicação

Os **16 produtos demonstrativos** foram arquivados, suas **18 variantes** desativadas e as **70 unidades** fictícias retiradas do estoque, com backup criptografado e trilha administrativa. Usuários, pedidos e coleções pessoais foram preservados. Os registros arquivados podem ser consultados pelo filtro administrativo; não são ofertas comerciais.

Retirada e entrega local em Uberlândia/MG estão gratuitas. Prazo e ponto de retirada são combinados após o pagamento pelo WhatsApp configurado. O mínimo de frete grátis é **R$ 150**, editável no painel. As tarifas das cinco regiões podem ser cadastradas; **envios para outras cidades permanecem desativados até confirmar valores e prazos**, pois a calculadora oficial não retornou uma cotação válida na consulta realizada. Nenhuma tarifa estimada foi apresentada como preço confirmado de transportadora.

A reserva começa na confirmação do pedido e dura **15 minutos**. A disponibilidade desconsidera a reserva vencida; o consumidor periódico atualiza o pedido e tenta cancelar a cobrança remota. A execução por minuto e a disponibilidade dos provedores podem acrescentar atraso ao processamento. Aprovação tardia ou estoque já realocado exige revisão financeira, sem usar a unidade de outro comprador; eventual reembolso é operacional.

O código enfileira os quatro avisos ao cliente nas etapas de criação, espera de pagamento, pagamento aprovado e separação. Cada administrador recebe o aviso após confirmação do pagamento; o destinatário operacional do administrador atual foi definido para o e-mail informado pelo proprietário. Separação para envio, envio/rastreio e conclusão também geram seus avisos. Aceitação pela API de e-mail e entrega são estados distintos.

## Validação de R$ 10 com retirada

1. No [painel](https://lojabkm.com.br/admin), cadastrar o produto real com preço **R$ 10,00**, quantidade disponível, fotos e condição corretas; publicar o anúncio.
2. O amigo cria a própria conta, abre o produto, adiciona ao carrinho e escolhe **Retirar na loja — grátis**.
3. Confirma o pedido e paga com a própria conta/cartão ou Pix dentro do prazo. Verifica os e-mails e a atualização para **Em separação**.
4. O administrador confere o aviso recebido e o pagamento na conta Mercado Pago, separa o item e marca-o como pronto para retirada. Após entregar, registra a conclusão.
5. Conferir o valor líquido e os prazos de disponibilidade diretamente no Mercado Pago. As taxas e opções de parcelamento são as efetivamente oferecidas pelo provedor; não há percentual inventado na loja.

**O recebimento real, os e-mails desse pedido e sua conclusão física ainda serão comprovados nessa compra.** O catálogo ficou sem produtos publicados para que apenas estoque real seja anunciado. O guia detalhado está em [OPERACAO-PRODUCAO.md](OPERACAO-PRODUCAO.md).
