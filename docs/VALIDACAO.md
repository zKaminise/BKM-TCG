# Validação desta entrega — 15/10/2026

## Automática

- `npm run check`: passou para os scripts de frontend, backend, CLI, build e testes.
- `npm test`: **30 testes passaram, zero falhas**. Executados com bases temporárias e servidores exclusivos em loopback.
- Cobertura: migrations idempotentes e inventário vazio; sessões/CSRF/origem/permissões; senha scrypt e bootstrap concorrente do primeiro administrador; catálogo/paginação/filtros; identificação de variantes; edição de metadados; preços e estoque no servidor; persistência por conta; cupons/frete/regiões; arquivos privados e uploads; bloqueio de checkout sem pagamento; contratos TCGdex e utilitários HMAC/idempotência.
- Regressão adicional: totais do painel calculados sobre 51 produtos, além da primeira página de 48; endereço e textos operacionais persistidos.

## Navegador

Conferência em desktop e viewport móvel de 390×844, em banco isolado de QA:

1. Logo BKM e paleta aplicadas à apresentação existente.
2. Login administrativo e navegação direta em rotas internas.
3. Consulta TCGdex: Amigos de Jornada, 001/159, Caterpie; confirmação de imagem/metadados, gravação de preço e estoque e publicação local.
4. Anúncio encontrado no catálogo e página individual com valores corretos.
5. Cadastro manual de carta como rascunho, independente da consulta externa.
6. Cadastro de produto lacrado com condição Lacrado e persistência dos valores.
7. Carrinho lateral, persistência após recarregar, foco restrito ao diálogo, Escape e retorno do foco ao acionador.
8. Busca com sugestões reais e navegação por teclado.
9. Conta exibindo consulta de pedidos vazia sem erro de rota.
10. Configuração administrativa de frete fixo por faixa de CEP e texto de envio.
11. Cotação real da API: item de teste R$ 12,34 + regra de entrega de teste R$ 5,00 = R$ 17,34; pagamento permaneceu desabilitado.

Os produtos, preços, conta administrativa e regras usados nessa conferência são dados de teste explícitos. **Não são copiados para o banco da entrega.**

## Limites da validação

Não houve cobrança, teste financeiro em sandbox, processamento de webhook financeiro ou deploy. Os testes unitários de assinatura e idempotência não comprovam integração completa com Mercado Pago. O teste de concorrência executado é do primeiro administrador; concorrência de reservas da última unidade permanece pendente com o fluxo de pedidos.

A lista de trabalho restante está em PENDENCIAS.md. Esta etapa é a base local integrada, não a conclusão integral do prompt master.
