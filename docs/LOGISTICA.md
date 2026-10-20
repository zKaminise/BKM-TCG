# Logística BKM TCG

Pesquisa e verificação documental: **19/10/2026**. Nenhuma assinatura, carteira, etiqueta ou cobrança foi criada nesta etapa. O checkout continua com o frete de demonstração já configurado.

## Opções avaliadas

| Opção | Condição de acesso publicada | Custo e cuidados | Situação no projeto |
| --- | --- | --- | --- |
| Melhor Envio | Plataforma com plano Free e API; sandbox tem conta e credenciais separadas da produção. | A página de assinaturas informa Free a R$ 0/mês. Isso descreve mensalidade, não transporte gratuito: a contratação de envios pertence a um fluxo separado de cotação, pagamento e geração de etiqueta. | Adaptador de consulta sandbox implementado; credencial e homologação pendentes. |
| Correios / CWS / Meu Correios | O catálogo contém APIs públicas e privadas. API Prazo é restrita a contrato ativo, conta PJ e serviço autorizado no contrato/cartão de postagem. | Não presumir acesso irrestrito apenas por possuir login Meu Correios. Condições comerciais e serviços devem ser conferidos no contrato efetivo da BKM. | Alternativa futura para integração direta, sem contrato criado nesta etapa. |
| SuperFrete | Site oficial oferece integração por API para sites próprios. A central informa ausência de mensalidade e pagamento do frete utilizado. | Acesso à API, credenciais, permissões e condições específicas precisam ser conferidos no cadastro autorizado. Os termos preveem regras próprias para funcionalidades como API e ajustes por divergência de medidas/peso. | Alternativa avaliada; nenhum cliente, token ou adaptador SuperFrete foi ativado. |

