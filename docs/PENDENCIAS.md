# Estado do projeto — 15/10/2026

O prompt master descreve uma plataforma maior que esta primeira entrega integrada. Esta etapa entrega a identidade BKM e a fundação local. Não equivale à conclusão de todos os critérios do documento.

## Implementado

- Logo BKM, paleta da marca e animação preservada.
- Banco persistente, migrations, autenticação e administração autorizada no servidor.
- Cadastro/edição de lacrados e cartas, variantes, imagens, preços, estoque e publicação local.
- Consulta TCGdex por idioma/coleção/número, cache, timeout e alternativa manual.
- Catálogo paginado, busca/filtros reais, páginas de produto, favoritos e carrinho persistente.
- Cotação de carrinho, preço/estoque no servidor, cupons básicos e frete fixo por faixas de CEP.
- Configurações de loja, conta/admin e consultas de pedidos com estados vazios reais.
- Checkout com informação explícita de pagamento indisponível.

## Próxima prioridade: pedidos e pagamentos

1. Criação de pedido idempotente com snapshots e reservas transacionais.
2. Expiração/liberação/baixa das reservas e teste de dois clientes para a última unidade.
3. Orders API Mercado Pago em ambiente de teste confirmado, cartão tokenizado e Pix de teste.
4. Webhook conectado aos pedidos, confirmação remota, reconciliação, reembolso e auditoria financeira.
5. Testes de ponta a ponta em sandbox antes de habilitação produtiva.

## Operação e administração pendentes

Recuperação/verificação de e-mail; troca de senha; endereços e operadores; gestão completa de pedidos/envio/rastreamento/cancelamento; importação/edição em massa; aliases administráveis de coleções; condições configuráveis; banners e ordenação completa da home; mais vendidos a partir de vendas confirmadas; cupons segmentados/por cliente; provedor logístico e etiquetas; políticas finais e dados empresariais reais.

Também faltam os filtros avançados completos na interface (raridade, tipo, série, acabamento e faixa de preço), campos comerciais extensos de lacrados, zoom de galeria e a vitrine de recomendações. Os filtros já disponíveis são busca, coleção, idioma, condição, disponibilidade e ordenação. A API possui filtros adicionais de preço e acabamento preparados, mas a interface ainda não os expõe.

## Preparação produtiva pendente

Hospedagem, domínio, HTTPS, cookies Secure atrás do proxy, armazenamento e backups; revisão de segurança/abuso/logs; avaliação PostgreSQL conforme operação; SEO por produto no servidor, sitemap e dados estruturados reais; ampliação de testes ponta a ponta e acessibilidade.

A licença do banco de metadados não comprova, por si só, autorização comercial de todas as ilustrações Pokémon. Consulte as fontes em INTEGRACOES.md.
