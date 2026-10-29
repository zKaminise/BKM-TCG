# MYP Cards e correção da busca — 29/10/2026

## Estado real da entrega

A busca por nome foi corrigida: `Pikachu` retorna cartas cujo nome corresponde à consulta, sem incluir Bulbasaur ou Ludicolo apenas por pertencerem a Detetive Pikachu. Uma expansão continua acessível por nome completo/alias, código oficial, família exata ou seletor. Respostas de filtro de sigla também são verificadas: se a fonte ignorar o filtro, não se aceita automaticamente o índice inteiro. No máximo oito candidatos podem exigir confirmação de detalhe; respostas maiores não provocam consultas em massa.

A integração brasileira está implementada no backend, na coleção e na interface, com testes usando respostas simuladas. **A primeira chamada externa oficial neste ambiente retornou HTTP 403 com a proteção Cloudflare, não JSON.** O proprietário informou que ainda não possui acesso aprovado à API. Nenhum bloqueio foi contornado e não houve scraping. Não se afirma homologação de preços brasileiros reais a partir desse teste; sem acesso ou correspondência, a loja mantém a referência internacional ou informa ausência de referência.

Fontes oficiais consultadas: [documentação](https://mypcards.github.io/mypcards-api/), [Swagger atualizado](https://github.com/MYPCards/mypcards-api/blob/main/swagger.yaml) e [solicitação de acesso](https://mypcards.com/acesso-api).

## Identificação e valores

- O catálogo canônico continua sendo TCGdex. A MYP não substitui imagens, identidade, estoque comercial ou preço de venda.
- A descoberta usa `/pokemon/carta/{nome}` com o nome exato codificado no caminho. Nome PT/EN, edição por nome/código verificável e número impresso precisam corresponder; total impresso divergente, candidatos conflitantes ou mais de um produto compatível não geram escolha automática.
- O mapeamento do identificador TCGdex/idioma para `internal_code` e `card_code` da MYP é persistido junto da referência. Atualizações usam `/produto/{id}` e conferem novamente os metadados. Existe helper testado de Base64 para código MYP; IDs TCGdex não são tratados como códigos MYP.
- `min_price` é o menor preço anunciado. `avg_price` é a média ponderada pela quantidade anunciada. Os valores não são vendas concluídas nem preços NM presumidos. Ausência de anúncios/preço é `null`, não zero.
- PT/EN podem receber a referência brasileira agregada da impressão. JP, idioma físico diferente da referência, atributos especiais ou acabamento sem correspondência não recebem avaliação PT/EN indevida.
- Somente uma média atual compatível pode compor a estimativa em BRL. A origem continua `mypcards`, `match=PRINTING_EXACT`, `aggregate=true`, `conditionAdjusted=false`; isso identifica a impressão e **não** certifica a conservação ou o acabamento da unidade física.
- O custo pago não é alterado. Valores pessoais manuais conservam prioridade, inclusive a decisão de não substituir silenciosamente um valor particular vencido. Referências administrativas exatas atuais também são preservadas.

As telas mostram menor/média, fonte visível com link MYP Cards, link do produto e **Consultado em**. O endpoint de anúncios não fornece data de atualização da estatística; não foi inventada uma data de origem. Quando há BRL e referência internacional, a internacional fica acessível separadamente. EUR/USD não são convertidos nem somados ao total em reais.

## Persistência e limites

Não foi necessária migração. Reutiliza-se `personal_reference_cache`, com acesso somente pelo servidor e RLS existente:

| Tipo | Conteúdo |
|---|---|
| `myp-price` | Identidade canônica, produto MYP, mínimo/média em centavos, moeda, URL, metadados de correspondência, estado e datas |
| `myp-api` | Respostas normalizadas de nomes/produtos, compartilhadas entre impressões |
| `myp-rate` | Contadores por rota, saldo informado pelo provedor e bloqueios temporários |
| `myp-lease` | Reserva temporária de consulta para evitar trabalho duplicado entre instâncias |

Chave de preço: `myp:price:v1:{idioma}|{cardId}`. Preços têm cache de 24 horas; resultados sem correspondência, até seis horas. Falhas temporárias usam espera de cinco minutos ou o prazo aplicável de `Retry-After`. Um último preço conhecido conserva sua data original e fica marcado como desatualizado, fora da estimativa atual. A data de repetição de uma chamada não renova artificialmente a idade do preço.

Há deduplicação em memória e leases persistentes, contadores transacionais PostgreSQL/SQLite, timeout de 4,5 segundos, limite de resposta, validação de JSON/identidade e tratamento de 429/403/indisponibilidade. O limite local acompanha 10/minuto sem token ou 60/minuto com token e respeita os cabeçalhos de saldo/limite da fonte. Isso não garante capacidade de terceiros que compartilhem o IP de saída da hospedagem.

Cada requisição da coleção pode atualizar no máximo duas identidades externas. Um resultado de nome compartilhado pode resolver outras impressões sem novas chamadas HTTP. Estatísticas, filtros, ordenação, grupos, fichários e exportação usam o cache em lote; não disparam uma consulta externa para cada exemplar da conta. Não há novo cron, importação em massa do catálogo MYP ou serviço pago.

## Configuração e acesso externo

```dotenv
# Opcional; true é o comportamento padrão.
MYP_CARDS_ENABLED=true
# Opcional, privado, somente no servidor.
MYP_CARDS_API_TOKEN=
```

Segundo o Swagger consultado, nenhum endpoint exige token; ele aumenta o limite. O token inválido equivale a ausência de token. Para obter uma chave própria, é necessário solicitar aprovação no painel oficial e gerá-la após a aprovação. O token não deve ser enviado pela conversa, incluído no código ou exposto em variável de frontend.

O 403 observado é uma limitação de acesso real e não uma resposta de carta sem preço. Solicite ao MYP a liberação do uso da API pela BKM. Se uma chave for fornecida, configure `MYP_CARDS_API_TOKEN` como segredo de Production na Vercel e redeploye; depois confira uma resposta JSON legítima. Uma chave, por si só, não foi prometida como solução para o bloqueio de rede. `MYP_CARDS_ENABLED=false` permite suspender chamadas externas e manter cache/fallback.

## Arquivos e integração

- `server/mypcards-market.cjs`: transporte oficial, validação, correspondência, cache, limites, leases e seleção da referência aplicável.
- `server/collection-catalog.cjs`: correção de intenção de busca e confirmação defensiva da sigla.
- `server/personal-collection.cjs`: provider compartilhado e integração com catálogo, fichários, checklist, resumo e CSV.
- `server/personal-inventory.cjs`: DTO, prioridade manual, estimativa agregada, totais, filtros, ordenação e agrupamento com a mesma política SQL.
- `server/api.cjs`: encaminhamento de ambiente e transporte injetável de testes.
- `collection-domain.js`, `collection-ui.js`, `collection.css`: apresentação BRL, datas de consulta, fallback, fila e avisos de cobertura/agregação.
- `.env.example` e `scripts/test-env.cjs`: configuração documentada e chamadas externas desabilitadas por padrão na suíte.
- Testes de catálogo, `mypcards-market.test.cjs`, `myp-collection-integration.test.cjs` e `collection-brazilian-ui.test.cjs`.

Autenticação, carrinho, checkout, pedidos, pagamentos, favoritos e valores comerciais não foram modificados por esta integração.

## Testes e como conferir

**530 testes aprovados** na suíte completa, incluindo SQLite e PostgreSQL/PGlite. Cobrem PT/EN/JP, nomes iguais em edições/números distintos, ambiguidade, preços nulos, ausência, 403/HTML, timeout, 429/Retry-After, cache novo/vencido, consultas concorrentes, saldo de API, falta/token inválido, prioridades manuais, preservação do custo, fallback e totais parciais. Sintaxe e build são verificados pelos comandos do projeto; não há TypeScript ou linter adicional configurado.

No navegador com SQLite privado e MYP simulada: busca automática `Pikachu` retornou somente duas impressões de Pikachu; foi possível adicionar duas cópias, informar custos de R$ 5 e R$ 7, alterar uma para JP, revisar e salvar. Após recarregar, o custo conhecido permaneceu R$ 12; somente a cópia PT recebeu a média sintética de R$ 25 e o total foi identificado como parcial, com um exemplar sem avaliação. Esses números são **fixtures de teste, não preços reais da MYP**. Nenhum exemplar sintético foi inserido na conta comercial.

Para validar localmente: `npm run check`, `npm test` e `npm run build`. Testes usam mocks e não consomem a API. Para conferir na Vercel, abra `/conta/colecao/adicionar`, pesquise um nome, confirme a impressão e veja fonte/moeda/data. Sem acesso brasileiro, deve haver fallback internacional ou ausência honesta. Com acesso liberado, confira um produto exato na MYP e a referência recebida; repita a consulta para verificar reutilização do cache. Não confunda aprovação de mocks com homologação externa do provedor.
