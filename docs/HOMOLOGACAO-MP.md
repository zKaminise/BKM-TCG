# Homologação Mercado Pago — Checkout Transparente com Orders

Foram criadas e consultadas duas orders efetivas no sandbox Mercado Pago: um Pix aprovado e outro pendente. A integração comprovou reconciliação, idempotência e estoque no banco isolado. O recebimento de webhook assinado continua pendente de confirmação após corrigir o segredo da aplicação emissora. Isso não constitui liberação comercial; pagamentos de produção permanecem desativados.

## Aplicação e credenciais corretas

A documentação atual informa que o vendedor de teste é criado automaticamente para integrações Orders; suas credenciais podem começar com `APP_USR`. O prefixo não distingue, sozinho, teste de produção. Confirme a seção **Testes / Credenciais de teste**, a identidade do vendedor de teste e a aplicação de origem. Não copie credenciais financeiras de produção para suprir erro de sandbox. [Contas de teste](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/resources/test-accounts), [credenciais automáticas](https://www.mercadopago.com.br/developers/pt/news/2025/11/19/Streamlined-integration-testing-with-automatic-credentials).

O painel da aplicação principal a identifica como Checkout Pro. As credenciais automáticas de teste usadas pela BKM executaram o contrato Transparente `/v1/orders`, com Pix, por uma aplicação acessível na conta vendedora de teste. O rótulo do app principal não deve substituir a conferência do `integration_data.application_id` retornado pela order e do vendedor autenticado. Não foi necessário criar outra aplicação para esse teste. [Checkout Pro com Orders](https://www.mercadopago.com.br/developers/pt/docs/checkout-pro-orders/create-order?scope=prod), [referência Transparente](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/create-order/post).

## Ambiente de homologação isolado

Use banco e configuração separados da demonstração e da operação comercial futura. O banco deve conter somente compradores, produtos e pedidos fictícios de homologação, cadastrados para esse teste. Não reutilize o seed de demonstração: a aplicação recusa cobranças externas quando `demoDataVersion` identifica esse banco.

Configuração do ambiente isolado:

```dotenv
BKM_ENVIRONMENT=staging
HOSTING_DEMO_ONLY=false
PAYMENT_PROVIDER=mercadopago
MERCADO_PAGO_ENABLED=true
MERCADO_PAGO_ENVIRONMENT=sandbox
MERCADO_PAGO_PRODUCTION_APPROVED=false
EMAIL_PROVIDER=development
```

Adicione somente no ambiente privado as credenciais de teste, `MERCADO_PAGO_SELLER_ID` confirmado, segredo do webhook, banco dedicado e URL HTTPS apropriada. O frontend recebe apenas a Public Key; Access Token e segredo de webhook ficam no servidor. Conservar `HOSTING_DEMO_ONLY=true` na demonstração pública mantém Mercado Pago desativado, mesmo com chaves presentes. Não altere a autorização comercial global para testar.

O campo SQL legado `environment` de pedidos/pagamentos aceita `demo` e `production`. Para tentativas externas, o ambiente financeiro é registrado separadamente em `payload_json.gatewayEnvironment`, e a resposta de pagamento indica `sandbox`. O serviço verifica esse ambiente antes de reusar ou reconciliar a tentativa; uma tentativa sandbox não pode ser retomada em produção. Não use o valor SQL legado isoladamente como prova de cobrança real.

### Estado efetivo em 20/10/2026

A aplicação principal tem ID `3540436696764388` e aparece como `App-Checkout-Pro-20261019-bfedeb6e04`. O vendedor das credenciais de teste é `3466948980`, site `MLB`, confirmado por `GET /users/me` como `test_user`. As duas orders retornaram `integration_data.application_id=8997426787542730` e o mesmo vendedor. O acesso à UI dessa conta vendedora confirmou a existência da aplicação emissora `8997426787542730`.

O ambiente isolado está disponível em `https://bkm-tcg-sandbox.vercel.app`, com banco Supabase `secapcqqznlokiqhojsa`, região São Paulo. O schema de 40 tabelas foi validado vazio antes da fixture. A loja principal usa `cxoeompxmgdzufgzxerw` após a migração; tanto esse projeto quanto o anterior `nxrvmanifngjmdtgnzoq` são bloqueados pelo CLI de homologação. A demonstração principal conserva seus bloqueios de cobrança externa e não participa desses pedidos.

Resultados da execução, registrados em `backups/mp-sandbox-report.json`:

| Cenário | Order Mercado Pago existente | Resultado comprovado |
| --- | --- | --- |
| Pix com `APRO` | `ORDTST01M5CXWZ7M0K4150MAPV0MP71J` | GET confirmou aprovação; reconciliação explícita deixou o pedido BKM `CONFIRMED/APPROVED` e comprometeu uma unidade. |
| Pix sem marcador de autoaprovação | `ORDTST01M5CXX9DH0MMGN3E8WCKB4WT1` | GET retornou `action_required`; pedido BKM ficou `PENDING`, com uma unidade reservada no momento da verificação. |
| Repetição dos dois checkouts | Mesmas duas orders | Chaves mantidas antes/depois da reconciliação, dois pedidos no total e nenhuma baixa adicional. |

O estoque físico passou de 2 para 1, com uma única unidade baixada e uma reservada ao pedido pendente. A reserva pendente torna a disponibilidade pública igual a zero enquanto estiver ativa; ela não é uma segunda baixa. Cada order tem valor nominal fictício de R$ 50,00. Nenhum pagamento ou envio comercial foi realizado. Os GETs não incluíram `live_mode`; a ausência desse campo não foi convertida em `false` como suposta evidência.

O relatório inicial ficou com `approvedConfirmed=true`, `pendingConfirmed=true`, `webhookProven=false` e `complete=false`. A aprovação local foi obtida por reconciliação, sem alegar recebimento de callback.

Na UI da aplicação emissora, as URLs de teste/produção e o evento Order já estavam configurados, mas o segredo de assinatura era diferente do segredo da aplicação principal. O segredo correto da aplicação `8997426787542730` foi salvo privadamente em `.env.sandbox` e na hospedagem sandbox, e o redeploy ficou Ready. O reenvio pelo simulador oficial usa a order APRO existente. Até haver resposta HTTP 200 e recibo assinado persistido, o webhook permanece **não comprovado**. Não é necessário criar outro pedido ou alterar status no banco para concluir essa verificação.

### Assistente técnico de execução

O comando `scripts/homologate-mp.cjs` lê exclusivamente `.env.sandbox`, sem carregar `.env` nem herdar credenciais de `process.env`. O modelo público está em [SANDBOX.env.example](SANDBOX.env.example). O arquivo privado e a hospedagem devem apontar para o banco dedicado, a credencial do vendedor de teste e o segredo da aplicação emissora. A fixture Pix utiliza o e-mail técnico `test@testuser.com` do exemplo oficial, sem afirmar que esse endereço foi recuperado como conta compradora automática do painel. O CLI não configura serviços ou credenciais e não cria projetos.

Configure o pooler PostgreSQL com `postgres.<ref>`, porta `6543`, banco `postgres` e TLS com certificado verificado; a URL não pode conter opções que alterem SSL. O comando recusa expressamente ambos os projetos principais: `nxrvmanifngjmdtgnzoq` (anterior) e `cxoeompxmgdzufgzxerw` (atual após migração), antes de rede ou inicialização do banco, inclusive se os demais campos forem coerentes com a referência. A URL Supabase e o usuário da conexão precisam pertencer à mesma referência de 20 letras fornecida em `--project`. O deployment separado deve usar as mesmas configurações de banco e Mercado Pago. Mantenha e-mail em `development` durante essa execução.

```powershell
node scripts/homologate-mp.cjs --verify --project secapcqqznlokiqhojsa --seller 3466948980
```

`--verify` é o padrão. Ele faz somente `GET /users/me` no Mercado Pago e `GET /api/config` no deployment fixo. Não abre banco local, não migra, não cria contas, não cria pedidos nem envia POSTs. A verificação exige `test_user` verdadeiro/registrado no retorno, vendedor e país corretos, API remota em staging/sandbox, Public Key correspondente e `canCharge=false`. O prefixo da chave e o nome do aplicativo não substituem essas provas.

Para a execução explícita, `.env.sandbox` deve conter a frase exata `BKM_SANDBOX_CONFIRMATION=SANDBOX_ONLY:secapcqqznlokiqhojsa:3466948980`. O comando utilizado é:

```powershell
node scripts/homologate-mp.cjs --run --project secapcqqznlokiqhojsa --seller 3466948980
```

Após as mesmas provas de identidade e ambiente, `--run` aplica o schema no banco dedicado e recusa contas, produtos ou pedidos alheios à fixture. Cria somente o primeiro administrador técnico privado, um cliente BKM com o e-mail técnico de teste e o produto **HOMOLOGAÇÃO · Butterfree**, referência TCGdex `sv09-003`, variante pt/NM/NORMAL, estoque inicial 2 e preço nominal fictício R$ 50,00 por unidade. Esse preço segue o exemplo técnico Pix e não é referência comercial da carta. Não usa seed demo, não importa os produtos da loja e não envia e-mail externo.

As duas tentativas são Pix: uma com `first_name=APRO`, outra sem o marcador de autoaprovação. O segundo cenário é candidato a pendente e só será marcado confirmado se o GET real retornar `PENDING`; o script não inventa um resultado por nome. Cada tentativa reserva uma unidade. A mesma solicitação é reenviada com a mesma chave antes e depois da reconciliação, verificando uma única order por cenário e a ausência de baixa adicional. Não há dados de cartão, documento ou transferência real nessa rotina.

O checkpoint privado `.env.sandbox.state.json` guarda credenciais técnicas aleatórias, chaves estáveis e IDs para retomar a mesma execução. Ele é ignorado pelo Git; preserve-o para uma retomada, sem copiá-lo para relatórios. O lock `.env.sandbox.lock` impede duas execuções simultâneas. Se o processo for encerrado abruptamente, remova esse lock somente após confirmar que não existe outro processo de homologação ativo. Nunca apague o checkpoint para tentar uma nova cobrança após resposta inconclusiva.

O relatório `backups/mp-sandbox-report.json`, também ignorado pelo Git, contém somente IDs técnicos, estados, centavos, reserva/baixa e resultado das verificações. Ele exclui credenciais, cookies, e-mails, endereço, QR, token, documento e dados de cartão. O assistente espera até um minuto por **aprovação e recibo webhook**, sem encerrar a espera apenas porque um GET aprovou o pedido. O prazo também cancela o GET em andamento; `callbackWait` registra somente estados de verificação. Depois ocorre a reconciliação explícita. `webhookProven` exige um recibo válido registrado por essa rota; aprovação obtida somente por reconciliação não é apresentada como entrega de webhook. O resultado só é `SANDBOX_SCENARIOS_CONFIRMED` quando aprovação, pendência e callback foram comprovados; caso contrário o comando deixa evidência incompleta e código de saída não zero, sem criar cobranças substitutas.

O assistente já foi executado nos serviços isolados e comprovou os resultados Pix descritos acima. O callback ainda está em verificação. Preserve o checkpoint e acompanhe as orders existentes; não reinicialize a fixture para tentar produzir uma evidência nova. Cartão pelo Brick, recusa, expiração, cancelamento e reembolso continuam no roteiro abaixo e não são declarados aprovados pelo assistente.

## Contrato que a BKM implementa

O backend envia `POST /v1/orders` com `type=online`, `processing_mode=automatic`, referência do pedido e valor decimal exato, sempre calculado a partir dos centavos armazenados. A chave de idempotência é estável por tentativa. Após obter o ID, o backend consulta `GET /v1/orders/{id}` e confirma vendedor, referência, país, moeda e valor antes de aplicar estado financeiro e estoque. A resposta de criação, inclusive HTTP 402 com order existente, não é tratada como aprovação isoladamente. [Criar order](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/create-order/post), [obter order](https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/get-order/get).

O formulário de cartão usa o Card Payment Brick e envia token, bandeira, tipo e parcelas; PAN e CVV não são encaminhados à API BKM nem persistidos. É preciso testar o SDK verdadeiro no navegador: testes unitários com token fictício não comprovam tokenização ou aprovação externa. [Cartões no site](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/payment-integration/websites/cards).

## Execução dos cenários

Registre por cenário apenas: data, ambiente, ID do pedido BKM, ID da order do provedor, estado consultado, quantidade reservada/baixada, eventos e resultado. Não registre tokens, documentos completos, dados de cartão, senhas ou chaves.

| Cenário | Ação no ambiente isolado | Resultado a comprovar |
| --- | --- | --- |
| Cartão aprovado | Usar cartão oficial de teste no SDK e titular `APRO`. | GET confirma aprovação; pedido fica confirmado; estoque baixa uma vez. |
| Cartão pendente | Usar cenário oficial `CONT`. | Pedido mantém reserva ativa; consultar/receber evento posterior sem nova cobrança. |
| Cartão recusado | Usar cenário oficial `OTHE`, e depois os demais resultados necessários. | Recusa confirmada; reserva liberada; nenhum estoque baixado. |
| Pix de teste | Usar requisição de teste conforme seção seguinte. | Aguardar transição no provedor, consultar GET e conferir estado local. |
| Expiração | Obter evento/consulta com `canceled/expired` ou `failed/expired`. | Estado local `EXPIRED`; reserva liberada; nenhuma baixa. |
| Cancelamento | Cancelar uma order elegível no provedor de teste e reconciliar. | Estado `CANCELLED`; não desfazer nem duplicar uma venda já aprovada. |
| Reembolso | Reembolsar uma order aprovada no provedor de teste e reconciliar. | Estado `REFUNDED`, histórico e e-mail idempotente; sem reposição automática de item já enviado. |
| Repetição | Reenviar a mesma solicitação e webhook. | Mesma order; um evento financeiro efetivo, uma baixa e nenhum novo pagamento. |
| Resposta inconclusiva | Simular interrupção/timeout após envio sem presumir recusa. | Pedido/tentativa ficam conciliáveis; sem criação substituta automática. |
| Última unidade | Disputar uma unidade por duas conexões. | Somente uma reserva/venda elegível; nenhuma quantidade negativa. |

Consulte os cartões e documentos de teste diretamente na página oficial vigente. Os nomes `APRO`, `CONT` e `OTHE` controlam resultados no ambiente de teste; não utilize cartão ou documento real. [Compra de teste com cartões](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/integration-test/cards).

### Particularidade do Pix sandbox

A documentação orienta um teste por requisição com valores predefinidos, incluindo `payer.first_name=APRO`. Esse cenário retorna inicialmente `action_required/waiting_transfer` e posteriormente muda para aprovado no serviço; não é necessário realizar transferência bancária real. [Teste Pix oficial](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/integration-test/pix).

O adapter e a validação do pedido permitem fornecer `payer.firstName: 'APRO'` na API técnica e traduzem para `payer.first_name`. Eles continuam consultando o provedor e não aprovam localmente por causa desse nome. O checkout público não inclui um seletor de cenários de teste. Um teste técnico direto no adapter prova esse contrato específico, mas não substitui o teste integrado de pedido, webhook, estoque e interface.

### Notificações e reconciliação

No painel da **aplicação que efetivamente emitiu a order**, configure o evento **Order (Mercado Pago)**, tópico de configuração `orders`, e a URL `https://bkm-tcg-sandbox.vercel.app/api/payments/webhook/mercadopago`. A documentação Orders orienta a aba Modo de produção; no projeto, a conferência deve ser feita dentro da conta vendedora de teste e da aplicação emissora `8997426787542730`. O payload usa `type=order`. A assinatura utiliza `x-signature`, `x-request-id` e o `data.id` da query; o ID alfanumérico entra em minúsculas no manifesto HMAC. Segredos de aplicações diferentes não são intercambiáveis, mesmo que compartilhem URL e eventos selecionados. A BKM não aceita o status do corpo como fonte financeira e consulta a order assinada no provedor. [Configuração de notificações Orders](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/notifications).

Teste notificações legítimas, assinatura inválida, repetição e entrega atrasada. A aplicação atualmente aplica janela de dez minutos ao timestamp assinado; a compatibilidade dessa janela com os retries observados precisa ser confirmada na homologação, sem desativar HMAC ou deduplicação. Não redirecione o webhook de sandbox para um ambiente demo que mantém o provedor desativado e espere aprovação end-to-end.

Cancelamento e reembolso são ações financeiras diferentes. O código reconcilia seus estados confirmados, mas não oferece endpoints públicos da BKM para iniciar esses comandos. Execute-os no provedor de teste ou em ferramenta administrativa autorizada, preservando idempotência, e então reconcilie. Reembolso parcial fica em revisão financeira; não é apresentado como reembolso total concluído. [Cancelamentos e reembolsos](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/payment-management/refunds-cancellations), [estados oficiais](https://www.mercadopago.com.br/developers/en/docs/checkout-api-orders/payment-management/status/order-status).

## Aceite e estado do trabalho

Os testes locais cobrem valores, validação de vendedor, ambiente, reserva, baixa, duplicações, respostas inconclusivas, reembolso e outbox, com transporte substituído e bancos isolados. Separadamente, as duas orders externas de sandbox comprovaram aprovação/pendência por consulta, reconciliação, idempotência e estoque. Os números históricos de testes da Fase 2 não devem ser apresentados como homologação externa.

O aceite do webhook ainda exige a confirmação do reenvio oficial assinado e do recibo persistido após corrigir o segredo por aplicação. Não declare esse resultado concluído apenas porque o provedor aprovou um Pix ou o redeploy ficou Ready. Antes da liberação comercial, conclua os cenários aplicáveis do roteiro, incluindo SDK e estados ainda não executados no provedor. Produção continua desativada e exige autorização final separada.
