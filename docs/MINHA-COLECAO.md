# Minha Coleção — implementação e validação

Revisão de **27/10/2026**. O módulo foi integrado ao projeto existente, sem trocar o framework ou criar outro inventário pessoal. O catálogo e o estoque comercial continuam independentes da coleção particular.

## O que foi implementado

### Cadastro completo

Em `/conta/colecao`, **Adicionar cartas** abre `/conta/colecao/adicionar`:

1. Escolher **Carta**, **Selado** ou **Personalizado**.
2. Pesquisar cartas reais por nome, número, nome+número, expansão, código ou ID; ver foto, nome, expansão, número impresso, raridade e idioma de referência. Resultados ambíguos são apresentados separadamente; o usuário pode restringir a coleção.
3. Adicionar várias cartas à mesma fila, inclusive cópias iguais. Selados e personalizados podem entrar na mesma fila. Cada exemplar tem identidade e dados próprios.
4. Preencher detalhes individualmente: tipo, idioma físico, conservação, acabamento, atributos separados, custo opcional, data, observações e foto por URL HTTPS. Nenhuma condição de carta é selecionada silenciosamente no novo wizard.
5. Aplicar aquisição aos restantes com confirmação, preservando campos já preenchidos salvo autorização explícita de sobrescrita; revisar ou desfazer a cópia. Identidade, foto e raridade não são copiadas de uma carta para outra.
6. Revisar unidades, aquisição conhecida e ausências; salvar um lote transacional com chave idempotente. O rascunho só é limpo após confirmação do sucesso.

A fila fica ao lado no desktop e em drawer no celular, com contador, remoção, repetição e acesso direto ao exemplar. O drawer tem fechamento explícito e Escape. Rascunhos e preferências visuais ficam no armazenamento local com chave do usuário; rascunhos expiram após sete dias. Eles não são uma vitrine pública nem sincronização de rascunho entre dispositivos.

O frontend limita a fila a 100 exemplares; o servidor aceita até 200 por envio e 10.000 registros pessoais por conta. A resolução das referências do lote usa no máximo quatro consultas simultâneas e um orçamento comum de tempo, fora da transação de inventário. Erro de validação não grava parte do lote.

### Organização e histórico

- **Grade**, **Grade compacta**, **Lista** e **Lista detalhada**, com preferência por usuário.
- Busca particular e filtros combináveis de coleção, tipo, idioma, conservação, raridade, acabamento, situação, custo, presença/validade da cotação, data e faixas financeiras; chips e limpeza de filtros.
- Ordenação por nome, código numérico, Pokédex, set, raridade, aquisição, custo, referência e inclusão recente; valores desconhecidos ficam depois dos conhecidos.
- Agrupamento por set, Pokémon/Pokédex, raridade, ilustrador ou situação, com quantidade e valor coberto. Itens manuais sem coleção não recebem indevidamente a linha de outro selado manual.
- Paginação, filtros, ordenação, estatísticas e totais dos grupos no servidor. Abrir uma página não consulta uma fonte de preços para cada exemplar.
- Detalhe com imagem ampliável, identidade, aquisição, fonte/data da referência, atributos, observações e movimentações.
- Edição, duplicação de exemplar, registro privado de venda/troca/doação/saída, arquivamento, restauração e exclusão com confirmação forte.
- Ações em massa de custo, data, venda e arquivo/restauração. Alterar somente a data não apaga o custo; “Não informar” e “Zerar” são ações distintas.
- Valores de lote podem ser distribuídos entre exemplares, conservando cada centavo. Um total de R$ 100 não vira R$ 100 por carta sem escolha explícita.
- Desfazer ação com proteção de revisão: uma alteração posterior impede restaurar um estado antigo por cima dos novos dados.

Os estados são **Em coleção**, **Vendido/saída registrada** e **Arquivado**; o domínio também conserva a marcação privada `FOR_SALE`. Venda na coleção não cria anúncio, pedido, cobrança ou alteração do estoque da loja. Venda parcial de um lote antigo preserva as demais unidades e o custo histórico das unidades que saíram.

