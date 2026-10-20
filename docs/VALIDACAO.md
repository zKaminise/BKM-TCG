# Validação — BKM TCG Fase 3

## Marco de 20/10/2026, antes da publicação

Site canônico: [lojabkm.com.br](https://lojabkm.com.br/). Repositório: [zKaminise/BKM-TCG](https://github.com/zKaminise/BKM-TCG), branch `main`. Diretório: `D:\Importante\Codex\LP Vendas TCG Site`.

A rodada integral registrada pela execução principal aprovou **211 testes**, além de sintaxe e build. Migrations **1–7** foram aplicadas ao PostgreSQL Supabase principal. O novo código da Fase 3 **ainda não teve push/deploy e prova online final registrados neste documento**. Os resultados abaixo distinguem testes, estado de infraestrutura, verificações históricas e homologação pendente.

## Cobertura automatizada da Fase 3

- Domínio/origens e caminhos de retorno seguros, perfil, endereços, autenticação, sessão/CSRF e isolamento de contas.
- Google OIDC com PKCE, state/nonce, tokens, conflitos/vínculo e manutenção de papéis. Transporte controlado não comprova consentimento e callback reais.
- Coleção pessoal, checklist e objetivos, lotes/duplicatas/variantes, quantidade/custo, filtros, propriedade e isolamento entre usuários.
- Desejos e correspondência com anúncios disponíveis, consentimento, notificações internas e deduplicação.
- Referências privadas e globais segregadas, valor conhecido/cobertura/desatualização e snapshots reais; importação/exportação CSV, prévia, erros, direitos e idempotência.
- E-mails, outbox, entrega/eventos, corpo bruto, assinatura Svix, repetição, destinatários controlados e falhas.
- Backup, criptografia/autenticação, chave incorreta, objetos, constraints e restauração isolada.
- Logística sandbox: 11 testes controlados para readiness, CEP/medidas/conversões, preço/prazo personalizados, BRL, limites, timeout, origem fixa, redirecionamentos e tracking.
- Regressão do catálogo, TCGdex, estoque, pedidos, reserva/baixa/idempotência, permissões, uploads, carrinho, cupons, mock e preparação Mercado Pago.

A suíte usa identidades e bancos isolados, incluindo PostgreSQL embarcado via PGlite. Ela não deve carregar o `.env` privado real. Não executar testes financeiros contra o principal para substituir o isolamento. Testes automatizados não equivalem a homologação Google, Resend ou Mercado Pago externos.

## Infraestrutura e dados confirmados nesta etapa

- Supabase principal dedicado `bkm-tcg-demo`, região São Paulo, pooler Transaction/6543, TLS verificado e migrations 1–7 aplicadas. A autenticação BKM foi preservada; não há cadastro Supabase Auth paralelo.
- Domínio canônico definido como `https://lojabkm.com.br`; configuração de `www` com redirecionamento 308 já corrigida online. A prova pós-deploy deve incluir caminhos como `/cadastro`, não apenas a home.
- Cliente Google e chaves Resend guardados em configuração privada e variáveis Vercel Production. Esses registros comprovam configuração, não login ou entrega efetivos.
- Consulta Mercado Pago `/users/me` confirmou conta de vendedor de teste. Principal permanece mock e sem produção financeira. A organização anterior ainda mostrou dois projetos Free em 19/10. Em 20/10 foi criado o projeto Supabase BKM ecommerce (`cxoeompxmgdzufgzxerw`) em nova conta autorizada pelo titular; migração e configuração permanecem pendentes. Isso não comprova aplicação conectada ou homologação. Nenhum projeto alheio foi pausado pelo agente.
- Referências globais autorizadas implementadas na migration 007, com conjunto vazio neste marco. Nenhuma cotação foi inventada para gerar métricas.

## Backup e restauração reais

Foram registrados dois marcos de backup, sem exposição de conteúdo privado:

| Marco | Conteúdo observado | Resultado |
| --- | --- | --- |
| Snapshot inicial | 22 tabelas, 177 registros, 2 imagens | AES-256-GCM; restauração isolada validada |
| Snapshot posterior, antes da migration 007 | 38 tabelas, 202 registros, 2 imagens | Arquivo criptografado e restauração isolada confirmados |

São contagens dos snapshots, não uma descrição congelada do esquema atual após a migration 007. Banco restaurado e objetos permanecem privados. Chave de backup fica fora do repositório e do ZIP público, com necessidade de cópia segura separada. Retenção é manual; não existe automação de backup ou descarte ativa. Procedimento em [BACKUP.md](BACKUP.md).

## Validação visual da Fase 3

Foram preparados layout de conta/fichário, SVGs locais no header, checklist visual, formulários e painel de referências. A tentativa de QA do subagente recebeu inventário de navegador vazio e não gerou screenshots, portanto **não é prova visual**. A execução principal deve completar e registrar desktop/mobile e persistência dos fluxos no domínio publicado.

Correções estáticas incluem layout inicial por rota sem flash da animação em produto/admin, banner neutro durante inicialização, imagem de destaque conforme o DTO, seis variantes no objetivo, fonte/data e referência desatualizada sinalizada. Sintaxe e build foram conferidos após as alterações. Isso não substitui testar a interface no navegador.

## Registro histórico da Fase 2

Os itens abaixo documentam o que já havia sido exercitado online antes da Fase 3; não provam as novas rotas ou integrações:

- CI anterior com 119 testes no commit `e3dff6c` e publicação posterior do ajuste de carregamento/CTA `085351a`.
- PostgreSQL e Storage conectados; dados SQLite importados, administrador existente e RLS das tabelas daquela versão verificado.
- Login administrativo, importação TCGdex, publicação/edição de Butterfree, produto de QA arquivado de forma recuperável e upload 4K otimizado para WebP no Storage.
- Home e animação verificadas em desktop/celular; no viewport móvel de 375 px a página media 375 px, sem overflow horizontal.
- Carrinho e checkout móvel criaram pedido demonstrativo pendente, depois aprovado por simulação; refresh e reinício local preservaram estado no banco remoto.
- Concorrência em dois pools PostgreSQL sobre a última unidade: uma aprovação e uma resposta de estoque insuficiente, com apenas uma baixa; repetir a chave idempotente devolveu o mesmo pedido.

As evidências históricas da pasta de entregas incluem `bkm-admin-online.jpg`, `bkm-ecommerce-online-catalogo.jpg`, `bkm-upload-supabase-online.jpg`, `bkm-login-mobile.jpg`, `bkm-carrinho-online-mobile.jpg`, `bkm-checkout-online-mobile.jpg`, `bkm-pedido-online-mobile.jpg` e capturas de home/animação. Não renomear essas imagens como prova da Fase 3.

## Prova online final da Fase 3 — pendente

Após o deploy, acrescentar neste ponto o commit servido, CI/deployment, URLs verificadas e resultados reais. Incluir cadastro via raiz/www, sessão/login/logout, conta e coleção, CSV, desejos, administração e visual desktop/mobile. Registrar separadamente consentimento/callback Google, entrega/recuperação Resend e homologação Mercado Pago no ambiente isolado.

Não preencher esta seção com resultado presumido. Aceitação de e-mail não significa entrega; validar token Mercado Pago não significa cobrança aprovada; snapshots locais não demonstram o código novo publicado.

## Limites conhecidos

Operação principal demonstrativa, `noindex` e Hobby não comercial. Mercado Pago externo pendente; OAuth e entrega Resend dependem de prova após publicação. Preços Liga automáticos sem acesso licenciado, raridade resumida TCGdex parcial, fotos pessoais sem upload privado, logística sem chave e sem checkout real, automação de carrinho desativada, dados empresariais/políticas ainda incompletos. Dependências atuais em [PENDENCIAS.md](PENDENCIAS.md).

## Proteção durante a migração

A rodada integral mais recente aprovou **211/211 testes**, incluindo o guard `BKM_MAINTENANCE_MODE` em `api/index.js`. Quando ativo, toda a API retorna HTTP 503 com `Retry-After: 60` antes de inicializar o banco. O teste comprova o bloqueio temporário, não a conclusão do cutover ou da prova online.
