# Google e identidade dos e-mails

Revisão de 29/10/2026. A compra real relatada pelo proprietário confirmou Pix e recebimento dos e-mails. Esta entrega não faz novas cobranças, não envia mensagens externas e não contrata certificados ou serviços.

## SEO implementado

- Sai o bloqueio global `noindex, nofollow` da publicação inteira. A decisão agora é por página e ambiente no servidor: apenas `https://lojabkm.com.br`, em produção efetiva, permite indexar páginas comerciais públicas válidas.
- Home, catálogo, páginas de coleção com produtos, detalhes de produtos e páginas institucionais recebem título, descrição, canonical e Open Graph próprios no HTML inicial. Produtos e links comerciais existem no HTML antes de executar JavaScript, além da interface interativa habitual.
- Detalhes de produtos trazem JSON-LD `Product` com ofertas, moeda BRL, preço, disponibilidade e condição coerentes com variantes ativas do banco. Reservas ativas reduzem a disponibilidade. Não há avaliações fabricadas, prazo de entrega, política comercial ou desconto presumidos.
- O sitemap é dinâmico em `/sitemap.xml`: inclui produtos publicados e não arquivados com variantes ativas, inclusive páginas válidas sem estoque marcadas como indisponíveis, além das categorias/coleções com conteúdo. Rascunhos, arquivos e rotas privadas ficam fora. Datas vêm do produto; não são renovadas artificialmente a cada consulta.
- `robots.txt` permite a loja pública e os recursos públicos que o renderizador usa para carregar catálogo/configuração/sessão anônima. APIs continuam com cabeçalho `noindex`; autenticação e autorização de áreas privadas continuam sendo verificadas pelo servidor.
- Admin, conta, pedidos, checkout, carrinho, login, cadastro, recuperação, favoritos e buscas/filtros arbitrários recebem `noindex`. Não se depende de remover `noindex` por JavaScript para permitir uma página pública.
- Preview, sandbox, domínios não oficiais e ambientes sem configuração explícita continuam bloqueados. Aliases oficiais da produção redirecionam para o domínio canônico preservando caminho e parâmetros.
- Produto inexistente/arquivado responde HTTP 404; indisponibilidade da consulta responde 503. Uma página de erro não se apresenta como produto existente. A navegação da SPA atualiza canonical/robots e remove dados estruturados da página anterior.

O mínimo necessário para o robô é entregue igualmente a usuários; não há conteúdo especial por User-Agent. A marcação usa dados públicos e não lê contas, pedidos, e-mails ou a origem privada de postagem.

## Verificação e descoberta no Google

O site está tecnicamente elegível após a publicação desses arquivos, mas a decisão e o tempo de rastreamento/indexação pertencem ao Google. Não há garantia de primeira posição ou de aparecer imediatamente ao pesquisar “cartas Pokémon”.

O prefixo `https://lojabkm.com.br/` foi verificado pelo titular no [Google Search Console](https://search.google.com/search-console/), com metatag pública permanente no HTML. O sitemap `https://lojabkm.com.br/sitemap.xml` foi enviado e processado pelo Google, com 13 páginas encontradas. As solicitações individuais de indexação da home e do produto real `/produto/exeggcute` foram aceitas na fila de rastreamento prioritário. Nenhuma delegação a outro usuário foi criada. Isso não significa que as páginas já estejam indexadas. O servidor também aceita opcionalmente `GOOGLE_SITE_VERIFICATION` em Production; o valor deve vir do Search Console.

As inspeções da home e do produto foram concluídas, com aceitação das solicitações após o teste do URL publicado. Acompanhe os relatórios de indexação e desempenho sem repetir a solicitação da mesma página: isso não melhora sua prioridade. O desenvolvimento contínuo de páginas úteis, estoque real, descrições precisas e referências legítimas à loja contribui para a descoberta; isso não foi convertido em promessa de posicionamento.

Fontes: [SEO e JavaScript — Google](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics), [sitemaps — Google](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview), [regras de dados estruturados — Google](https://developers.google.com/search/docs/appearance/structured-data/sd-policies).

## Logo dos e-mails: duas apresentações diferentes

A logo **dentro da mensagem** já existe em todos os modelos transacionais da BKM. Ela usa PNG público HTTPS, texto alternativo e link para a loja; a URL foi conferida com resposta 200. Os testes existentes verificam o uso da identidade BKM nos modelos. Alguns leitores podem bloquear imagens externas até que o destinatário permita carregá-las.

A **foto ao lado do remetente na caixa de entrada** é controlada pelo provedor de quem recebe. Não há um campo da API de envio do Resend capaz de impor essa foto a todos os clientes. Para o padrão BIMI no Gmail, as instruções oficiais exigem DMARC com política aplicada e certificado VMC ou CMC, além de arquivos próprios da marca. O logo comercial atual em PNG não equivale a um certificado ou a um SVG Tiny PS válido.

Na consulta pública de DNS desta etapa, `resend._domainkey.lojabkm.com.br` tinha registro DKIM; `_dmarc.lojabkm.com.br` e `default._bimi.lojabkm.com.br` não retornaram TXT. Esse resultado pontual deve ser revisto antes de qualquer alteração. Nenhum registro foi modificado. Não foi aplicado `quarantine/reject` sem auditar todos os remetentes legítimos, pois isso pode afetar entregas existentes.

Para avançar no avatar de marca: conferir SPF/DKIM/DMARC e alinhamento, avaliar a elegibilidade da marca para VMC/CMC com a autoridade certificadora, preparar o SVG no formato exigido e publicar os arquivos/registros autorizados. Há etapas externas, possível custo e decisão do provedor sobre exibição. Portanto o avatar não foi marcado como concluído nem foi prometido para todos os destinatários.

Fontes: [Implementando BIMI — Resend](https://resend.com/docs/dashboard/domains/bimi), [configuração de BIMI — Google](https://knowledge.workspace.google.com/admin/security/set-up-bimi?hl=en).

## Validação técnica

Oito testes próprios de SEO cobrem ambiente/domínio, canonical e filtros, HTML inicial com ofertas reais/escaping, rascunho/arquivo/404, sitemap, robots e rotas privadas/sandbox, redirects/HEAD, verificação opcional e transição SPA. Também foram executados os testes existentes de domínio, workers/manutenção e e-mail, sem envio externo. A validação da publicação deve conferir HTML/headers/robots/sitemap no domínio oficial e bloqueio no sandbox, além da presença do template gerado no pacote serverless.

O build gera `server/seo-template.html` a partir do `index.html` atual. Esse arquivo é ignorado pelo Git e incluído no bundle da função pela regra `server/**`; uma mudança na animação/home entra no template automaticamente no próximo build.

Na Vercel, o HTML não é copiado para `dist/index.html`: arquivos estáticos têm precedência sobre rewrites, inclusive na home. O shell fica somente no template da função; `/` e `/index.html` passam pelo renderizador que decide index/noindex por ambiente. A build remove também sobras desses arquivos de builds anteriores. CSS, JavaScript e imagens continuam estáticos. Esse comportamento foi identificado e corrigido na conferência HTTP da publicação.
