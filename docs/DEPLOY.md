# Provisionamento BKM TCG

## Separação dos ambientes

Use um projeto Supabase dedicado **bkm-tcg-demo** e um projeto Vercel **bkm-tcg-demo**. Nenhuma migração ou seed deve atingir bancos de outros aplicativos. A demonstração usa `BKM_ENVIRONMENT=demo`, `PAYMENT_PROVIDER=mock`, `EMAIL_PROVIDER=development` e `HOSTING_DEMO_ONLY=true`. Um projeto comercial futuro usa outro banco, credenciais e infraestrutura compatíveis.

## Supabase Free

Crie o projeto em uma organização Free com cota disponível, preferindo região São Paulo quando oferecida. Não ative trial, add-on IPv4 ou plano pago. O dono define a senha do banco no painel; ela não deve ser enviada em chat, commit, screenshot ou log.

No diálogo **Connect**, use o **Shared pooler / Transaction**, porta 6543, recomendado para funções serverless. Salve a URI completa com senha codificada corretamente apenas em `DATABASE_URL` do `.env` privado e das variáveis de servidor Vercel. Use `BKM_DB_POOL_SIZE=1` e TLS com verificação de certificado; configure `DATABASE_CA_CERT` quando necessário. Não desative a validação de TLS.

Execute com o `.env` apontando para esse projeto:

```powershell
npm run db:migrate
npm run demo:seed
npm run storage:configure
npm run admin:create
```

O primeiro comando aplica as migrations versionadas com bloqueio transacional de migração. O segundo só popula banco vazio/demonstrativo. O terceiro cria/reutiliza um bucket público dedicado `bkm-public`, com PNG/JPEG/WebP e limite 8 MB. Reutilizar bucket privado falha explicitamente. O último cria o primeiro administrador, com senha digitada de forma oculta.

Configure também `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_STORAGE_BUCKET` no servidor. A chave de serviço não aparece no frontend, repositório ou resposta pública. Anônimos podem ler as imagens públicas; upload só é autorizado pela API administrativa. As tabelas de usuários/pedidos/sessões não têm políticas de leitura pública.

A autenticação BKM foi preservada no PostgreSQL. Não há um segundo cadastro Supabase Auth concorrendo com as sessões da loja. A recuperação de senha usa a fila de e-mails; desenvolvimento mostra apenas prévias privadas sem token útil. Para entregar recuperação por e-mail, configure Resend e domínio verificado.

Confirme no painel as tabelas `bkm_migrations`, `users`, `sessions`, `card_metadata`, `products`, `variants`, `collections`, `coupons`, `settings`, `orders`, `order_items`, `inventory_reservations`, `stock_movements`, `admin_audit`, `account_lists`, `payments`, `payment_events`, `order_history`, `addresses`, `shipments`, `password_resets`, `email_outbox`. Confira RLS, bucket e um upload real antes de considerar integração remota concluída.

O Free tem limites de banco, armazenamento, tráfego e projetos; pode ser pausado por baixa atividade. Não há rotina para gerar tráfego artificial. Planeje backups próprios e teste restauração; não presuma backups automáticos do Free. [Limites oficiais](https://supabase.com/docs/guides/platform/billing-on-supabase), [pausa de projetos](https://supabase.com/docs/guides/platform/free-project-pausing), [conexões PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres).

## Vercel

Importe `zKaminise/BKM-TCG`, branch `main`, preset **Other**, raiz `./`. O arquivo `vercel.json` define `npm run build`, saída `dist/`, API Node e fallback de rotas. Use Node 22.x. Arquivos do servidor, banco, `.env` e scripts não entram na saída estática. A API exige PostgreSQL configurado e nunca grava uploads no filesystem temporário.

Variáveis de servidor na Vercel, em ambiente dedicado de demonstração:

| Variável | Valor |
|---|---|
| `BKM_ENVIRONMENT` | `demo` |
| `HOSTING_DEMO_ONLY` | `true` |
| `PAYMENT_PROVIDER` | `mock` |
| `EMAIL_PROVIDER` | `development` |
| `BKM_PUBLIC_URL` | URL HTTPS confirmada do deploy |
| `DATABASE_URL` | Conexão privada do pooler Supabase |
| `BKM_DB_POOL_SIZE` | `1` |
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Segredo apenas do servidor |
| `SUPABASE_STORAGE_BUCKET` | `bkm-public` |

Não cadastre chaves Mercado Pago/Resend nesse projeto demonstrativo. Valores sensíveis ficam marcados como Sensitive no painel. O wrapper Vercel mantém demo como padrão até a configuração explícita de ambiente diferente; `HOSTING_DEMO_ONLY=true` impede cobranças externas.

Após deploy, confirme `/api/config`, cadastro/login, catálogo, produto, upload, checkout, pedido e administração pelo navegador. Teste refresh de rotas como `/cartas` e `/admin`. Reinicie a aplicação e valide persistência. Faça novo push e confira o novo commit implantado para provar o CI/CD. CI separado em `.github/workflows/ci.yml` executa sintaxe, testes e build sem credenciais de produção.

Vercel Hobby é restrito a uso pessoal não comercial. Esta publicação só pode demonstrar produtos e transações fictícios, sem receber vendas reais. Cotas excedidas podem interromper o serviço: não crie contas/equipes para contornar limites nem ative upgrades sem autorização. [Regras Hobby](https://vercel.com/docs/plans/hobby).

## Caminho comercial alternativo

Cloudflare Pages + Workers possui um plano Free com limites publicados e pode ser avaliado para uma operação pequena; a proposta exige adaptar a função Node HTTP e validar CPU/autenticação/conexão PostgreSQL no runtime Workers. Essa compatibilidade ainda precisa de implementação e testes antes de trocar a hospedagem. Não há migração automática ou promessa de custo zero ilimitado. [Limites Workers](https://developers.cloudflare.com/workers/platform/pricing/).

Outra opção é manter o backend Node em infraestrutura comercial compatível e servir o frontend separadamente. Nenhuma contratação foi autorizada ou realizada. Antes de habilitar operação real, valide infraestrutura, backups, regras comerciais, logística, dados empresariais, Mercado Pago sandbox e domínio Resend.
