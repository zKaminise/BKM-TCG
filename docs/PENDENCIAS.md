# Pendências externas — Fase 2

O código inclui catálogo, administração, pedidos persistidos, reservas transacionais, pagamentos simulados, Storage Supabase, migrations PostgreSQL, adaptadores Mercado Pago/Resend e configuração Vercel. O seed não contém contas ou credenciais padrão.

## Provisionamento e validação remota

- Supabase: o painel solicitou login do proprietário. Sem essa autenticação, ainda não foram criados nem verificados projeto, tabelas, bucket e dados no serviço remoto. Os testes PostgreSQL locais usam PGlite e não comprovam provisionamento Supabase.
- Vercel: projeto gratuito `bkm-tcg-demo` criado e vinculado à `main`; build e deploy da correção `0d0c271` chegaram a Ready. A URL https://bkm-tcg-demo.vercel.app foi aberta no navegador. A experiência visual está publicada; catálogo, contas e pedidos online aguardam o Supabase. A API responde 503/NOT_CONFIGURED sem banco e não usa persistência temporária. Portanto, o e-commerce online completo ainda não está concluído. O aviso de cotas excedidas da conta foi observado, mas não bloqueou esse deploy.
- Navegador local: a loja abriu e foram conferidos home, lacrados, produto e drawer. Após a retomada, as abas do usuário estavam na página de erro; o servidor foi iniciado em segundo plano em localhost:4173 e foi solicitada recarga manual porque o controle do navegador bloqueou a página de erro. Os cenários restantes precisam dessa recarga para validação visual.

## Credenciais e ativação posterior

- Mercado Pago: credenciais seguras de teste, vendedor e webhook; executar homologação real de Pix/cartão, notificações/retries, reconciliação e cenários financeiros em sandbox. A estrutura de checkout, SDK oficial tokenizado e fluxo transacional estão no código. Nenhuma cobrança externa foi realizada.
- Resend: API key, domínio e remetente verificados, URLs definitivas e testes reais de entrega. A demonstração gera somente prévias privadas; não envia e-mails externos.
- Domínio próprio: nome e acesso ao DNS ainda não fornecidos.
- Frete operacional: provedor/contrato real ainda não fornecido. Frete e rastreamento demonstrativos não contratam transporte nem geram etiquetas.
- Operação comercial: infraestrutura/plano compatíveis, backups e restauração, dados empresariais e políticas definitivas, logística e validação dos provedores. Vercel Hobby permanece apenas demonstração não comercial.

O estado executado e as evidências ficam em VALIDACAO.md. Não confundir módulos preparados, testes locais e configuração realmente confirmada em contas externas.
