# Ativação comercial — BKM TCG

A demonstração está publicada em [bkm-tcg-demo.vercel.app](https://bkm-tcg-demo.vercel.app/), com PostgreSQL e Storage Supabase conectados. Banco persistente, login administrativo, catálogo, importação TCGdex, upload remoto, checkout móvel e concorrência de estoque foram verificados. O estado executado e seus limites estão em [VALIDACAO.md](VALIDACAO.md).

As dependências abaixo se referem à operação comercial futura:

- **Mercado Pago:** configurar credenciais seguras de teste, vendedor e webhook em ambiente separado; homologar Pix/cartão, notificações, retries, reconciliação e cenários financeiros em sandbox. Adaptadores, checkout tokenizado e fluxo transacional estão implementados. Não houve cobrança externa.
- **Resend:** configurar API key, domínio e remetente verificados, URLs definitivas e testes reais de entrega. A demonstração gera prévias privadas e não envia e-mail externo.
- **Domínio próprio:** definir o nome e disponibilizar acesso ao DNS para configuração.
- **Frete operacional:** definir provedor/contrato e validar preços, prazos, etiquetas e rastreamento reais. A demonstração não contrata transporte nem gera etiquetas.
- **Operação comercial:** adotar infraestrutura/plano compatíveis, rotinas de backup e restauração testadas, dados empresariais, políticas definitivas e logística. Vercel Hobby permanece exclusivamente demonstrativo e não comercial.

Nenhuma senha, chave de serviço ou conexão privada deve ser enviada em chat, incluída em documentação pública ou versionada. Configurações sensíveis ficam nos ambientes privados do servidor.
