# Pendências e ativação — Fase 3

Estado em **21/10/2026**: resumos e consumidor de e-mails publicados no [commit `0f8388a`](https://github.com/zKaminise/BKM-TCG/commit/0f8388a450ae3a4485d2f48c67e9e1802cb87643), com **260 testes**, sintaxe e build aprovados e [CI 39579166466 com sucesso](https://github.com/zKaminise/BKM-TCG/actions/runs/39579166466). Principal Success `6zQ4yMe3sWHjaFwFKdXSZodhq1bv`; sandbox Success `F8P43oDZD5ucUF7XeHZhw2MpycEN`. Cron registrado como Enabled, mas **chave Production, execução autenticada e prova de entrega de alerta/resumo ainda pendentes**. O domínio canônico é [lojabkm.com.br](https://lojabkm.com.br/), com `www` redirecionando por 308.

## Principal migrado e continuidade

O cutover para o Supabase **BKM ecommerce** (`cxoeompxmgdzufgzxerw`) foi concluído: **40 tabelas, 230 registros e 2 objetos Storage** migrados, com SHA-256, integridade, RLS e origem inalterada conferidos. Após a migration **008**, a leitura PostgreSQL de ambos os ambientes confirmou **41 tabelas, 41 com RLS e zero grants públicos**; nenhum evento de resumo estava pendente naquele momento. A auditoria do cutover havia encontrado 3 usuários, 4 pedidos e 2 referências de imagens no novo Storage, nenhuma no antigo.

Vercel Production e `.env` local já usam o novo principal. O banco anterior (`nxrvmanifngjmdtgnzoq`) e o `.env.old-main` continuam preservados. A manutenção foi encerrada e HTTP 200 confirmado; `/api/config` indica demo, mock, `canCharge=false` e Google habilitado, com 15 produtos observados no catálogo. O último backup comprovado, após a migration 008, contém **41 tabelas/199 registros/2 objetos** e foi restaurado isoladamente com `integrity=ok` e `remoteTarget=false`. Os snapshots de 233 e 244 registros e a migração de 230 permanecem preservados; contagens variam com o uso e a expiração de sessões. Detalhes em [BACKUP.md](BACKUP.md).

- Manter as cópias e a configuração anterior preservadas até encerrar a janela de acompanhamento e definir retenção/plano de retorno.
- Completar a prova dos fluxos no destino; migração íntegra e HTTP 200 não substituem QA funcional e visual.

## Prova online restante

- Conferir o alias histórico `bkm-tcg-demo.vercel.app`, caminhos e redirecionamentos após cada publicação.
- O QA HTTP publicado passou **41 verificações** de coleção, fichário, lotes, filtros, avaliação manual, desejos, CSV, sessão e isolamento entre contas; ver [VALIDACAO.md](VALIDACAO.md). Ainda completar cadastro por raiz e `www`, carrinho autenticado, painel e demais jornadas não cobertas. O QA HTTP não comprova aparência da interface.
- A coleção foi conferida em viewport móvel **390 × 844**, sem overflow horizontal, com captura `outputs/fase3-colecao-mobile-validada.png`. Completar a matriz visual dos demais fluxos em desktop/mobile. A tentativa anterior do subagente sem navegador continua sem valor de prova, mas não invalida essa captura posterior da execução principal.

## Google e recuperação por e-mail

Cliente Google e chaves Resend estão guardados privadamente e foram configurados nas variáveis Production. Ainda faltam:

- Google: o titular já fez login BKM, confirmou o vínculo explícito e conseguiu sair/entrar pelo Google na mesma conta. Foram observadas 0 coleções; não houve prova de acervo preenchido nesse teste. A audiência foi publicada como **Externo / Em produção**, com scopes básicos `openid`, `email` e `profile`. Publicação básica não equivale a verificação avançada nem comprova ausência de limites. Faltam cadastro novo, cancelamento e demais caminhos no domínio oficial; vínculo e novo login controlados não homologam todo o OAuth.
- Resend: envio e entrega de uma recuperação para o titular já foram confirmados por webhook assinado HTTP 200; replay idempotente também foi conferido, sem novo envio e sem alterar a senha. Falta exercitar a redefinição completa pelo link, invalidação de sessões e os demais modelos/automações. Preservar `NODEJS_HELPERS=0` em Production e redeploy ao alterar essa variável, conforme [DEPLOY.md](DEPLOY.md).
- Resumos e fila: código, migration 008 e cron Enabled estão publicados e testados. Falta concluir o salvamento privado de `CRON_SECRET` em Vercel Production, redeploy e comprovar execução autenticada do cron diário. O disparo manual pelo painel chegou à função e respondeu **401 `JOB_UNAUTHORIZED`** sem chave; isso prova rota e guard, não processamento autorizado ou envio. Falta a prova real de alerta/resumo de desejos aceito e entregue por Resend; não inferir entrega a partir de teste automatizado ou HTTP 200 do job.
- O cron diário Hobby registrado fecha às 12 UTC/09 BRT; semanal, na segunda. Tem precisão de hora, limites de lote e pode deixar backlog, sem SLA comercial. Respostas ambíguas de envio com mais de 23 horas exigem reconciliação manual, sem reenvio automático que possa duplicar mensagens. Não ampliar a lista controlada de destinatários para testar a fila.
- Testes controlados em demonstração exigem destinatários exatos autorizados e ativação específica. Campanhas e envio indiscriminado não ficam habilitados por salvar uma chave.
- Contas exclusivamente Google não devem receber promessa de definir senha local por um formulário não suportado. A interface identifica essa limitação.

## Mercado Pago

A instalação principal permanece mock, com produção financeira desativada. O sandbox tem deployment Vercel Success **`F8P43oDZD5ucUF7XeHZhw2MpycEN`** e Supabase separado **`secapcqqznlokiqhojsa`**, com TLS verificado e 41 tabelas no esquema 8. A verificação real confirmou conta de vendedor de teste, staging/sandbox e `canCharge=false`. O banco estava vazio antes da fixture; agora existem os registros técnicos do teste.

Já foram comprovadas as duas orders Pix técnicas originais de R$ 50,00 nominais, sem cobrança comercial: uma **APPROVED/COMMITTED**; a outra, antes pendente, agora **EXPIRED/RELEASED**. O simulador oficial retornou **HTTP 200 para ambas**, com **2 recibos autenticados por order**, 2 pedidos no total e estoque 2 → 1 uma única vez. A validação HMAC agora aceita integralmente ID exato e canônico em tempo constante, com replay unificado. A evidência final foi obtida por GET no provedor e leitura do banco; o relatório inicial com `webhookProven=false` permanece histórico.

Faltam cartão pelo SDK, recusa, cancelamento, reembolso e demais cenários aplicáveis, além do QA completo do checkout. Pix sandbox e callbacks oficiais comprovados não autorizam produção financeira nem representam uma compra comercial. Não reutilizar o principal nem liberar produção para concluir esses testes. Evidência final e limites em [HOMOLOGACAO-MP.md](HOMOLOGACAO-MP.md) e [VALIDACAO.md](VALIDACAO.md).

## Coleções e preços

- TCGdex fornece checklists resumidos com cobertura variável; raridade e outros metadados detalhados podem estar parcialmente disponíveis. Não completar campos ausentes com invenções.
- Fotos pessoais aceitam URL HTTPS; upload privado de fotos pessoais continua ausente.
- Importação administrativa de referências globais autorizadas está implementada, mas o conjunto está vazio. Preços privados dos clientes não são expostos pelo painel global.
- Não foi encontrada/configurada API pública licenciada da Liga Pokémon. O acesso encontrado com bloqueio não foi contornado. Integração automática depende de autorização/licença efetiva; até lá, referências manuais identificadas e CSV legítimo.
- Alertas por e-mail exigem consentimento, frequência e validação própria do fluxo; a entrega comprovada da recuperação não homologa alertas ou campanhas. Carrinho abandonado continua sem automação ativa.

## Operação comercial e continuidade

- Frete real: escolher provedor, origem e embalagens, conferir medidas/peso, preços, prazos, documentação e tracking. Melhor Envio tem adaptador sandbox testado com mocks; faltam chave e homologação, e ele não está ligado ao checkout nem compra etiquetas.
- Dados empresariais, atendimento e políticas operacionais definitivas ainda não foram fornecidos para conclusão comercial.
- Escolher infraestrutura/plano elegível para comércio antes de vender. A hospedagem Hobby permanece demonstrativa e `noindex`.
- Backups criptografados e restauração isolada já foram executados. Falta instituir e cumprir a rotina de retenção/cópia separada; não existe automação agendada de backup ou descarte nesta fase.

Segredos, conexões, chaves de backup, arquivos de banco e restaurações privadas não pertencem ao Git, screenshots ou ZIP público. Abertura comercial exige decisão explícita posterior à homologação; nenhuma configuração desta fase a autoriza automaticamente.

O guard `BKM_MAINTENANCE_MODE=true` permanece disponível para futuras manutenções, bloqueando a API com HTTP 503 e `Retry-After: 60`. Nesta etapa, Production já está com `BKM_MAINTENANCE_MODE=false` e HTTP 200 confirmado; as pendências são os fluxos específicos registrados acima.