Fichários, objetivos, faltantes, desejos e CSV existentes foram preservados. As entradas de adição pelo produto ou pelo fichário também passam pelo inventário auditado e idempotente. Avaliação por set, checklist, exportação e dashboard usam a mesma política de referência por exemplar.

## Valores e fonte dos preços

Dinheiro é armazenado como **centavos inteiros em BRL**; datas de aquisição são `YYYY-MM-DD`, sem conversão para meia-noite UTC. A interface aceita `150`, `150,50` e `1.234,56` e rejeita negativos e formatos inválidos.

| Indicador | Regra |
|---|---|
| Quantidade ativa | Soma das unidades ainda possuídas; cópias contam separadamente |
| Custo conhecido | Soma de custo unitário × quantidade, excluindo apenas custo `null` |
| Estimativa | Soma das referências válidas e compatíveis × quantidade, com cobertura explícita |
| Variação não realizada | Diferença somente dos mesmos exemplares que têm custo e referência válidos |
| Percentual | Divide pelo custo dos exemplares comparáveis; denominador zero aparece como não aplicável |
| Resultado realizado | Valor de saída menos custo histórico, apenas quando ambos são conhecidos |

`null` não é zero: uma carta sem custo aparece **Não informado**; custo zero aparece **Gratuito / R$ 0,00**. Sem referência utilizável aparece **Sem cotação**. Vender ou arquivar tira o exemplar do acervo ativo e preserva o histórico. Troca/doação sem valor não gera venda fictícia de zero.

**Não há cotação automática brasileira integrada.** Não foi fornecida/configurada uma API licenciada da Liga Pokémon ou outro provedor BRL com correspondência suficiente. A página oficial da Liga retornou 403 na consulta; o bloqueio não foi contornado. Isso não impede cadastrar, organizar ou registrar custos e saídas.

As referências disponíveis são:

- **Informado por você:** valor particular em BRL por exemplar, com identidade, idioma, condição, acabamento, atributos e data. É uma estimativa pessoal, não preço oficial da Liga. A alteração de características invalida a referência anterior; uma atualização automática não a substitui silenciosamente.
- **Referências manuais autorizadas do painel:** fonte, URL, BRL, data e declaração de autorização, para combinação exata de carta/set/idioma/condição/acabamento. O conjunto global não foi preenchido com dados inventados.
- Referências pessoais antigas por identidade continuam privadas e compatíveis com as novas telas.

A validade padrão é **sete dias**, configurável nas preferências entre 1 e 365. Valores antigos são identificados e excluídos da estimativa utilizável. Não há polling de preços, cron de cotação ou data de atualização automática prometida sem provedor. Cada referência mostra sua própria data; a data deste relatório não é a data de cotação de todas as cartas.

