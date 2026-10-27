# Logística BKM TCG

Auditoria e documentação atualizadas em **27/10/2026**. Esta etapa não comprou etiquetas, contratou serviços, adicionou créditos, ativou integração de produção ou inventou tarifas. Os testes usam banco temporário e transportes simulados.

## Comportamento implementado

- Retirada gratuita funciona independentemente da origem postal e dispensa consulta de CEP. Cidade/UF e WhatsApp da loja precisam estar cadastrados. O ponto de retirada pode ser combinado após o pagamento.
- Entrega local gratuita exige CEP confirmado de Uberlândia/MG (município IBGE `3170206`). Cidade/UF digitadas não substituem a verificação. Prazo local vazio significa combinar, sem promessa automática de dias.
- Envio nacional usa uma **tabela manual operacionalmente validada**, com transportadora, serviço, preço em centavos, prazo em dias úteis, data de conferência e ativação por macrorregião do IBGE. A loja precisa confirmar que o preço cobre todos os CEPs habilitados.
- A administração cadastra origem de postagem privada (CEP, rua, número, complemento, bairro, cidade e UF), perfis de embalagens reais (peso total em gramas e medidas externas em centímetros), embalagem padrão e cobertura geral/regional por faixas de CEP.
- Sem origem completa, embalagem padrão ativa ou tarifa comprovada para as regiões habilitadas, o servidor recusa ativar o nacional. Uma configuração antiga incompleta também não fornece preço nacional no checkout. Não existe preço/prazo alternativo presumido.
- Mudanças em origem, embalagem, preço, serviço, prazo ou cobertura exigem nova confirmação explícita das tarifas ativas. O editor informa a configuração faltante e limpa a confirmação quando esses dados mudam.
- A API pública remove endereço de postagem, perfis de embalagem, identificador da embalagem padrão e metadados internos de conferência. Esses dados permanecem na administração.

## Cobertura, valores e falhas

As faixas usam oito dígitos e limites inclusivos. São ordenadas e não podem se sobrepor dentro da mesma lista. Faixas gerais e regionais restringem o mesmo destino; nenhuma amplia a cobertura da outra. Sem faixas numa região, a tarifa se aplica a todos os CEPs daquela região, razão pela qual a confirmação operacional é necessária.

O total considerado no mínimo de frete grátis é o valor dos produtos **depois dos descontos**. A promoção não ativa uma região desativada, um CEP fora da cobertura ou uma configuração incompleta. Preço regional vazio não vira zero; zero precisa ser informado e validado explicitamente. Mudança de endereço ou configuração gera novo cálculo; o cache guarda apenas a identificação do CEP, nunca uma tarifa.

A identificação usa ViaCEP com conferência de CEP, UF, município e IBGE, timeout e cache limitado. CEP inexistente, endereço incompatível ou serviço indisponível falha com mensagem específica. Uma falha de consulta não vira entrega local nem frete grátis. Retirada continua funcionando sem essa API.

Os perfis de embalagem registram dados operacionais; não implementam empacotamento tridimensional nem garantem que qualquer quantidade de produtos cabe na embalagem padrão. Antes de abrir uma cobertura nacional, a loja deve definir embalagens e tarifas compatíveis com os pedidos que aceitará e conferir o volume final antes da postagem. Etiquetas e custos adicionais por divergência não são calculados pelo módulo manual.

## Dados mínimos que o proprietário precisa fornecer

1. **Origem real:** CEP, rua, número, complemento quando houver, bairro, cidade e UF. A origem de postagem pode diferir do endereço público de atendimento.
2. **Embalagens:** nome de cada perfil, peso total pronto para postagem, largura/altura/comprimento externos, embalagem padrão e limites operacionais de uso por pedido. Meça e pese um pacote real com cartas e proteções.
3. **Transportadora e modalidade:** prestador/serviço utilizado, acesso autorizado, eventual contrato, agência ou ponto de postagem e documentação exigida pela transportadora.
4. **Destinos:** regiões ou faixas reais de CEP atendidas, preço final a cobrar e prazo operacional em dias úteis. Se cobrar tabela fixa, inclua apenas destinos para os quais ela foi efetivamente conferida e indique a data dessa conferência.
5. **Frete grátis:** mínimo desejado, capacidade de absorver o custo nos destinos habilitados e eventuais restrições de cobertura. O padrão de mínimo de R$ 150 pode ser alterado pelo administrador.
6. **Operação local:** cidade/UF, WhatsApp, ponto/horário combinado de retirada e disponibilidade real da entrega em Uberlândia.

Não há cálculo responsável de uma tarifa universal por macrorregião sem CEP de origem/destino, peso, medidas e serviço. Nenhum preço estimado para Norte/Nordeste/Centro-Oeste/Sudeste/Sul foi incorporado à produção nesta etapa.

## Melhor Envio: viabilidade e limites reais

