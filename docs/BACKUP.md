# Backup criptografado e restauração isolada

O CLI manual exporta as tabelas conhecidas da BKM no PostgreSQL configurado e os arquivos enviados ao bucket Supabase. Ele utiliza `pg` diretamente, em transação **REPEATABLE READ READ ONLY**: não inicializa o store da aplicação, não roda migrations e não altera o banco remoto.

O arquivo reúne JSON, objetos binários e seus hashes SHA-256, comprimidos com gzip e criptografados com **AES-256-GCM**, IV aleatório e autenticação do conteúdo. Backups ficam em `backups/`, já ignorado pelo Git. Dados de usuários, sessões e pedidos permanecem dentro do arquivo criptografado; não são impressos no terminal.

## Preparar a chave privada

```powershell
node scripts/backup.cjs create-key
```

Esse comando gera 32 bytes aleatórios em `BKM_BACKUP_KEY` no `.env` existente, sem revelar seu valor. Ele recusa substituir uma chave já configurada e preserva as demais configurações. Guarde uma cópia separada e segura dessa chave, com acesso restrito. A perda da chave impede a restauração. Não a inclua no Git, chat, screenshots ou no mesmo pacote público do código.

## Criar o backup

```powershell
node scripts/backup.cjs create --project nxrvmanifngjmdtgnzoq
```

A referência deve corresponder explicitamente ao projeto do pooler e à `SUPABASE_URL` privados. São necessários `DATABASE_URL`, TLS verificado, `SUPABASE_URL`, chave de serviço do Storage e bucket correto. O comando aborta se não conseguir copiar banco ou objetos; não anuncia um backup parcial como completo. Só imprime nome do arquivo, contagens e confirmação da criptografia.

O backup do Storage inclui os arquivos enviados ao bucket, não os assets estáticos versionados no repositório nem imagens externas da TCGdex. Preserve também o repositório e suas versões. O utilitário atual limita cada tabela a 200 mil registros, objetos a 8 MB cada, Storage agregado a 256 MB e snapshot a 512 MB; exceder um limite interrompe a operação e exige uma estratégia adequada ao volume maior.

## Testar a restauração

```powershell
node scripts/backup.cjs restore --file "backups/NOME-DO-BACKUP.bkmbackup" --out "D:\Importante\Codex\LP Vendas TCG Site\backups\restauracao-teste.sqlite"
```

O destino precisa ser um caminho absoluto para um SQLite **novo**. O comando não aceita URL PostgreSQL como destino, não sobrescreve arquivos existentes e não restaura automaticamente em produção. Os objetos recuperados ficam ao lado, em `restauracao-teste.sqlite.objects/`, com seus caminhos preservados. O conteúdo descriptografado contém dados privados e deve ficar em diretório protegido, fora de publicação e Git.

A restauração usa o esquema instalado, ordena as tabelas pelas referências e verifica constraints, `foreign_key_check`, `integrity_check` e hashes dos objetos. Backup de versão mais recente com colunas ausentes no código instalado é recusado. Alteração do arquivo criptografado ou chave incorreta é detectada antes de restaurar dados.

## Rotina operacional

Não há agendamento ou exclusão automática. Como política inicial manual, mantenha **sete cópias diárias e quatro semanais**, com pelo menos uma cópia em local seguro separado do computador de trabalho. Revise os arquivos e a confirmação de restauração antes de remover cópias antigas. Faça um novo teste isolado após mudanças de schema e periodicamente; apenas gerar o arquivo não comprova a capacidade de recuperação.

Os testes automatizados usam dados fictícios e verificam adulteração, chave errada, objetos binários, round-trip e constraints SQLite. Uma execução real e sua restauração precisam ser registradas separadamente com contagens e resultado, sem divulgar conteúdo ou chave.