Os feeds internacionais documentados pela TCGdex são **Cardmarket/EUR/Europa** e **TCGplayer/USD/América do Norte**, com cobertura e precisão variáveis. Eles **não são somados ao patrimônio em BRL, convertidos implicitamente ou chamados de preço brasileiro**. Não foi configurado câmbio. Fontes: [mercados TCGdex](https://tcgdex.dev/markets-prices), [limites de correspondência informados pela fonte](https://tcgdex.dev/faq), [Liga Pokémon](https://www.ligapokemon.com.br/).

## Catálogo e imagens reais

O adapter consulta `https://api.tcgdex.net/v2`, com cache compartilhado de metadados canônicos. Sets/índices têm TTL diário; detalhes, sete dias. Há deduplicação, prazo de operação, repetição limitada em falha transitória e uso identificado de cache antigo na indisponibilidade. Não são usados resultados fixos para os exemplos do teste.

São normalizados provedor/ID, set/código/série, número local e impresso, nome, raridade, ilustrador, Pokédex, imagens e variantes disponíveis. Pocket é excluído da busca de cartas físicas. A cobertura por idioma/edição varia: se a imagem vier de outra língua, essa origem é indicada; escolher um idioma físico manualmente não fabrica uma impressão nem reaproveita cotação incompatível. Acabamento não confirmado fica marcado como informado pelo usuário.

Selados catalogados usam metadados publicados da BKM, nunca o saldo ou preço da loja como avaliação particular. Sem cadastro há entrada manual. Um selado já registrado continua editável se o anúncio comercial for arquivado, porque sua identidade pessoal tem snapshot. Não existe catálogo externo licenciado de selados conectado.

Imagens personalizadas usam **URL HTTPS pública validada**, com fallback. Credenciais na URL, endereços privados e protocolos ativos são rejeitados; o servidor não faz fetch arbitrário da foto. Upload privado de arquivo e vitrine pública de coleção não foram acrescentados. O cadastro por URL é a alternativa implementada prevista na especificação.

Consulta e resultados reais completos: [COLECAO-CATALOGO.md](COLECAO-CATALOGO.md).

## Arquivos, rotas e banco

| Arquivo | Responsabilidade |
|---|---|
| `collection-ui.js` | Dashboard, wizard, fila, modais, filtros, ações e histórico |
| `collection-domain.js` | Dinheiro, cópia de aquisição, payloads, rascunho e alterações explícitas de custo |
| `collection.css` | Visual BKM, quatro modos e responsividade |
| `personal-ui.js`, `store.css` | Integração à conta e preservação das áreas existentes |
| `server/collection-catalog.cjs` | Adapter, identidade e busca TCGdex; metadados de selados |
| `server/personal-inventory.cjs` | Validação, domínio financeiro, transações, consultas e auditoria |
| `server/personal-collection.cjs` | Compatibilidade com fichários, desejos, CSV e avaliação antiga |
| `server/api.cjs` | Encaminhamento autenticado e corpo JSON da exclusão confirmada |
| `server/migrations/009_personal_inventory.sql`, `server/db.cjs` | Migração PostgreSQL/SQLite |
| `serve.cjs`, `scripts/build-web.cjs` | Entrega e empacotamento dos módulos públicos |

Endpoints autenticados sob `/api/account/collection`:

- `GET /catalog/search`, `GET /catalog/sealed` e detalhe de carta.
- `GET /inventory`, `POST /inventory/batch`.
- `GET/PUT/DELETE /inventory/:id`.
- `POST /inventory/bulk`, incluindo desfazer.
- `GET /inventory/events`.
- Rotas anteriores de sets, checklist, preços, desejos, preferências e CSV mantidas.

A migration **009** acrescenta campos em **`personal_lots`** e cria **`personal_inventory_operations`** e **`personal_item_events`**. Não cria uma tabela de coleção concorrente nem altera produtos, estoque ou pedidos. Novas unidades ficam individualizadas; lotes antigos conservam suas quantidades até uma operação que precise separá-las.

RLS está habilitado. A autenticação da BKM usa sessões próprias, não acesso direto do navegador via Supabase Auth: `anon`, `authenticated` e `PUBLIC` não recebem grants nas tabelas privadas. O servidor obtém o dono da sessão, filtra todas as ações por proprietário, valida IDs/campos/limites e aplica bloqueio de dono, revisão e idempotência nas transações. Um administrador não ganha acesso à coleção de outro cliente pelo endpoint pessoal.

No banco principal, a aplicação da 009 preservou integralmente os campos originais dos **5 lotes/9 exemplares**, **2 fichários**, usuários e cadastros comerciais, comparados por digest antes/depois. O banco passou de 41 para **43 tabelas**, todas com RLS, sem grants diretos de navegador nas tabelas pessoais. Houve backup criptografado antes da migração e restauração isolada do backup com `integrity=ok` e os dois objetos de Storage. Nenhuma senha ou chave foi alterada por este módulo.

Nenhuma nova credencial é obrigatória no `.env.example`: a TCGdex usada não exige chave; o banco/contas utilizam a configuração existente. Uma futura fonte BRL dependerá de autorização e integração real, com segredos apenas no servidor.

## Como reproduzir

1. Entrar na conta e abrir **Minha Coleção → Adicionar cartas → Carta**.
2. Buscar `166/165`; conferir **Bulbasaur, 151, Ilustração Rara**. Adicionar. Buscar `170/165`; conferir **Squirtle, 151, Ilustração Rara**. Adicionar sem sair da busca.
3. Abrir detalhes, escolher conservação e registrar R$ 100 para a primeira e R$ 150 para a segunda; conferir idiomas/datas. Revisar: duas unidades, R$ 250 de aquisição conhecida e nenhuma cotação inventada.
4. Recarregar o rascunho; salvar. Recarregar a coleção ou sair/entrar: as duas cartas devem permanecer.
5. Filtrar 151, alternar os quatro modos, ordenar por código/custo/valor e agrupar por set/raridade/ilustrador/Pokédex.
6. Selecionar a carta de custo R$ 100, registrar saída por venda de R$ 150: resultado realizado R$ 50. Consultar Vendidos e desfazer/restaurar. Arquivar outra carta e restaurar pelo filtro Arquivados.
7. Adicionar uma cópia sem custo e outra com zero, selado manual e personalizado com URL de foto. Conferir unidades, ausências e custo conhecido. Só um valor manual explicitamente informado deve aparecer como referência pessoal.

Esses registros de saída são particulares; não cobram comprador nem movimentam o Mercado Pago.

## Validação executada

- Testes automatizados incluem os 15 critérios da especificação por suas regras de domínio, catálogo, HTTP, UI e regressão: dois motores, lote/idempotência/concorrência, custo nulo/zero, duplicatas/venda parcial, distribuição de centavos, fontes/TTL/identidade, arquivo/restauração/desfazer, isolamento inclusive por IDs adulterados, datas, URLs e regressões comerciais.
- Consultas reais TCGdex: `166/165`, `170/165`, `33/181`, `Charmander 168`, `Charizard 199/165`, aliases de 151 e colisões reais `25/102` e `1/100`; imagens correspondentes responderam HTTP 200.
- Navegador com banco local isolado e API real do catálogo: fila de Bulbasaur/Squirtle, custos individuais R$ 100/R$ 150, cópia revisável, recarga do rascunho, save, logout/login, quatro modos, filtros/grupos, venda com R$ 50 de lucro e desfazer, arquivo/restauração, lote misto, zero versus desconhecido, edição só da data preservando custos e referência manual com comparação parcial correta.
- Mobile **390×844**, sem overflow horizontal, com drawer e lote misto funcional. As fixtures de QA não foram cadastradas no estoque de produção, e nenhuma cobrança/e-mail externo foi realizado por esses testes.
- **API publicada + Supabase real do sandbox:** duas cartas, R$ 250 de custo conhecido, replay sem duplicatas, logout/login preservando os registros, venda com R$ 50 de resultado realizado e desfazer. Produtos, variantes e pedidos comerciais do sandbox permaneceram intactos; zero cobranças e zero e-mails externos criados. Essa prova é de coleção particular, não de pagamento comercial.
- **Domínio de produção:** dashboard novo carregado com os 9 exemplares anteriores, buscas reais de Bulbasaur/Squirtle e fila múltipla conferidas. A fila de conferência foi limpa sem salvar novas aquisições na conta anterior. Os três novos assets publicados corresponderam ao código entregue; acesso anônimo ao inventário retornou 401. Publicação funcional [5348326](https://github.com/zKaminise/BKM-TCG/commit/5348326e6f645aebadb912caea3f9c18513d8769), [CI aprovado](https://github.com/zKaminise/BKM-TCG/actions/runs/40532488041) e deploys principal/sandbox aprovados.
- Backup após a atualização: **43 tabelas, 223 registros e 2 objetos**, criptografado e restaurado isoladamente com integridade aprovada; nenhum banco remoto foi usado como destino da restauração.
- `npm run check`: aprovado. `npm test`: **361 testes aprovados, zero falhas, cancelados ou ignorados**. `npm run build`: aprovado. A varredura da entrega não encontrou segredos reais nos 134 arquivos de texto examinados. `check` é o verificador de sintaxe existente; o projeto não possui um comando separado de ESLint. O commit e a publicação são identificados na entrega e no CI.

As limitações externas reais são a ausência de fonte autorizada de preços brasileiros, a cobertura variável do catálogo e a disponibilidade dos fornecedores. Cadastro, persistência, organização e saídas particulares funcionam sem essas cotações. O inventário completo do e-commerce e suas pendências comerciais está em [STATUS-SITE.md](STATUS-SITE.md).