A documentação oficial oferece cotação e rastreio autenticados. Sandbox e produção têm contas e credenciais separadas; etiquetas de sandbox não servem para postagem. O acesso pede Bearer Token e User-Agent com aplicação e contato técnico. Serviços/transportadoras e agência de postagem dependem da conta operacional. A escolha é tecnicamente viável, mas precisa de configuração e homologação reais. [FAQ oficial](https://docs.melhorenvio.com.br/reference/faq).

A página comercial apresenta plano Free de R$ 0/mês e planos pagos opcionais. Isso não elimina o preço de cada envio, seguro, taxas ou eventuais ajustes por medidas divergentes. Nenhuma assinatura foi criada. Condições comerciais devem ser reconfirmadas no cadastro do titular. [Planos oficiais](https://lp.melhorenvio.com.br/assinaturas/).

O código atual implementa **somente consulta autenticada no sandbox**. A instância de `server/shipping-provider.cjs` expõe `readiness()`, `quote()` e `tracking()`. O status declara `productionSupported:false`, `checkoutIntegrated:false` e `purchasesEnabled:false`. Não há compra, carrinho do provedor, emissão, cancelamento ou pagamento de etiquetas. O checkout comercial utiliza a tabela manual validada da BKM, e não este adaptador.

Na auditoria local de `.env`, `.env.local` e `.env.sandbox`, não estavam configurados os seis campos de ativação/credencial abaixo. Somente presença/ausência foi verificada; segredos não foram impressos. Este levantamento não substitui uma auditoria de variáveis remotas da hospedagem.

```dotenv
SHIPPING_PROVIDER=melhorenvio
MELHOR_ENVIO_ENABLED=true
MELHOR_ENVIO_ENVIRONMENT=sandbox
MELHOR_ENVIO_TOKEN=
MELHOR_ENVIO_ORIGIN_ZIP=
MELHOR_ENVIO_USER_AGENT=
```

Obtenha credenciais autorizadas do sandbox pelo titular e guarde-as somente no ambiente privado. Uma variável que informe `production` não habilita o adaptador; ele permanece bloqueado. Um token real não deve ser enviado ao sandbox, nem credencial de sandbox ao ambiente real.

## Contrato de consulta preparado para homologação

`quote({zip,items,services})` aceita produtos com identificador, quantidade, preço unitário em centavos, peso em gramas e medidas em centímetros. Alternativamente, `quote({zip,volumes,services})` recebe de 1 a 20 volumes já embalados com peso total, dimensões externas e valor segurado total em centavos. Os formatos não podem ser misturados. O servidor converte gramas para kg e centavos para BRL. A API oficial diferencia produtos unitários de volumes prontos e orienta usar `custom_price` / `custom_delivery_time` para refletir configurações da conta. [Cotação oficial](https://docs.melhorenvio.com.br/reference/calculo-de-fretes-por-produtos).

O destino do adaptador é fixo em `https://sandbox.melhorenvio.com.br`, limitado a `/api/v2/me/shipment/calculate` e `/api/v2/me/shipment/tracking`. Redirects são recusados; timeout abrange requisição e leitura; JSON tem limite de 1 MB. Respostas inválidas, moeda diferente de BRL, preços com precisão incorreta, prazos ausentes e serviços inesperados são rejeitados. A falta de opção válida retorna ausência de opções, sem inventar serviço substituto.

Cotação retorna preço/prazo/fonte/data, `sandbox:true` e `contracted:false`. `tracking({orderIds})` consulta UUIDs de etiquetas existentes e preserva o status recebido; um status da etiqueta não altera automaticamente o pedido para enviado/entregue. O rastreio real e a compra de etiquetas continuam fora desta integração.

## O que falta para automatizar o frete nacional real

1. Fornecer os dados operacionais listados acima e escolher a conta/serviços autorizados.
2. Homologar no sandbox autenticação, produtos/volumes, serviços, opções indisponíveis, reajustes, erros, rastreio e documentos exigidos.
3. Implementar e homologar separadamente o ambiente de produção com credencial própria, cotações obtidas de produtos/embalagens do banco, validade da oferta e recálculo no servidor antes de confirmar o pedido.
4. Persistir serviço, preço, prazo, volume e identificação da cotação por pedido. Definir tratamento de mudança de endereço, divergência de medidas, seguro e falha do provedor.
5. Se desejado, implementar compra de etiquetas com autorização explícita, controle financeiro, idempotência e auditoria. Cotação e rastreio disponíveis não provam que uma etiqueta pode ser comprada/postada.

## Testes executados nesta etapa

`node --require ./scripts/test-network.cjs --test tests/shipping-policy.test.cjs tests/shipping-provider.test.cjs tests/shipping-admin.test.cjs`

**28 testes aprovados**, com rede externa bloqueada: cinco regiões, descontos antes do mínimo grátis, CEP/UF/IBGE autoritativos, retirada offline, entrega local, prazo local não prometido, alteração de destino, cache, falhas da API, CEPs inclusivos/sobrepostos/fora de cobertura, origem/embalagem/data/serviço inválidos, reconfirmação operacional, DTO/API públicos sem dados privados, gravação/leitura na API com SQLite isolado, fixture de homologação financeira por retirada sem tarifa nacional fictícia, parsers do painel, produtos/volumes sandbox, valores personalizados, moeda/resposta inválida, HTTP 401/403/422/429/503, redirects, limite de corpo, timeout e rastreio.

Esses testes não contratam frete nem validam uma tarifa comercial. A operação nacional permanece dependente dos dados e da conferência do proprietário.
