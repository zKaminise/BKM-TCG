# Pendências e ativação — Fase 3

Estado em **20/10/2026**: núcleo da Fase 3 publicado no [commit `d109af2`](https://github.com/zKaminise/BKM-TCG/commit/d109af2), deployment Ready e [CI histórico 39399711168 com 211 testes aprovado](https://github.com/zKaminise/BKM-TCG/actions/runs/39399711168). A rodada local posterior aprovou **213 testes**, sintaxe e build. O redeploy `NMSQa4gw1WfNTMa1BYQtvLVH1KFA` também ficou Ready. O domínio canônico é [lojabkm.com.br](https://lojabkm.com.br/), com `www` redirecionando por 308.

## Principal migrado e continuidade

O cutover para o Supabase **BKM ecommerce** (`cxoeompxmgdzufgzxerw`) foi concluído: **40 tabelas, 230 registros e 2 objetos Storage** migrados, com SHA-256, integridade, RLS e origem inalterada conferidos. Migrations **1–7**, RLS nas 40 tabelas e zero grants de tabelas para `anon`, `authenticated` ou `PUBLIC`. Auditoria posterior: 3 usuários, 4 pedidos e 2 referências de imagens no novo Storage, nenhuma no antigo.

Vercel Production e `.env` local já usam o novo principal. O banco anterior (`nxrvmanifngjmdtgnzoq`) e o `.env.old-main` continuam preservados. A manutenção foi encerrada e HTTP 200 confirmado; `/api/config` indica demo, mock, `canCharge=false` e Google habilitado, com 15 produtos observados no catálogo. Um backup posterior do novo principal (40 tabelas/233 registros/2 objetos) foi restaurado isoladamente com integridade `ok`; detalhes em [BACKUP.md](BACKUP.md).

- Manter as cópias e a configuração anterior preservadas até encerrar a janela de acompanhamento e definir retenção/plano de retorno.
- Completar a prova dos fluxos no destino; migração íntegra e HTTP 200 não substituem QA funcional e visual.

## Prova online restante

- Conferir o alias histórico `bkm-tcg-demo.vercel.app`, caminhos e redirecionamentos após cada publicação.
- Completar e registrar os fluxos de cadastro por raiz e `www`, login/logout, sessão, carrinho autenticado, painel, conta, fichário, lotes, desejos, CSV e referências autorizadas em [VALIDACAO.md](VALIDACAO.md).
- Completar QA visual desktop/mobile dos novos fluxos. A tentativa anterior de QA pelo subagente não teve navegador habilitado e não gerou screenshots; isso não conta como validação visual.

## Google e recuperação por e-mail

Cliente Google e chaves Resend estão guardados privadamente e foram configurados nas variáveis Production. Ainda faltam:

- Google: o titular já fez login BKM, confirmou o vínculo explícito e conseguiu sair/entrar pelo Google na mesma conta. Foram observadas 0 coleções; não houve prova de acervo preenchido nesse teste. A audiência foi publicada como **Externo / Em produção**, com scopes básicos `openid`, `email` e `profile`. Publicação básica não equivale a verificação avançada nem comprova ausência de limites. Faltam cadastro novo, cancelamento e demais caminhos no domínio oficial; vínculo e novo login controlados não homologam todo o OAuth.
- Resend: envio e entrega de uma recuperação para o titular já foram confirmados por webhook assinado HTTP 200; replay idempotente também foi conferido, sem novo envio e sem alterar a senha. Falta exercitar a redefinição completa pelo link, invalidação de sessões e os demais modelos/automações. Preservar `NODEJS_HELPERS=0` em Production e redeploy ao alterar essa variável, conforme [DEPLOY.md](DEPLOY.md).
- Testes controlados em demonstração exigem destinatários exatos autorizados e ativação específica. Campanhas e envio indiscriminado não ficam habilitados por salvar uma chave.
- Contas exclusivamente Google não devem receber promessa de definir senha local por um formulário não suportado. A interface identifica essa limitação.

## Mercado Pago

A instalação principal permanece mock, com produção financeira desativada. O sandbox tem deployment Vercel Ready **`35ZhSh55MLGoEqW9BEaaBFLxd3pT`** e Supabase separado **`secapcqqznlokiqhojsa`**, com TLS verificado e 40 tabelas. A verificação real confirmou conta de vendedor de teste, staging/sandbox e `canCharge=false`. O banco estava vazio antes da fixture; agora existem os registros técnicos do teste.

O `--run` real criou duas orders Pix de teste de R$ 50,00 nominais: uma `APPROVED` após reconciliação e outra `PENDING`. Reservas `COMMITTED=1`/`ACTIVE=1`, estoque 2 → 1 apenas uma vez e idempotência foram comprovados. **`webhookProven=false`**: aprovação por consulta não comprova recebimento de notificação. Foi observada divergência entre aplicação emissora da order e aplicação configurada no painel, sem relação ou causa confirmadas. Falta conferir a configuração/HMAC na aplicação associada à credencial, com autenticação/MFA do titular, e provar webhook legítimo/repetido. Cartão, recusa, expiração, cancelamento e reembolso seguem pendentes. Não reutilizar o principal nem liberar produção para concluir a homologação. Detalhes em [INTEGRACOES.md](INTEGRACOES.md) e [VALIDACAO.md](VALIDACAO.md).

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
