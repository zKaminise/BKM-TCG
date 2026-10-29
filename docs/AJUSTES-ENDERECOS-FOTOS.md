# Endereços, idioma/conservação e fotos — 29/10/2026

## Endereços do cliente

Em `/conta/enderecos`, o cadastro e a edição agora consultam o endpoint de CEP existente ao completar oito números. Rua, bairro, cidade e UF são preenchidos; número, complemento e alterações feitas pelo cliente durante a consulta são preservados. O formulário informa carregamento, sucesso, CEP não encontrado ou indisponibilidade e continua permitindo preenchimento manual. Há uma ação para repetir a consulta.

Respostas de CEPs anteriores são descartadas. Ao trocar o CEP, somente os campos ainda vinculados à consulta anterior são limpos. Fechar o formulário cancela a consulta. CEPs gerais sem rua/bairro recebem orientação para preenchimento manual, sem inventar esses dados.

## Idioma e conservação no produto

As opções de versão exibem bandeiras SVG locais: Brasil para português, EUA para inglês, Japão para japonês e os demais idiomas suportados. A bandeira identifica o idioma; não declara origem de fabricação. O nome do idioma permanece visível e acessível.

A conservação aparece com código destacado, nome e explicação: M, NM, SP, MP, HP, D e códigos legados. A versão selecionada tem indicação textual e `aria-pressed`; versões sem disponibilidade permanecem bloqueadas. Selados mostram o estado Lacrado, sem apresentar uma nota de conservação de carta. Os códigos de variantes, preços, estoque e fluxo do carrinho foram preservados.

## Upload e galeria

O arquivo fornecido, `IM1BOX.png`, contém WebP, apesar da extensão PNG. A validação reconhece o contêiner real PNG/JPEG/WebP e o armazenamento usa MIME e extensão correspondentes. O arquivo de 107.136 bytes foi enviado no navegador de testes, salvo como `.webp` e conferido byte a byte contra o original. Conteúdo SVG/texto, assinaturas inválidas e contêineres truncados continuam recusados.

Cada produto aceita até **cinco fotos**, por seleção múltipla de arquivos ou links HTTPS. Há prévias, remoção, movimentação e escolha da foto principal; a primeira posição define a capa. Cada arquivo aceita até 8 MB, mantendo a preparação existente para o limite de requisição da hospedagem. Uploads são individuais, sem reunir cinco arquivos no mesmo corpo de requisição.

A referência automática do catálogo ocupa uma das cinco posições. Falhas parciais preservam fotos já enviadas e campos preenchidos. Cadastros legados com mais de cinco imagens não são truncados: o painel solicita remoção explícita antes de salvar. O servidor aplica o mesmo limite e preserva a ordem da galeria verificada.

## Validação

- **493 testes aprovados** na suíte completa, incluindo SQLite/PostgreSQL, CEP, variantes, uploads, MIME/extensão, limite cinco/seis, galeria e falhas parciais; verificação de sintaxe e build aprovados.
- Navegador em SQLite isolado: consulta e persistência de endereço com número/complemento; escolha de idioma/conservação; bandeiras carregadas e ausência de excesso de largura em 390 px.
- Upload real do anexo mais uma imagem PNG, uso de links até cinco fotos, escolha da capa, criação, recarregamento e edição do anúncio; as cinco imagens e sua ordem persistiram. A galeria pública e suas miniaturas também foram conferidas no ambiente isolado.
- O endpoint de CEP da produção respondeu ao CEP informado pelo proprietário com rua, bairro, Uberlândia e MG.

Não houve criação de produto de teste, alteração de estoque, cobrança ou envio de e-mail no banco comercial. Os registros de teste ficaram no SQLite privado. Não há migração, dependência ou nova credencial necessária para esta entrega.
