# BKM TCG — inventário funcional do site

Revisão de **29/10/2026**. Este inventário separa funcionalidades implementadas, configurações efetivas e provas que ainda dependem de operação real. Relatórios datados de fases anteriores são históricos; não descrevem sozinhos o estado atual.

## Loja pública

| Área | O que existe | Limite ou ação operacional |
|---|---|---|
| Identidade e início | Logo BKM, tema preto/vermelho/ciano/prata, navegação responsiva, animação 3D de abertura do booster e revelação da carta | Conteúdo e estoque comercial dependem dos cadastros reais do administrador |
| Catálogo | Cartas avulsas e lacrados, busca, filtros, ordenação, páginas por coleção e aliases, conservação visível no card | Os 16 anúncios de demonstração foram arquivados; não representam mercadoria disponível |
| Produto | Cartas, selados e personalizados; fotos próprias por upload/link e de referência identificadas, ampliação, descrição, variantes de idioma/condição/acabamento/atributos, preço e disponibilidade | Administrador deve conferir a unidade física e cadastrar sua quantidade real |
| Carrinho e favoritos | Adicionar/remover/alterar quantidade, drawer, persistência por conta e reconciliação de favoritos arquivados | Carrinho não reserva o estoque |
| Cupons e frete | Cupons, mínimo de frete grátis editável e barra de progresso; painel com origem privada, embalagens reais, faixas de CEP, transportadora/serviço, preço, prazo e confirmação por região | Frete nacional obedece à configuração ativa da administração e à integração autorizada. Na consulta pública final estava habilitado; esta entrega não alterou a configuração de frete. A conferência física dos pacotes e a postagem permanecem parte da operação da loja |
| Uberlândia | Retirada gratuita e entrega local gratuita quando habilitadas; CEP local conferido; contato por WhatsApp depois do pagamento | Ponto e horário são combinados pelo atendimento |
| Conteúdo institucional | Atendimento, perguntas frequentes, envio, devoluções, privacidade e termos | Razão social/CNPJ e endereço/horários definitivos ainda não foram fornecidos |

## Contas e área do cliente

- Cadastro e login por e-mail/senha, sessão segura, proteção de origem/CSRF, logout e alteração de senha com revogação de outras sessões. Novas senhas locais e alterações exigem **9 a 14 caracteres inclusive**, ao menos uma maiúscula ASCII A–Z e um dígito 0–9; símbolos são opcionais e não há requisito de minúscula. A mesma política e mensagens atendem frontend e backend, incluindo cadastro, redefinição, alteração e criação administrativa. As telas exibem instruções antes da digitação, checklist, confirmação e mostrar/ocultar. Senhas antigas continuam autenticando sem alteração do hash ou redefinição obrigatória; Google não exige senha local.
- Google OIDC habilitado em produção, com state/nonce/PKCE, vínculo explícito de uma conta já existente e proteção contra vinculação indevida pelo mesmo e-mail. Vínculo e novo login da conta vinculada foram comprovados anteriormente; o cadastro externo de uma conta Google inédita faz parte da prova operacional do comprador.
- Recuperação por e-mail com resposta genérica, token de uso único e expiração. O fluxo de redefinição/revogação foi testado com conta de QA; um e-mail de recuperação ao titular autorizado foi entregue em produção, sem alterar sua senha.
- Perfil, endereços e endereço padrão, pedidos com acompanhamento e retomada de pagamento, preferências, segurança e notificações.
- Produtos favoritos e lista de desejos são áreas diferentes. Desejos podem referenciar cartas que nem estão anunciadas na loja, com filtros de versão/idioma/condição/preço e avisos sujeitos a consentimento.
- Minha Coleção possui inventário próprio, independente dos produtos e do saldo comercial. Consulte o [relatório do módulo](MINHA-COLECAO.md) para funcionalidades, testes, fontes e limites da nova versão.
- Em `/conta/colecao/adicionar`, a busca reage à digitação de nome/número e à troca de coleção/idioma, com intervalo curto, controle de respostas antigas e pesquisa manual ainda disponível. Não é necessário clicar em Pesquisar para cada consulta.
- As cartas podem trazer referências reais de **Cardmarket em EUR e TCGplayer em USD via TCGdex**, com fonte/data e correspondência de acabamento explicitadas. Esses dados acompanham a carta no inventário; ausência, referência antiga ou versão incompatível ficam sinalizadas. **Não há conversão automática para BRL nem ajuste de preço por conservação ou idioma físico**, pois a fonte não fornece essa correspondência. Valores manuais/autorizados em BRL e seus totais/lucros permanecem separados; o valor internacional não é apresentado como cotação brasileira da condição cadastrada.

## Pedidos e pagamentos

