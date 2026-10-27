# Entrega da auditoria de frete — 27/10/2026

## Implementado

- Editor administrativo completo para origem privada, embalagens reais/padrão, transportadora/serviço/tarifa/prazo/data por região, faixas de CEP e confirmação operacional.
- Checklist visível de configuração faltante, campos acessíveis e layout adaptável ao celular. Alterações relevantes removem a confirmação anterior.
- Validação no servidor para tipos, limites, datas, faixas e ativação segura. Nacional incompleto é indisponível; nenhuma tarifa foi estimada ou inserida.
- Independência de retirada e entrega gratuita em Uberlândia, preservadas quando o nacional está desligado.
- Cálculo após descontos, limites de CEP inclusivos e recálculo por alteração de endereço.
- Exportação pública de frete sem origem postal e embalagens privadas.
- Adaptador Melhor Envio mantém consultas somente no sandbox e agora aceita também volumes embalados reais. Declara expressamente que produção, checkout e compra de etiquetas não estão integrados.
- Guia operacional em `docs/LOGISTICA.md` com dados mínimos, fontes oficiais, custos, credenciais/ambientes e etapas restantes.

## Validação

28 testes específicos de logística aprovados em ambiente local isolado. Cobrem a API administrativa e cotação de checkout com banco temporário, as regras de cobertura/desconto/local/retirada, a privacidade do DTO/API, fixture de homologação financeira por retirada, parsing do painel e respostas simuladas do provedor externo. Nenhum teste fez compra ou chamada autenticada ao provedor real.

## Limitações concretas

- Falta origem completa, embalagens pesadas/medidas, serviços contratados e tarifas/prazos conferidos para os destinos nacionais. Manter nacional desativado até completar esses dados.
- O módulo manual não monta caixas nem calcula custo por volume/quantidade. A tabela deve ser compatível com a operação e os limites reais dos pedidos aceitos.
- Não foram encontradas configurações locais de ativação/credencial Melhor Envio em `.env`, `.env.local` ou `.env.sandbox`. Credenciais remotas não foram alteradas nem auditadas por este submódulo.
- Não existe integração Melhor Envio de produção, compra de etiquetas ou sincronização automática de rastreio de pedidos. O adaptador sandbox é uma preparação para homologação legítima.
- A conferência final no navegador e publicação pertencem à validação integrada do projeto; este relatório descreve os arquivos e testes específicos de frete, não afirma deploy isolado.
