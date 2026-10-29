# Pedidos, Pix e home — entrega de 29/10/2026

O proprietário confirmou a primeira compra real: o amigo criou a conta, adicionou o produto ao carrinho, concluiu checkout, pagou via Pix, recebeu os e-mails e o site reconheceu o pagamento. Isso é evidência operacional relatada pelo titular; não foi uma cobrança executada pelo agente. Crédito/débito permanecem configurados e homologados em sandbox, sem uma nova cobrança comercial nesta entrega.

## Melhorias implementadas

- QR Code PNG gerado localmente a partir do código Pix exato do Mercado Pago, sem enviar o código a outro serviço. O comprador pode escanear no computador ou copiar no celular. O código continua válido apenas dentro da reserva; pedidos pagos/expirados não recebem Pix para novo pagamento. Funciona também com pedidos pendentes anteriores à mudança.
- Corrigido o texto `null`: o DOM recebia literalmente um valor nulo depois da aprovação. A confirmação agora é um quadro compacto verde. O botão de consulta permanece somente em pagamento pendente ou em análise.
- Acompanhamento em cinco etapas: pedido, pagamento, separação, envio/pronto para retirada e entrega/retirada concluída. Etapas alcançadas em laranja e futuras em cinza; estado atual com texto e sem depender apenas de cor. Desktop horizontal e celular vertical. Cancelamento, expiração, reembolso e análise possuem mensagens próprias e preservam etapas físicas já realizadas.
- Pedidos pagos ainda em andamento consultam atualizações enquanto a página estiver visível. A navegação cancela os temporizadores.
- Rastreio destacado para enviados/entregues, com transportadora, código copiável e link HTTPS específico do pedido em nova aba. Os campos administrativos existentes foram preservados e receberam identificação mais clara.
- Home mantém a animação 3D e oferece acesso imediato aos produtos e categorias. Arte frontal usa cores da imagem sem iluminação/exposição duplicada.
- O novo pacote usa o PNG original fornecido pelo proprietário, preservado byte a byte em `assets/pack-herois-v6.png`. A tentativa de recorte transparente pelo serviço de imagens foi bloqueada; não foi usado outro editor de bitmap. O enquadramento foi feito na geometria/UV da animação, sem redesenhar a embalagem.
- Administração: Configurações → Pacote da animação da home, com upload PNG/JPEG/WebP até 8 MB, link HTTPS, prévia e restauração do padrão. A escolha só entra na loja após salvar. Busca de imagem atrasada não substitui a escolha mais recente; erro preserva a imagem em funcionamento.

## Validação

471 testes aprovados na suíte completa, incluindo QR lido por decodificador independente e confirmação de ausência de alteração em pagamento/estoque durante serialização. Testes cobrem estados de pedido, rastreio por transportadora, limites/erros de upload, concorrência de imagens, autorização e persistência da configuração, SQLite e PostgreSQL, SEO e fluxos financeiros existentes.

Navegador em banco SQLite isolado: código Pix sintético não pagável com QR/cópia, pago sem `null` ou botão de consulta, separação, retirada pronta e envio com código/link; animação WebGL inicial e revelação final sem erros de console. Nenhum pedido sintético foi gravado no banco comercial.

SEO, Google e limites do avatar de remetente estão documentados em [SEO e identidade de e-mail](SEO-E-IDENTIDADE-EMAIL.md). A logo no corpo dos e-mails já existia. O avatar da caixa de entrada depende de BIMI/provedor/certificação; não foi prometido nem habilitado sem requisitos externos.