| Etapa | Comportamento implementado |
|---|---|
| Confirmar pedido | Valida preço/estoque no servidor e reserva por 15 minutos em transação; concorrência pela última unidade e repetição idempotente são tratadas |
| Aguardando pagamento | Mesmo pedido pode ser retomado dentro do prazo; a escolha de cartão reserva antes da tokenização e não cria outra cobrança ao simplesmente reabrir |
| Expiração | Libera a disponibilidade e tenta cancelar a cobrança remota; consumidor Supabase Cron executa a cada minuto |
| Pagamento aprovado | Confere o provedor e a identidade financeira da order; baixa uma única vez e move para Em separação |
| Aprovação tardia | Exige revisão financeira quando a reserva expirou/estoque foi realocado; não usa a unidade de outro comprador |
| Operação do administrador | Em separação → Separado para envio → Enviado → Entregue; rastreio e transportadora informados para envio normal |
| Retirada/local | Pode concluir após separar e entregar, sem inventar código de transportadora |

Mercado Pago está configurado com a conta real em produção; a consulta de meios ativos confirmou **Pix, crédito e débito**. Parcelas e juros são os apresentados pelo SDK/provedor. O webhook real está configurado. Cartões, aprovação/recusa, Pix e reembolso integral foram exercitados no sandbox separado; isso não comprova recebimento comercial de uma compra real.

O proprietário confirmou a primeira compra real via Pix: cadastro, carrinho, checkout, pagamento recebido, e-mails e atualização automática do pedido funcionaram. Essa é evidência operacional relatada pelo titular; o agente não executou cobrança comercial. Novas provas de cartão e outros destinos continuam independentes desse teste. Reembolsos parciais e a matriz completa de disputas/estornos ainda não têm homologação externa; reembolso e reposição de estoque não são a mesma ação.

O Pix do provedor tem prazo remoto mínimo diferente do prazo comercial da loja. A reserva local continua sendo 15 minutos; a execução periódica, rede ou indisponibilidade podem acrescentar atraso ao cancelamento remoto. Não há promessa de agendamento com precisão absoluta nem reembolso automático de pagamento tardio.

## E-mails e notificações

- Resend configurado no domínio `lojabkm.com.br`, remetente transacional e endereço de resposta do atendimento.
- Fila persistente, deduplicação, repetição controlada, estado de entrega e webhook assinado. Aceitação pelo provedor e entrega são estados separados.
- Avisos ao cliente: pedido criado, aguardando pagamento com link para retomar, pagamento recebido, em separação, pronto para envio/retirada, enviado/rastreio e conclusão.
- Cada administrador tem um aviso próprio quando o pagamento é confirmado. O destinatário operacional configurado para as contas administrativas é **gabriel.misao08@gmail.com**, informado pelo proprietário; como ambas apontam ao mesmo destino, esse endereço pode receber dois avisos do mesmo pedido. Endereço de login administrativo e caixa postal são configurações diferentes.
- Recuperação de senha e um resumo de desejos foram efetivamente entregues ao titular autorizado. O proprietário confirmou o recebimento dos e-mails da primeira compra real Pix; a auditoria individual de cada destinatário/modelo continua disponível no painel de e-mails.
- Alertas de desejos e resumos diário/semanal têm implementação persistente e consentimentos independentes. A prova externa completa do alerta imediato ainda não foi concluída.
- Marketing e carrinho abandonado não possuem campanhas/automações de envio habilitadas apenas por existir uma preferência no perfil.

## Painel administrativo

Login em `/admin`, com permissão verificada no servidor. Há gestão de produtos/rascunhos/publicação/arquivo, variantes e estoque, fotos, coleções e aliases, cupons, pedidos e etapas logísticas, configurações da loja e frete, referências de preços autorizadas, fila de e-mails e integrações. Alterações relevantes possuem trilha administrativa. Custos e notas particulares dos clientes não são expostos pelo painel global de preços.

As contas administrativas são **admin@bkmtcg.com.br** e **gerente@lojabkm.com.br**, com a mesma senha válida confirmada pelo proprietário, sem publicá-la neste relatório. Criar `gerente@lojabkm.com.br` como login do sistema não cria uma caixa de e-mail nesse domínio: os avisos operacionais continuam indo ao endereço real do proprietário. Dados de pagamentos e segredos de provedores não fazem parte do frontend ou do ZIP público.

O painel de logística informa o que falta antes de habilitar cada região. Alterar origem, embalagem, tarifa, prazo ou cobertura regional exige nova conferência operacional. O endpoint público de configuração omite endereço de postagem, perfis de embalagem e dados internos de validação; os dados completos ficam na administração autenticada. O checkout recalcula no servidor após descontos e mudança de destino, confere CEP/cidade/UF e recusa serviço indisponível; retirada dispensa endereço de entrega.

## Infraestrutura, dados e continuidade

