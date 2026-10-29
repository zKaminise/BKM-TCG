# Logística BKM TCG

Revisão de **29/10/2026**. A loja mantém retirada e entrega local habilitadas e envio nacional desligado até a conferência operacional. O acesso Melhor Envio de produção foi validado em consultas reais, sem comprar etiquetas. O código possui três modos de frete; não existe tarifa nacional presumida.

## Configuração no painel

Em `/admin/configuracoes`, a administração escolhe:

- **Melhor Envio:** consulta os serviços disponíveis para origem, destino, valor segurado e volumes calculados. O cliente escolhe a opção, e o servidor confere novamente antes de criar o pedido.
- **Tabela por perfil/estado:** a base do estado substitui a regional; estados sem valor próprio herdam sua região. Bloquear um estado impede a herança. Cada volume custa base do destino + acréscimo do perfil; o pedido soma todos os volumes.
- **Tabela regional anterior:** mantém o comportamento dos cadastros legados, com embalagem padrão e preço/prazo operacionalmente confirmados.

O CEP de origem preenche rua, bairro, cidade e UF via consulta limitada ao ViaCEP. Número e complemento são preservados e informados pela loja. Campos ausentes no CEP continuam editáveis, com aviso. Consultas antigas e respostas após sair da página são descartadas. O endereço de origem e os perfis permanecem privados da administração.

Perfis são configurados uma vez, com peso total embalado, medidas externas, capacidade, tipos atendidos e ativação. Não é necessário pesar ou preencher cada anúncio. Um perfil específico de ETB prevalece sobre um perfil genérico de selados. A quantidade dividida pela capacidade, arredondada para cima, determina o número de volumes. Carrinhos mistos somam perfis diferentes; acima de 20 volumes, ou sem perfil compatível, o envio fica indisponível. Isto é um agrupador por capacidade, não um empacotador tridimensional.

## Simulador, checkout e benefício

O simulador na página do produto usa a versão e quantidade escolhidas, mesmo com carrinho vazio. O carrinho calcula o conjunto de itens. Troca de versão/quantidade/CEP invalida o resultado. As opções mostram transportadora, modalidade, preço e prazo recebido, sem prazo alternativo inventado.

O checkout envia apenas o identificador do serviço escolhido. Preço, classificação dos produtos, quantidades e embalagem vêm do banco no servidor; valores, pesos ou tipos forjados pelo cliente são ignorados. O pedido guarda a opção, transportadora, prazo, benefício e resumo de volumes. A opção integra a chave idempotente do pedido. CEP, cupom e modalidade invalidam a cotação na interface; serviço que deixou de existir exige nova escolha. Cotações idênticas possuem cache de dois minutos e requisições concorrentes compartilhadas; alterações nos volumes/destino/valor segurado mudam a chave.

O mínimo de frete grátis usa o valor dos produtos **após descontos**. Na cotação automática o benefício cobre a opção mais econômica; serviços superiores cobram somente a diferença mostrada. Na tabela própria, o frete do serviço configurado fica grátis. A promoção não amplia cobertura nem ativa um destino indisponível. O valor atual de **R$ 150** foi preservado e pode ser alterado, inclusive para R$ 200, pelo administrador.

Retirada gratuita independe de CEP e embalagem nacional. Entrega gratuita em Uberlândia exige CEP confirmado da cidade (IBGE 3170206); texto livre de cidade/UF não substitui a verificação. Prazo local vazio significa combinar pelo WhatsApp depois do pagamento. Falha na consulta de endereço não se transforma em entrega local.

## Melhor Envio: configuração e limites

A credencial pessoal foi criada pelo titular com permissões **shipping-calculate** e **shipping-tracking**, guardada apenas no ambiente privado/Vercel Production. A validade informada pelo painel é 29/10/2027. Não estão autorizadas compra, emissão, pagamento ou cancelamento de etiquetas pelo código.

Produção usa `https://melhorenvio.com.br`, sandbox usa `https://sandbox.melhorenvio.com.br`. O ambiente é explícito, sem inferência pelo formato da chave. O checkout de produção rejeita sandbox. A origem usada pelo adaptador vem da configuração administrativa atual, substituindo eventual variável antiga de CEP.

```dotenv
SHIPPING_PROVIDER=melhorenvio
MELHOR_ENVIO_ENABLED=true
MELHOR_ENVIO_ENVIRONMENT=production
MELHOR_ENVIO_TOKEN=
MELHOR_ENVIO_USER_AGENT=Nome da aplicação (contato@dominio.com.br)
MELHOR_ENVIO_ORIGIN_ZIP=
# Opcional: limitar IDs de serviços, separados por vírgula.
MELHOR_ENVIO_SERVICES=
```

