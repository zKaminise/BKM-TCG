# BKM TCG — relatório de implementação e validação da Fase 3

Estado comprovado em **21/10/2026**. A loja e a área de coleções estão publicadas; a instalação principal permanece demonstrativa, com pagamento mock, `canCharge=false` e `noindex`. As provas financeiras abaixo ocorreram somente no sandbox separado. Este relatório não declara toda a Fase 3 ou a operação comercial concluídas.

## Acessos e funcionalidades implementadas

- Loja: [lojabkm.com.br](https://lojabkm.com.br/).
- Minha Coleção, com login: [conta/colecao](https://lojabkm.com.br/conta/colecao).
- Desejos: [conta/desejos](https://lojabkm.com.br/conta/desejos).
- Administração: [admin](https://lojabkm.com.br/admin).
- Homologação financeira isolada: [bkm-tcg-sandbox.vercel.app](https://bkm-tcg-sandbox.vercel.app/).

O e-commerce possui catálogo persistente de avulsas e lacrados, busca, filtros, organização por coleção, variantes, imagens, carrinho, cupons e checkout demonstrativo. O painel administra produtos, estoque, imagens, coleções, pedidos, banners, configurações e integrações. Pedidos e reservas têm controle transacional e idempotência. O catálogo público observado contém **15 produtos**; a administração, **16**, incluindo registros não públicos. Esses anúncios e valores de QA não são ofertas comerciais definitivas.

Logo BKM, paleta preta/vermelha/ciano/prata e animação 3D do booster com Pikachu foram preservadas. Ícones de perfil e carrinho usam SVGs locais reconhecíveis. O menu de perfil foi corrigido para permitir a navegação sem fechar antes do clique. A origem canônica e os redirecionamentos corrigiram o cadastro pela entrada `www`, preservando cookies e CSRF.

Outras correções comprovadas: endereço oficial do SDK Mercado Pago, compatibilidade integral das assinaturas de Orders com ID exato/canônico e replay unificado, interpretação segura do reembolso integral moderno e rótulo **Reembolsado** na interface. Resumos de desejos agora conservam eventos no banco e têm consumidor independente; uma preferência diária/semanal não depende apenas de um template disponível.

## Minha Coleção, avaliação e desejos

O cliente pode acompanhar coleções TCGdex, consultar checklist independente do estoque da loja, adicionar/remover cartas e manter lotes separados por quantidade, condição, idioma e variante. Há busca e filtros de identidade, condição, idioma, variante, posse e faltantes. Objetivos básicos e personalizados preservam secretas e acabamentos escolhidos; duplicatas não aumentam artificialmente o progresso de cartas distintas. Importação CSV oferece prévia, erros e confirmação idempotente; exportação conserva os lotes e custos unitários.

No QA de Heróis Excelsos, o objetivo básico confirmou **217 cartas**, o completo com secretas **295 identidades** e o personalizado com duas variantes **590 alvos**. A conta de QA conserva **9 unidades**, sendo **3 com referência manual**, total conhecido de **R$ 45,00**, e **6 sem cotação**. O custo de aquisição de R$ 55,00 fica separado da avaliação; não é lucro nem cotação de mercado.

Preços privados manuais e referências globais autorizadas são segregados, com fonte/data/BRL e cobertura explícita. O conjunto global continua vazio; nenhuma cotação foi inventada. **Não há integração licenciada com a Liga Pokémon**. Até obter autorização, a alternativa disponível é referência manual identificada ou CSV legítimo, sem scraping ou conversão estrangeira apresentada como preço brasileiro. Fotos pessoais aceitam URL HTTPS; upload privado de fotos ainda não existe. Metadados TCGdex, inclusive raridade, têm cobertura parcial.

Desejos guardam identidade e preferências mesmo sem anúncio. A correspondência revalida publicação, estoque disponível, variante, idioma e preço máximo; consentimentos e notificações internas são persistidos. **Um resumo controlado foi entregue por Resend ao único titular autorizado**, com um evento QUEUED, um e-mail SENT/DELIVERED e um callback real `email.delivered`, sem reenvio. Somente o evento de homologação teve vencimento antecipado de 22/10 às 12 UTC para 21/10, preservando a preferência de 24 horas; Run manual da Vercel causou o envio. Isso não comprova alerta imediato nem disparo natural do calendário. Preferências foram restauradas, o desejo temporário removido e pendências alheias permaneceram zero. Carrinho abandonado continua sem automação ativa.

## Estado real das integrações

| Integração | Implementação e prova | Limite atual |
| --- | --- | --- |
| Google OIDC | Cliente privado, PKCE/state/nonce, vínculo explícito e novo login na mesma conta; aplicativo básico Externo/Em produção | Cadastro Google novo, cancelamento e demais caminhos não têm prova externa completa; a conta testada tinha zero coleções |
| Resend | Domínio/remetente configurados; recuperação e resumo controlado entregues, com webhook assinado e deduplicação | Redefinição completa com mudança de senha, alerta imediato e demais modelos não estão todos homologados |
| TCGdex | Identificação, checklist, cache e metadados; funciona sem exigir anúncio da carta na BKM | Cobertura parcial e indisponibilidade externa transitória observada |
| Liga Pokémon/preços | Referências manuais privadas e globais autorizadas, com fonte e cobertura | Acesso automatizado licenciado ainda não obtido; conjunto global vazio |
| Mercado Pago | Pix aprovado/expirado, cartões OTHE/APRO tokenizados pelo Brick e reembolso integral do APRO, com GET autoritativo e recibos autenticados | Somente sandbox; pendência por cartão, cancelamento solicitado, reembolso parcial e demais cenários continuam pendentes |
| Frete | Adaptador Melhor Envio restrito a cotação/consulta sandbox, com 11 testes controlados | Sem chave e sem homologação externa; não ligado ao checkout e não compra etiquetas |

No Mercado Pago, o reembolso integral teve **um POST 201**, um reembolso concluído de **5.000 centavos**, estado local REFUNDED e **1 transição financeira + 1 recibo REFUNDED**. O APRO acumula dois recibos, aprovação e reembolso. Permaneceram **quatro pedidos sandbox, estoque zero e duas baixas**; o reembolso financeiro não repôs o produto automaticamente. O e-mail de reembolso ficou PENDING em development no sandbox, sem envio Resend. Nenhuma cobrança comercial foi realizada. Evidência e cenários restantes em [HOMOLOGACAO-MP.md](HOMOLOGACAO-MP.md).

## Infraestrutura e código validado

Repositório: [zKaminise/BKM-TCG](https://github.com/zKaminise/BKM-TCG), branch `main`. Código validado: [`fdbb91c`](https://github.com/zKaminise/BKM-TCG/commit/fdbb91c6bf24f0306c98e2fb17ed407d87bee1a6), com [CI 39642646628 aprovado](https://github.com/zKaminise/BKM-TCG/actions/runs/39642646628) e suíte de **265 testes**. Deployments Vercel Success: principal **`GRuxVzXNnseYFDWhBYD1a4TrbCij`**, sandbox **`AVSCdA9YAMiJ4LPAxdMzApFMLbVM`**. Commits apenas documentais posteriores devem ser distinguidos desse marco de código.

Principal Supabase **`cxoeompxmgdzufgzxerw`** e sandbox **`secapcqqznlokiqhojsa`** são separados. A leitura PostgreSQL confirmou **esquema 8, 41 tabelas, todas com RLS, e zero grants públicos**, com TLS verificado. O Storage administrativo usa bucket dedicado; usuários BKM existentes foram preservados, sem cadastro Supabase Auth paralelo. O banco anterior permanece preservado.

Banco/Storage, Google, Resend e corpo bruto de webhooks (`NODEJS_HELPERS=0`) estão configurados privadamente em Production; a chave do cron também. Credenciais Mercado Pago ficam apenas no sandbox. Nenhum segredo é publicado neste relatório. O cron diário está Enabled às 12 UTC; Run manual Vercel respondeu 200 e acionou o resumo controlado. A tentativa local com Bearer diferente continuou 401. O Hobby tem precisão de hora; o disparo agendado natural ainda não foi observado e não há SLA comercial.

O último backup comprovado contém **41 tabelas, 199 registros e dois objetos**, AES-256-GCM, com restauração em SQLite novo, integridade `ok` e `remoteTarget=false`. É um snapshot anterior às fixtures adicionais, não a contagem atual do banco. Backups e chaves ficam privados; rotina de retenção/cópia separada ainda é manual. Procedimento em [BACKUP.md](BACKUP.md).

## Testes, dados de QA e limites da prova

- **265 testes automatizados**, sintaxe e CI aprovados, incluindo SQLite/PGlite, coleção, propriedade, CSV, preços, fila, digest, assinaturas e guardas financeiras. Testes locais não substituem provas externas.
- **41 verificações HTTP de coleção** no domínio publicado: lotes, filtros, avaliação manual, objetivos, desejos, CSV, persistência e isolamento. Outra sessão administrativa recebeu 404 para alterações em registros pessoais alheios.
- QA HTTP de cliente e administrador: login 200, cookie Secure/HttpOnly/SameSite=Lax, origem/CSRF inválidos 403, revogação após logout do cliente 401, carrinho preservado com um item e catálogo público 15/admin 16. Raiz 200, `www` e alias 308 preservando caminho/query.
- Dois cadastros fictícios CUSTOMER pelas entradas raiz e `www`: GET canônico 200, POST canônico 201, sessão/perfil, novo login e revogação. As duas contas de QA foram preservadas: usuários do principal **3 → 5**; pedidos **4 → 4**, produtos **16 → 16**, estoque agregado **70 → 70** e fila pendente **0 → 0**. Boas-vindas ficaram FAILED/EMAIL_TEST_RECIPIENT_FORBIDDEN, sem ID no provedor: nenhum envio externo às fixtures. Conta e dados do titular foram preservados.
- Coleção conferida em viewport **390 × 844**, sem overflow horizontal. Essa captura e os testes HTTP não cobrem toda a matriz visual desktop/mobile.
- Limites registrados: TCGdex retornou 503 transitório e passou na repetição; uma credencial antiga de QA recebeu 401, sem reset. Bearer local do cron permaneceu 401, embora o Run Vercel tenha passado. Relógios dos helpers e logs Vercel divergiram; não se inferiu latência entre fontes.

## O que falta

**Dependências do titular, terceiros ou operação comercial:** obter fonte de preço licenciada; escolher e homologar frete com chave/origem/embalagens; definir dados empresariais, atendimento e políticas; usar infraestrutura elegível para comércio; instituir retenção/cópia de backups; homologar e autorizar separadamente produção financeira. Nenhuma dessas liberações foi presumida.

**QA ou implementação ainda necessários:** provar alerta imediato e observar calendário natural do cron; exercitar redefinição completa com revogação e os demais modelos de e-mail; completar caminhos Google, demais operações administrativas e matriz visual; cobrir pendência por cartão, cancelamento solicitado, reembolso parcial, repetição do POST de reembolso e demais cenários financeiros. Upload privado de fotos pessoais continua ausente; carrinho abandonado permanece desligado.

Detalhes e evidências: [VALIDACAO.md](VALIDACAO.md), [INTEGRACOES.md](INTEGRACOES.md), [DEPLOY.md](DEPLOY.md) e [PENDENCIAS.md](PENDENCIAS.md).
