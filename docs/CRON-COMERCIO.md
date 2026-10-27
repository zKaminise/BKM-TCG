# Consumidor operacional de pedidos e e-mails

O agendamento de um minuto usa **Supabase Cron (`pg_cron`) e `pg_net`**, chamando `GET /api/jobs/commerce` no domínio canônico da loja. A função continua na Vercel Hobby. O `vercel.json` mantém somente o cron diário `/api/jobs/email`, `0 12 * * *`, compatível com Hobby. Não é necessário agendar um cron de um minuto na Vercel. Referências: [Supabase Cron](https://supabase.com/docs/guides/cron), [pg_net](https://supabase.com/docs/guides/database/extensions/pg_net) e [limites Vercel](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Autenticação

`CRON_SECRET` é uma chave privada de 32–256 caracteres base64url, compartilhada pelo servidor Vercel e por uma entrada dedicada no Supabase Vault. A função SQL calcula HMAC-SHA256 sobre estes bytes UTF-8, sem quebra final:

```text
bkm-commerce-job:v1
{timestamp em segundos Unix}
GET
/api/jobs/commerce
```

O request leva somente `x-bkm-job-timestamp` e `x-bkm-job-signature` (hexadecimal minúsculo). A assinatura vale apenas para GET nesse caminho e diferença máxima de 90 segundos entre os relógios. A chave nunca entra no comando cron, na URL ou nos headers enfileirados por `pg_net`. A autenticação é rejeitada antes de abrir o banco. Query string, sessão administrativa e User-Agent não autorizam execução. Respostas não incluem destinatários, pedidos ou credenciais.

`Authorization: Bearer <CRON_SECRET>` permanece compatível com o cron diário da Vercel. Não use esse header no job `pg_net`; não copie a chave para comandos, URLs ou logs. Repetições na janela curta continuam sujeitas à idempotência financeira e aos leases da outbox.

## Inspeção e instalação

Use o `.env` privado do projeto pretendido com `DATABASE_URL`, `SUPABASE_URL`, `BKM_PUBLIC_URL` e `CRON_SECRET`. A chave deve coincidir com o Secret de Production na Vercel. O domínio canônico deve ser HTTPS, sem porta, caminho ou parâmetros. Nenhuma credencial entra no repositório.

```powershell
node --env-file=.env scripts/supabase-commerce-cron.cjs --review
node --env-file=.env scripts/supabase-commerce-cron.cjs --inspect
```

`--review` mostra somente o plano e o hash da função SQL. `--inspect` usa transação somente leitura e mostra extensões, privilégios efetivos, jobs e códigos HTTP recentes, sem ler valores do Vault nem corpos de respostas. A conexão é validada contra o projeto Supabase informado.

Publique a implementação HMAC antes da instalação. Confirme 401 para assinatura inválida e valide uma execução assinada no endpoint publicado. A execução válida processa pedidos vencidos e mensagens pendentes; não é uma consulta sem efeitos. Mantenha chave e assinatura fora de registros públicos dessa validação.

Depois da inspeção revisada e do deployment validado:

```powershell
node --env-file=.env scripts/supabase-commerce-cron.cjs --apply --confirm-reviewed-scheduler --confirm-signature-deployment
```

Se apenas `pg_cron` ou `pg_net` estiver ausente, acrescente `--enable-extensions` depois de revisar sua ativação. Vault e `extensions.hmac(text,text,text)` do `pgcrypto` já devem existir. O helper não ativa planos pagos nem publica deployments.

A instalação exige `postgres`, recusa objetos operacionais ou jobs de outro proprietário e recusa Vault legível por `anon` ou `authenticated`. Não altera privilégios compartilhados do Vault para contornar bloqueios. Usa bindings para atualizar somente `bkm_commerce_cron_secret` e `bkm_commerce_worker_url`. A função `SECURITY DEFINER` tem `search_path` vazio, schema privado e execução concedida apenas a `postgres`.

`bkm-commerce-worker-minute` executa `SELECT bkm_ops.invoke_commerce_worker();` a cada minuto. A função impede novo enfileiramento durante 50 segundos, usa timeout HTTP de 45 segundos e conserva registros operacionais por dois dias. Rode `--inspect` novamente para verificar execuções e retornos HTTP. Sucesso do cron SQL confirma enfileiramento; confirme também HTTP 200 e os contadores do worker.

## Trabalho e limites

O worker processa até três lotes de um pedido por vez para expirar reservas de 15 minutos, reconciliar pagamentos e tentar cancelar cobranças pendentes. Depois processa até 12 mensagens, com um claim por vez. Sua janela cooperativa total é de 40 segundos: até 25 segundos para a fase financeira e o restante para outbox e finalização. Cada chamada MP/Resend respeita o timeout e o prazo compartilhado. O teto Vercel permanece em 60 segundos; nenhuma operação financeira fica destacada depois da resposta.

`pending`, `retried`, `errors` e `bounded` indicam trabalho persistente para uma execução posterior. Aceitação pela API de e-mail não comprova entrega na caixa. Repetições preservam a idempotência financeira, do estoque e das notificações.

O prazo interno de 15 minutos não garante cancelamento remoto nesse instante. O Pix da Orders API mantém o mínimo remoto de 30 minutos; o consumidor tenta cancelar a cobrança pendente após o prazo interno. Rede, backlog e indisponibilidade podem atrasar o processamento. Aprovação tardia sem reserva utilizável entra em `PAYMENT_REVIEW`, preservando o fato financeiro sem prometer estoque. Eventual reembolso continua operacional.

Supabase Free + Vercel Hobby não fornece SLA rígido de execução. Projetos Supabase Free estão sujeitos a pausa por inatividade; enquanto o banco estiver pausado, cron e aplicação não funcionarão. Não use o scheduler para contornar essa política. A [página de planos Supabase](https://supabase.com/pricing) descreve a pausa após uma semana de inatividade e os limites atuais.

O gerador opcional `configure-commerce-cron.cjs --confirm-pro-plan` continua disponível para uma futura configuração Pro. Não substitua a configuração ativa no Hobby. Testes automatizados usam bancos isolados e provedores simulados; não instalam scheduler remoto, não cobram pagamentos e não enviam e-mails reais.