Fontes: [planos Melhor Envio](https://lp.melhorenvio.com.br/assinaturas/), [FAQ Melhor Envio](https://docs.melhorenvio.com.br/reference/faq), [desenvolvedores Correios](https://www.correios.com.br/atendimento/developers/), [manual API Prazo](https://www.correios.com.br/atendimento/developers/manuais/manual-api-prazo), [SuperFrete: mensalidade](https://ajuda.superfrete.com/artigo/preciso-pagar-alguma-taxa-ou-mensalidade-para-o-super-frete/), [SuperFrete: integração](https://superfrete.com/conteudo/integracao-frete), [termos SuperFrete](https://superfrete.com/termos-de-uso-e-condicoes).

A escolha técnica inicial é homologar a **consulta sandbox do Melhor Envio**, porque existe uma interface documentada adequada à cotação por produtos. É uma decisão de implementação, não uma garantia de menor preço ou aprovação comercial. A seleção final deve comparar cotações reais das embalagens e rotas utilizadas pela BKM.

## O que o código permite

`server/shipping-provider.cjs` exporta `createShippingProvider`, `shippingReadiness`, `ShippingError` e a conversão monetária `brlToCents`. A instância expõe somente:

- `readiness()` — status público, nomes das configurações faltantes, sem revelar token;
- `quote({zip, items, services})` — cotação por produtos;
- `tracking({orderIds})` — consulta de status de etiquetas **já existentes**, por UUID.

Os dois endereços permitidos são fixos no código, em `https://sandbox.melhorenvio.com.br`: `/api/v2/me/shipment/calculate` e `/api/v2/me/shipment/tracking`. Não existe método genérico de chamada, compra, carrinho do provedor, checkout, geração ou cancelamento de etiqueta. Uma variável que tente trocar o endereço da API não altera esse destino. Redirecionamentos HTTP são recusados.

O módulo **ainda não é chamado pelo checkout, pelos pedidos ou pela administração**. Portanto, configurar as variáveis abaixo não troca o frete publicado nem contrata qualquer serviço. Nenhuma credencial real foi adicionada para este adaptador.

## Configuração privada para homologação

Valores exigidos no ambiente do servidor:

```dotenv
SHIPPING_PROVIDER=melhorenvio
MELHOR_ENVIO_ENABLED=true
MELHOR_ENVIO_ENVIRONMENT=sandbox
MELHOR_ENVIO_TOKEN=
MELHOR_ENVIO_ORIGIN_ZIP=
MELHOR_ENVIO_USER_AGENT=
```

O token deve ser obtido no sandbox autorizado e guardado em `.env` privado ou nas variáveis seguras da hospedagem. O User-Agent precisa identificar a aplicação e conter um contato técnico verdadeiro. O CEP deve ser o da origem operacional escolhida pela BKM. O adaptador permanece desativado se faltar algum desses valores, se a ativação não for explícita ou se o ambiente informado for produção. O [FAQ oficial](https://docs.melhorenvio.com.br/reference/faq) diferencia as contas e credenciais dos ambientes e informa o cabeçalho de identificação obrigatório.

Para cada item, o chamador fornece `id`, `quantity`, `weightGrams`, `widthCm`, `heightCm`, `lengthCm` e `priceCents`. Não há peso ou dimensão fictícios de fallback. O adaptador converte gramas para quilogramas e centavos para o valor segurado unitário. Medidas precisam representar o produto/embalagem efetivamente utilizado; a composição do pacote deve ser homologada com os serviços escolhidos. A documentação de [cotação por produtos](https://docs.melhorenvio.com.br/reference/calculo-de-fretes-por-produtos) descreve unidades, quantidade e campos personalizados de preço/prazo.

## Contrato de retorno e tratamento de falhas

A cotação retorna `quotes` e `unavailable`, com origem/destino normalizados. Uma opção válida informa `serviceId`, `name`, `company`, `amountCents`, `currency: BRL`, `estimatedDays`, eventual `deliveryRange`, `quotedAt`, `sandbox: true` e `contracted: false`.

O preço provém de `custom_price`; o prazo provém de `custom_delivery_time`. Se esses campos estiverem ausentes ou inválidos, a aplicação não substitui por um preço ou prazo inventado. Moeda estrangeira, precisão maior que centavos, medidas inválidas, serviços inesperados e respostas incompletas são recusados. Falha ou indisponibilidade de um serviço não vira frete grátis. A chamada usa timeout de oito segundos, limitado a quinze, inclusive para leitura do corpo; a resposta JSON tem limite de 1 MB. Erros externos não são copiados para logs ou mensagens públicas com corpo bruto.

O [endpoint de tracking](https://docs.melhorenvio.com.br/reference/rastreio-de-envios) consulta o ciclo de vida da etiqueta. O retorno do adaptador preserva `providerStatus`, `trackingCode`, datas recebidas e `sandbox: true`. Uma etiqueta liberada não é convertida automaticamente em pedido enviado ou entregue. Ausência do ID na resposta produz `found: false`. Esse módulo não atualiza pedidos e não fabrica eventos de transporte.

## Antes de integrar à operação

1. Obter acesso sandbox pelo titular e homologar autenticação, serviços disponíveis, pesos, medidas, cotações e formato real dos retornos.
2. Na futura API de checkout, ler produtos, quantidades, valores e características do banco; conferir estoque e origem no servidor. O navegador não deve definir o preço final do frete ou o endpoint externo.
3. Guardar a opção escolhida com preço/prazo/fonte/data e tratar validade/recalcular antes de confirmar. Preservar o pedido se o provedor estiver indisponível, sem anunciar frete como contratado.
4. Definir embalagem real, capacidade de postagem, expedição, seguro e calendário/prazos aplicáveis. Confirmar as exigências fiscais e operacionais com o responsável da loja.
5. Somente depois de aprovação específica, implementar o fluxo financeiro de etiquetas com idempotência, auditoria e confirmação do responsável. O código atual não executa esse fluxo.

A documentação de [inserção no carrinho Melhor Envio](https://docs.melhorenvio.com.br/reference/inserir-fretes-no-carrinho) distingue requisitos de NF-e e declaração de conteúdo e apresenta regras de documentos, transportadoras e volumes. Ela deve ser revisada na homologação; cotar um pacote não demonstra que a documentação necessária para uma venda comercial esteja pronta.

## Validação executada

`node --test tests/shipping-provider.test.cjs`: 11 testes com transporte simulado, sem requisições autenticadas reais. Cobrem ativação explícita, proteção do token, origem fixa, bloqueio de redirecionamentos, conversões, medidas/CEP/quantidade, valores personalizados, moeda inválida, resposta malformada, limite do corpo, timeout e correspondência dos IDs de tracking. A homologação com a conta do provedor continua pendente.