- Produção em [lojabkm.com.br](https://lojabkm.com.br/), com redirecionamentos canônicos preservando rota e parâmetros. Vercel Hobby mantido conforme decisão do proprietário; nenhum plano pago foi contratado.
- Supabase/PostgreSQL principal e sandbox separados, TLS verificado. A sessão da aplicação é própria: o navegador não recebe grants nas tabelas da aplicação; RLS e validação de propriedade no servidor protegem as informações particulares.
- Worker de reservas/e-mails com chamada Supabase Cron autenticada por HMAC temporário. A chave permanece no Vault, sem ser colocada na fila HTTP. Chamada natural HTTP 200 já comprovada.
- Migrações versionadas, testes SQLite e PostgreSQL/PGlite, build e CI. Chaves reais, `.env`, bancos e backups estão excluídos do Git e do pacote público.
- Backup criptografado e restauração isolada implementados e testados. Ainda falta instituir rotina automatizada, retenção e cópia independente operacional.
- Monitoramento operacional existe pelo painel e pelos provedores; atendimento contínuo, alertas de infraestrutura e acompanhamento de incidentes dependem da rotina da loja.
- A entrega atual libera as páginas públicas do domínio oficial para indexação e inclui HTML inicial do catálogo real, dados estruturados e sitemap dinâmico. Áreas privadas, APIs, sandbox e preview seguem noindex. O Search Console foi confirmado pelo titular, o sitemap foi processado com 13 páginas e as solicitações de indexação da home e de um produto real foram aceitas; a decisão de indexar/posicionar pertence ao Google; consulte SEO-E-IDENTIDADE-EMAIL.md.

## Pendências reais por prioridade

1. **Operação contínua:** a primeira compra real Pix foi confirmada pelo proprietário. Conferir cada venda, separação/retirada e recebimento líquido; cartões e cenários adicionais ainda exigem suas provas comerciais próprias.
2. **Logística nacional:** a integração Melhor Envio cota produção, permite escolha no checkout e preserva o serviço no pedido; a credencial de cotação/rastreio está salva privadamente. Quatro cotações reais com embalagens simuladas comprovaram a conexão. A API não compra etiquetas. O envio nacional constava habilitado na configuração pública final, sem alteração de frete nesta entrega. Antes de postar, o operador deve conferir os dados completos da origem, peso/medidas/capacidade dos pacotes físicos e disponibilidade do serviço contratado; a primeira postagem real continua sendo uma prova operacional independente da compra com retirada. Consulte LOGISTICA.md e o estado atual do painel.
3. **Preço brasileiro automático e por condição:** a API oficial MYP Cards está integrada ao código, com cache e referências agregadas PT/EN quando há correspondência segura; a primeira chamada externa retornou HTTP 403 e o titular ainda não tem acesso aprovado. Falta liberar e homologar esse acesso com o provedor. A MYP não fornece uma avaliação exata por conservação/acabamento nesses endpoints de anúncios; TCGdex fornece o fallback internacional; agora ele pode gerar uma estimativa em reais com conversão explícita pela PTAX do Banco Central, identificada como referência internacional e sem ajuste à conservação. Liga Pokémon permanece sem integração licenciada. Consulte [MYP Cards](MYP-CARDS.md).
4. **Dados comerciais e conteúdo final:** informar razão social/CNPJ e dados definitivos de retirada/atendimento quando existirem; revisar políticas e conteúdo conforme a operação real.
5. **Aquisição e continuidade:** acompanhar o Search Console confirmado e a indexação/SEO público, instituir backups/retencão/cópia separada, monitoramento e testar os caminhos externos restantes de Google/alertas/disputas/reembolso parcial antes de depender deles operacionalmente.

Essas pendências não impedem o uso privado da coleção ou o teste de compra com retirada descrito no [guia operacional](OPERACAO-PRODUCAO.md). Não representam promessa de cotação nacional, liquidação financeira, prazo de transportadora ou SLA que não tenha sido comprovado.


Ajustes desta entrega: tela de conclusão após cadastro/salvamento; códigos de conservação no catálogo; CEP automático na origem; perfis, tabela por UF com herança regional e Melhor Envio integrado ao simulador/checkout. 443 testes aprovados. Detalhes e tamanhos de embalagem propostos em [Logística](LOGISTICA.md).


Entrega de pedidos/home: QR Code Pix, cinco etapas visuais, correção do null e botão após aprovação, rastreio destacado e novo pack configurável pelo admin. Suíte completa atual: **471 testes aprovados**. Ver [relatório](PEDIDOS-PIX-E-HOME.md).

Entrega de endereços/fotos: CEP automático também na conta do cliente; bandeiras e conservação destacada nas versões do produto; upload reconhecendo o formato real do arquivo e galeria com até cinco fotos, múltipla seleção, links, reordenação e capa. Suíte completa atual: **493 testes aprovados**. Ver [relatório](AJUSTES-ENDERECOS-FOTOS.md).

Entrega de busca/preços: pesquisa nominal sem expandir Detetive Pikachu; provider oficial MYP Cards, cache persistente diário e avaliação brasileira agregada com prioridades/limites explícitos. Acesso externo MYP ainda sem homologação após HTTP 403; nenhuma cotação foi inventada. Suíte completa atual: **530 testes aprovados**. Ver [relatório](MYP-CARDS.md).


Entrega de estimativas em reais: conversão explícita EUR/USD para BRL pela PTAX oficial, cartões e totais coerentes, cache compartilhado e prioridades preservadas. **553 testes aprovados**, SQLite/PGlite, mais validação visual desktop/mobile e consulta real ao Banco Central. Ver [relatório](ESTIMATIVAS-REAIS.md).
