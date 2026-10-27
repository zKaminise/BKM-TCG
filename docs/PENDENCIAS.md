# Pendências e ativação — Fase 3

**Registro histórico de 21/10/2026.** Para o estado atual, consulte [STATUS-SITE.md](STATUS-SITE.md), [ativação de produção](PRODUCAO-ATIVADA.md) e [novo módulo Minha Coleção](MINHA-COLECAO.md). A produção já foi ativada e a migration 009 aplicada; descrições antigas de mock, 41 tabelas ou bloqueio de plano abaixo não são o estado operacional vigente.

Visão completa das funcionalidades e provas, com as pendências separadas por dependência comercial ou QA: [RELATORIO-FASE3.md](RELATORIO-FASE3.md).

Estado em **21/10/2026**: código publicado no [commit `fdbb91c`](https://github.com/zKaminise/BKM-TCG/commit/fdbb91c6bf24f0306c98e2fb17ed407d87bee1a6), com **265 testes**, sintaxe aprovada e [CI 39642646628 com sucesso](https://github.com/zKaminise/BKM-TCG/actions/runs/39642646628). Deployments Success desse código: principal `GRuxVzXNnseYFDWhBYD1a4TrbCij`; sandbox `AVSCdA9YAMiJ4LPAxdMzApFMLbVM`. Cron Enabled e disparo manual Vercel com **HTTP 200** após chave Production; a chamada local com Bearer permaneceu 401. **Resumo controlado entregue; alerta imediato e disparo agendado natural continuam pendentes.** O domínio canônico é [lojabkm.com.br](https://lojabkm.com.br/), com `www` redirecionando por 308.

O reembolso integral moderno de `4ca7a0c` foi testado e comprovado no sandbox para a order APRO: **um POST 201**, um reembolso concluído de R$ 50,00 nominais, GET autoritativo e estado local REFUNDED, com segundo recibo webhook autenticado. Permaneceram quatro pedidos, estoque zero e duas baixas; reembolso financeiro não repõe o produto automaticamente. Reembolso parcial e outros cenários permanecem pendentes.

## Principal migrado e continuidade

O cutover para o Supabase **BKM ecommerce** (`cxoeompxmgdzufgzxerw`) foi concluído: **40 tabelas, 230 registros e 2 objetos Storage** migrados, com SHA-256, integridade, RLS e origem inalterada conferidos. Após a migration **008**, a leitura PostgreSQL de ambos os ambientes confirmou **41 tabelas, 41 com RLS e zero grants públicos**; nenhum evento de resumo estava pendente naquele momento. A auditoria do cutover havia encontrado 3 usuários, 4 pedidos e 2 referências de imagens no novo Storage, nenhuma no antigo.

Vercel Production e `.env` local já usam o novo principal. O banco anterior (`nxrvmanifngjmdtgnzoq`) e o `.env.old-main` continuam preservados. A manutenção foi encerrada e HTTP 200 confirmado; `/api/config` indica demo, mock, `canCharge=false` e Google habilitado, com 15 produtos observados no catálogo. O último backup comprovado, após a migration 008, contém **41 tabelas/199 registros/2 objetos** e foi restaurado isoladamente com `integrity=ok` e `remoteTarget=false`. Os snapshots de 233 e 244 registros e a migração de 230 permanecem preservados; contagens variam com o uso e a expiração de sessões. Detalhes em [BACKUP.md](BACKUP.md).

- Manter as cópias e a configuração anterior preservadas até encerrar a janela de acompanhamento e definir retenção/plano de retorno.
- Completar a prova dos fluxos no destino; migração íntegra e HTTP 200 não substituem QA funcional e visual.

## Prova online restante

- Conferir o alias histórico `bkm-tcg-demo.vercel.app`, caminhos e redirecionamentos após cada publicação.
- O QA HTTP publicado passou 41 verificações de coleção; autenticação confirmou cliente/administrador, cookie seguro, origem/CSRF 403, logout revogado 401, carrinho preservado, catálogo público 15/painel 16 e redirecionamentos 308. O cadastro pelas entradas raiz/`www` também passou com duas fixtures CUSTOMER, POST canônico 201, novo login e revogação, sem e-mail externo. Continuam pendentes demais jornadas e matriz visual; login e leitura de catálogo não comprovam todas as operações da administração. Evidências em [VALIDACAO.md](VALIDACAO.md).
- A coleção foi conferida em viewport móvel **390 × 844**, sem overflow horizontal, com captura `outputs/fase3-colecao-mobile-validada.png`. Completar a matriz visual dos demais fluxos em desktop/mobile. A tentativa anterior do subagente sem navegador continua sem valor de prova, mas não invalida essa captura posterior da execução principal.

## Google e recuperação por e-mail

Cliente Google e chaves Resend estão guardados privadamente e foram configurados nas variáveis Production. Ainda faltam:

- Google: o titular já fez login BKM, confirmou o vínculo explícito e conseguiu sair/entrar pelo Google na mesma conta. Foram observadas 0 coleções; não houve prova de acervo preenchido nesse teste. A audiência foi publicada como **Externo / Em produção**, com scopes básicos `openid`, `email` e `profile`. Publicação básica não equivale a verificação avançada nem comprova ausência de limites. Faltam cadastro novo, cancelamento e demais caminhos no domínio oficial; vínculo e novo login controlados não homologam todo o OAuth.
- Resend: envio e entrega de uma recuperação para o titular já foram confirmados por webhook assinado HTTP 200; replay idempotente também foi conferido, sem novo envio e sem alterar a senha. Falta exercitar a redefinição completa pelo link, invalidação de sessões e os demais modelos/automações. Preservar `NODEJS_HELPERS=0` em Production e redeploy ao alterar essa variável, conforme [DEPLOY.md](DEPLOY.md).
- Resumos e fila: código, migration 008, chave Production e cron Enabled estão configurados. Um resumo ao único titular autorizado ficou **SENT/DELIVERED**, com um callback real, sem reenvio. O teste antecipou somente o vencimento do evento de homologação e usou Run manual Vercel; preferências foram restauradas e desejo temporário removido. **Continuam pendentes o alerta imediato e a observação de disparo agendado natural.** A chamada local com Bearer divergente permaneceu 401 e não é contada como aprovada.
- O cron diário Hobby registrado fecha às 12 UTC/09 BRT; semanal, na segunda. Tem precisão de hora, limites de lote e pode deixar backlog, sem SLA comercial. Respostas ambíguas de envio com mais de 23 horas exigem reconciliação manual, sem reenvio automático que possa duplicar mensagens. Não ampliar a lista controlada de destinatários para testar a fila.
- Testes controlados em demonstração exigem destinatários exatos autorizados e ativação específica. Campanhas e envio indiscriminado não ficam habilitados por salvar uma chave.
- Contas exclusivamente Google não devem receber promessa de definir senha local por um formulário não suportado. A interface identifica essa limitação.

## Mercado Pago

A instalação principal permanece mock, com produção financeira desativada. O sandbox tem deployment Vercel Success **`AVSCdA9YAMiJ4LPAxdMzApFMLbVM`** e Supabase separado **`secapcqqznlokiqhojsa`**, com TLS verificado e 41 tabelas no esquema 8. A verificação real confirmou conta de vendedor de teste, staging/sandbox e `canCharge=false`. O banco estava vazio antes da fixture; agora existem os registros técnicos do teste.

Já foram comprovadas as duas orders Pix técnicas originais de R$ 50,00 nominais, sem cobrança comercial: uma **APPROVED/COMMITTED**; a outra, antes pendente, agora **EXPIRED/RELEASED**. O simulador oficial retornou **HTTP 200 para ambas**, com **2 recibos autenticados por order**, 2 pedidos no snapshot daquele momento e estoque 2 → 1 uma única vez. A validação HMAC agora aceita integralmente ID exato e canônico em tempo constante, com replay unificado. A evidência final foi obtida por GET no provedor e leitura do banco; o relatório inicial com `webhookProven=false` permanece histórico. O teste posterior de cartão recusado acrescentou uma terceira order, com os relatórios Pix inalterados.

Faltam pendência por cartão, cancelamento solicitado, reembolso parcial e demais cenários aplicáveis, além do QA completo do checkout. Pix, cartões `OTHE`/`APRO` e reembolso integral do APRO comprovados no sandbox não autorizam produção financeira nem representam uma compra comercial. Não reutilizar o principal nem liberar produção para concluir esses testes. Evidência final e limites em [HOMOLOGACAO-MP.md](HOMOLOGACAO-MP.md) e [VALIDACAO.md](VALIDACAO.md).

O problema DNS do carregador do SDK foi corrigido e publicado em `09dcc61`: [o endereço oficial `https://sdk.mercadopago.com/js/v2`](https://github.com/mercadopago/sdk-js) respondeu HTTP 200 com JavaScript. Os testes posteriores abriram o Brick real no navegador e tokenizaram cartões oficiais de teste. `OTHE` confirmou **CANCELLED/REJECTED** com reserva liberada; `APRO`, **CONFIRMED/APPROVED** com reserva **COMMITTED/1**, ambos por GET autoritativo e banco e com **1 recibo webhook autenticado por cenário**. O snapshot após APRO tinha **4 pedidos, estoque 0 e 2 baixas acumuladas**, do Pix e do cartão. Essas provas não homologam toda a matriz financeira.

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