O adaptador possui `quote({zip,volumes,services})` e `tracking({orderIds})`; também preserva a cotação por produtos unitários para consumidores internos. Volumes usam `insurance`, e produtos unitários `insurance_value`, conforme o contrato oficial. Gramas são convertidos para kg; centavos para BRL. Retornos usam `custom_price` e `custom_delivery_time`. Redirecionamentos são recusados, timeout inclui leitura, JSON tem limite de 1 MB e respostas inválidas não viram ofertas. Erros em pacotes de um serviço impedem sua oferta. Falhas do provedor não ativam tabela alternativa inventada.

O acesso gratuito à API não elimina o custo da postagem, seguro, adicionais ou divergência de peso/medidas. Não foi contratado plano nem comprado crédito. J&T e qualquer outra transportadora só aparecem se retornarem para aquela conta, rota e embalagem; não há garantia de disponibilização universal. A permissão de rastreio consulta IDs de etiquetas existentes; não cria etiqueta nem marca pedido como entregue automaticamente. O administrador mantém o registro do código e a comunicação ao cliente.

## Estado operacional e embalagens sugeridas

O proprietário informou o CEP de origem **38408-136**, confirmado em Uberlândia/MG. Rua/bairro/cidade/UF foram preenchidos privadamente; falta informar o número da origem. Dois perfis foram preparados como **rascunhos não confirmados**:

| Uso proposto | Medidas externas L × A × C | Peso usado somente na simulação | Capacidade proposta |
|---|---|---|---|
| Cartas protegidas | 15 × 4 × 20 cm | 300 g | Até 20 cartas, sujeito ao teste de encaixe com proteções |
| Uma ETB/booster box padrão | 25 × 15 × 30 cm | 2.000 g | Uma unidade que efetivamente caiba com proteção |

São propostas de compra de caixas retangulares, não medições de mercadoria existente. Confira **medidas externas**, espaço interno e proteção antes de comprar um lote. Uma box de coleção maior, playmat, lote ou item fora desses limites precisa de perfil próprio. Não confirme peso/capacidade sem pesar um pacote completo. Os pesos simulados não provam que a operação está pronta, portanto o nacional permanece desligado e `packingProfilesValidated=false`.

A caixa pequena respeita a faixa dimensional publicada para Mini Envios (máximo 4 × 16 × 24 cm e 300 g), mas elegibilidade depende também de valor segurado, rota e retorno do serviço. Mini Envios tem rastreio parcial; não o apresente como rastreio de todas as etapas. A caixa maior não atende Mini Envios. [Regras oficiais de Mini Envios](https://centraldeajuda.melhorenvio.com.br/hc/pt-br/articles/31220431326356-Como-funciona-a-modalidade-Mini-Envios-dos-Correios), [limites por transportadora](https://centraldeajuda.melhorenvio.com.br/hc/pt-br/articles/31220431416852-Qual-formato-e-tamanho-o-meu-volume-pode-ter).

Foram executadas quatro cotações **reais na API de produção**, saindo do CEP informado para CEPs públicos de São Paulo e Recife, com os dois pacotes simulados. Houve opções de Correios, Jadlog, Loggi e outras transportadoras; isso valida a conexão e o contrato técnico, não o peso físico nem um prazo universal por estado. Nenhum desses preços foi cadastrado como tarifa fixa.

## Para liberar o envio nacional

1. Informar o número da origem (e complemento se necessário).
2. Comprar/testar as embalagens e conferir peso total, medidas externas e capacidade com os itens e proteções reais. Ajustar perfis para produtos que não caibam.
3. Conferir serviços disponíveis e local de postagem da transportadora escolhida, documentação e rotina de compra de etiquetas no painel Melhor Envio.
4. Confirmar os perfis e data no painel, ativar nacional, cotar os produtos reais e conferir o primeiro envio. A seleção do cliente não compra postagem automaticamente.
5. Se optar por tabela própria, fornecer e confirmar preços/prazos por UF/região e cobertura. A integração automática dispensa essa tabela.

## Testes

Suíte completa desta entrega: **443 testes aprovados**, incluindo SQLite/PostgreSQL, regras por estado/região e fronteiras de CEP, retirada/local, descontos e limiar, capacidades e carrinho misto, campos do cliente forjados, concorrência/cache, serviço selecionado/persistência/idempotência, falha/timeout/resposta inválida, sandbox em produção, CEP automático e respostas antigas, interface de opções e sucesso de cadastro. Há testes de navegador isolados; a compra comercial de R$ 10 continua sendo uma operação real do titular/comprador.

Fontes técnicas: [introdução/API](https://docs.melhorenvio.com.br/reference/introducao-api-melhor-envio), [cotação](https://docs.melhorenvio.com.br/reference/calculo-de-fretes-por-produtos), [sandbox](https://docs.melhorenvio.com.br/docs/sandbox), [autenticação](https://docs.melhorenvio.com.br/docs/autenticacao).
