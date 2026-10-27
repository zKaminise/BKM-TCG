# BKM TCG — ajustes de coleção, contas e logística

Revisão de 27/10/2026. O inventário completo e as pendências operacionais estão em [STATUS-SITE.md](STATUS-SITE.md).

## Entregue

- Busca de cartas enquanto o usuário digita, com debounce, cancelamento de respostas anteriores e números incompletos; botão opcional de atualização.
- TCGdex real: referências Cardmarket/EUR e TCGplayer/USD no resultado, detalhes, revisão e inventário. Cache diário, snapshot persistente e atualização limitada por página. Fonte/data/ausência/desatualização visíveis. Acabamentos e atributos incompatíveis não recebem automaticamente preço de outra versão.
- Referências internacionais são separadas das avaliações, custos e resultados em BRL. Não há câmbio, multiplicador de conservação ou cotação brasileira inventados. Totais estrangeiros são somente da página, por fonte e moeda. [Detalhes e limites](TCGDEX-PRECOS-AUTOMATICOS.md).
- Política única de nova senha: 9–14 caracteres inclusive, A–Z e 0–9 obrigatórios, símbolos opcionais. Cadastro, recuperação, alteração e criação administrativa usam a mesma regra. Instruções antes do campo, checklist dinâmico, confirmação e mostrar/ocultar. Login de senhas antigas e Google preservados; scrypt, sessão, CSRF e limites existentes mantidos.
- Painel de frete com origem privada, perfis de embalagem, peso/dimensões, CEPs, transportadora/serviço, preço, prazo, validação e ativação por região. Alterar origem, embalagem ou cobertura exige nova confirmação das tarifas. A configuração pública não expõe os dados privados de postagem.
- Nacional explicitamente desligado na configuração principal; retirada e entrega local mantidas, mínimo promocional de R$ 150 preservado. A barra não anuncia frete grátis nacional quando essa modalidade está desligada. [Auditoria, dados mínimos e limites do adaptador](LOGISTICA.md).
- Dois administradores: `admin@bkmtcg.com.br` e `gerente@lojabkm.com.br`, com a mesma senha válida confirmada pelo proprietário, armazenada somente como hashes. Autenticação HTTP e acesso às configurações/integrações em produção conferidos para ambos. Avisos operacionais direcionados ao e-mail já informado pelo proprietário. Criar login não cria uma caixa postal.

## Validação executada

- Suíte completa: **389 testes aprovados, zero falhas**. Inclui SQLite, PostgreSQL/PGlite, HTTP, concorrência/idempotência, isolamento de dados e fluxos existentes.
- Limites de senha: 8/9/14/15, composição, símbolo opcional, Unicode, confirmação, recuperação, alteração e autenticação legada sem mudança do hash.
- Busca progressiva, cache e falhas do catálogo; mercado sem preço, antigo, moeda/identidade/acabamento incompatíveis, snapshot, dados pessoais e BRL manual preservados.
- Logística: limites de CEP, regiões, retirada offline, entrega local, descontos, troca de destino, preço/prazo/configuração inválidos, privacidade da API, erro/timeout/indisponibilidade com rede externa simulada.
- Conferência visual em navegador: busca `166/1` e `166/165` sem submit, inclusão de Bulbasaur HP com custo R$ 25 no banco isolado, recarga do inventário com dados persistidos, referência EUR separada e tela móvel de 390 px sem overflow da página; editor administrativo salvando retirada/local com nacional desligado.
- Instruções/checklist e botões de exibição de senha conferidos visualmente; validadores de frontend e backend exercitados automaticamente. A autenticação visual da conta legada passou. Nenhuma nova senha foi digitada na interface pelo agente.
- `check`, `build`, verificação de diff e busca de segredos aprovados. Backup criptografado antes e depois das alterações administrativas/configuração.

A conferência visual encontrou um erro de variável ao retornar à coleção; ele foi corrigido e recebeu teste que executa o carregamento real da tela em um host DOM mínimo. Nenhum teste desta etapa cobrou dinheiro, comprou etiqueta ou enviou correspondência a terceiros.

## Publicação conferida

Os ajustes estão publicados em [lojabkm.com.br](https://lojabkm.com.br/). A primeira versão do código desta entrega é `f6bc10f56220a99c3ba4e8952bfccf892ebf52a3`, com [CI aprovada](https://github.com/zKaminise/BKM-TCG/actions/runs/40585602375) e publicação Vercel principal/sandbox concluída. O complemento de testes do componente de senha foi executado depois, mantendo o código de produção idêntico.

A conferência externa confirmou política 9–14, Google e e-mail habilitados, Mercado Pago em produção apto a cobranças, ambos administradores com acesso HTTP 200 e permissões ADMIN, nacional desligado e retirada/local ativos. Os arquivos públicos correspondem às fontes enviadas, ignorando somente CRLF/LF. Rotas privadas retornam 401 sem sessão. O sandbox permanece `staging`, sem cobranças reais. A pesquisa automática por `166/165` mostrou Bulbasaur e referência Cardmarket EUR na página publicada, sem gravar um novo exemplar na coleção principal.

As 43 tabelas públicas continuam com RLS habilitado e não foram encontrados grants de navegador nas tabelas pessoais; os anúncios e coleções existentes foram preservados. ZIP de fonte gerado diretamente do Git, sem bancos, backups ou `.env` privado.

## Limites e prova operacional que ainda falta

O TCGdex não comprova preços por conservação/impressão física no Brasil. A fonte BRL autorizada continua pendente. O Melhor Envio disponível é um adaptador restrito a consultas sandbox; não está ativado, não compra etiquetas e não cota produção.

Google está habilitado; um vínculo e novo login da conta vinculada foram comprovados anteriormente. O cadastro de uma conta Google inédita pelo comprador ainda deve ser conferido no teste operacional. Recuperação e entregas transacionais ao titular autorizado já tiveram prova externa; cada etapa de uma compra comercial ainda deve ser conferida.

O teste real autorizado deve usar produto físico cadastrado pelo proprietário por R$ 10 e **retirada em Uberlândia**. Mercado Pago possui credenciais reais e Pix/crédito/débito configurados, mas a aprovação, os e-mails da compra e o valor líquido/liquidação são confirmados somente pelo pedido real e pelo extrato da conta recebedora. Roteiro: [OPERACAO-PRODUCAO.md](OPERACAO-PRODUCAO.md).
