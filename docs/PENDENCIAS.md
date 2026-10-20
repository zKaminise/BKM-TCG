# Pendências e ativação — Fase 3

Estado em **20/10/2026, antes do push/deploy da Fase 3**. O código local e as migrations 1–7 do Supabase principal foram preparados; a rodada integral registrou 211 testes aprovados. O domínio canônico é [lojabkm.com.br](https://lojabkm.com.br/), com `www` redirecionando por 308. A publicação final do novo código ainda não foi registrada nesta versão do documento.

## Publicação e prova online

- Publicar a Fase 3 na branch `main` de [zKaminise/BKM-TCG](https://github.com/zKaminise/BKM-TCG), verificar CI, deploy Ready e commit efetivamente servido.
- Conferir o alias histórico `bkm-tcg-demo.vercel.app`, a configuração canônica e os redirecionamentos finais. Não presumir que a configuração ainda pendente desse alias já foi aplicada.
- No domínio publicado, exercitar cadastro por raiz e `www`, login/logout, sessão, carrinho autenticado, painel, conta, fichário, lotes, desejos, CSV e referências autorizadas. Registrar evidências em [VALIDACAO.md](VALIDACAO.md).
- Completar QA visual desktop/mobile dos novos fluxos. A tentativa de QA pelo subagente não teve navegador habilitado e não gerou screenshots; isso não conta como validação visual.

## Google e recuperação por e-mail

Cliente Google e chaves Resend estão guardados privadamente e foram configurados nas variáveis Production. Ainda faltam:

- Google: provar cadastro, retorno, cancelamento, login recorrente, vínculo seguro e preservação dos dados no domínio oficial. O código valida state/nonce, PKCE e tokens; isso não comprova consentimento/callback externo funcionando.
- Resend: conferir domínio/remetente, eventos assinados, aceitação e entrega real. Exercitar recuperação por link de uso único no domínio canônico, redefinição e invalidação de sessões. Não marcar envio como entregue apenas pelo HTTP da API.
- Testes controlados em demonstração exigem destinatários exatos autorizados e ativação específica. Campanhas e envio indiscriminado não ficam habilitados por salvar uma chave.
- Contas exclusivamente Google não devem receber promessa de definir senha local por um formulário não suportado. A interface identifica essa limitação.

## Mercado Pago

A consulta autenticada de `/users/me` confirmou que a conta configurada é de teste. A instalação principal permanece mock, com produção financeira desativada. Em 19/10, a organização anterior ainda mostrava dois projetos Free após o relato de liberação. Em 20/10, foi criado o projeto Supabase **BKM ecommerce**, referência `cxoeompxmgdzufgzxerw`, em nova conta autorizada pelo titular. Migração, configuração e conexão da aplicação a esse projeto permanecem pendentes; isso não comprova deploy, isolamento financeiro ou homologação. Nenhuma pausa ou exclusão de outro projeto foi executada pelo agente.

Faltam testes externos de Pix/cartão, estados financeiros, webhook, repetição, reconciliação e isolamento dos ambientes. Não reutilizar o banco principal nem ativar cobranças reais para concluir essa homologação.

## Coleções e preços

- TCGdex fornece checklists resumidos com cobertura variável; raridade e outros metadados detalhados podem estar parcialmente disponíveis. Não completar campos ausentes com invenções.
- Fotos pessoais aceitam URL HTTPS; upload privado de fotos pessoais continua ausente.
- Importação administrativa de referências globais autorizadas está implementada, mas o conjunto está vazio. Preços privados dos clientes não são expostos pelo painel global.
- Não foi encontrada/configurada API pública licenciada da Liga Pokémon. O acesso encontrado com bloqueio não foi contornado. Integração automática depende de autorização/licença efetiva; até lá, referências manuais identificadas e CSV legítimo.
- Alertas por e-mail exigem consentimento, frequência e entrega homologada. Carrinho abandonado continua sem automação ativa.

## Operação comercial e continuidade

- Frete real: escolher provedor, origem e embalagens, conferir medidas/peso, preços, prazos, documentação e tracking. Melhor Envio tem adaptador sandbox testado com mocks; faltam chave e homologação, e ele não está ligado ao checkout nem compra etiquetas.
- Dados empresariais, atendimento e políticas operacionais definitivas ainda não foram fornecidos para conclusão comercial.
- Escolher infraestrutura/plano elegível para comércio antes de vender. A hospedagem Hobby permanece demonstrativa e `noindex`.
- Backups criptografados e restauração isolada já foram executados. Falta instituir e cumprir a rotina de retenção/cópia separada; não existe automação agendada de backup ou descarte nesta fase.

Segredos, conexões, chaves de backup, arquivos de banco e restaurações privadas não pertencem ao Git, screenshots ou ZIP público. Abertura comercial exige decisão explícita posterior à homologação; nenhuma configuração desta fase a autoriza automaticamente.

A migração pode manter temporariamente `BKM_MAINTENANCE_MODE=true`: toda a API retorna HTTP 503 com `Retry-After: 60`. Retirar a manutenção e conferir os fluxos após validar o destino continua parte do fechamento; não anunciar o site funcional durante esse bloqueio.
