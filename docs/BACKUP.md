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
node scripts/backup.cjs create --project cxoeompxmgdzufgzxerw
```

A referência deve corresponder explicitamente ao projeto do pooler e à `SUPABASE_URL` privados. São necessários `DATABASE_URL`, TLS verificado, `SUPABASE_URL`, chave de serviço do Storage e bucket correto. O comando aborta se não conseguir copiar banco ou objetos; não anuncia um backup parcial como completo. Só imprime nome do arquivo, contagens e confirmação da criptografia.

O backup do Storage inclui os arquivos enviados ao bucket, não os assets estáticos versionados no repositório nem imagens externas da TCGdex. Preserve também o repositório e suas versões. O utilitário atual limita cada tabela a 200 mil registros, objetos a 8 MB cada, Storage agregado a 256 MB e snapshot a 512 MB; exceder um limite interrompe a operação e exige uma estratégia adequada ao volume maior.

## Testar a restauração

```powershell
node scripts/backup.cjs restore --file "backups/NOME-DO-BACKUP.bkmbackup" --out "D:\Importante\Codex\LP Vendas TCG Site\backups\restauracao-teste.sqlite"
```

O destino precisa ser um caminho absoluto para um SQLite **novo**. O comando não aceita URL PostgreSQL como destino, não sobrescreve arquivos existentes e não restaura automaticamente em produção. Os objetos recuperados ficam ao lado, em `restauracao-teste.sqlite.objects/`, com seus caminhos preservados. O conteúdo descriptografado contém dados privados e deve ficar em diretório protegido, fora de publicação e Git.

A restauração usa o esquema instalado, ordena as tabelas pelas referências e verifica constraints, `foreign_key_check`, `integrity_check` e hashes dos objetos. Backup de versão mais recente com colunas ausentes no código instalado é recusado. Alteração do arquivo criptografado ou chave incorreta é detectada antes de restaurar dados.

## Prova executada após a migração do principal — 20/10/2026

Foi criado um novo backup completo do principal `cxoeompxmgdzufgzxerw`, já na nova conta Supabase, por transação PostgreSQL somente de leitura. O arquivo privado é `backups/bkm-2026-10-20T09-40-05-960Z.bkmbackup`: **40 tabelas, 233 registros e 2 objetos Storage**, protegido por AES-256-GCM. Estas são as contagens deste snapshot, obtido após o corte, e podem mudar com o uso da aplicação.

SHA-256 do arquivo criptografado:

```text
788A07BF39E897C38B5CDBB75DEA9EB80408A02D5A3365C3154EB5DA303CE6EF
```

Esse arquivo foi efetivamente restaurado em um SQLite novo e isolado: `backups/restore-new-main-cxoe-20261020-094005.sqlite`, com objetos em `restore-new-main-cxoe-20261020-094005.sqlite.objects/`. A restauração confirmou os hashes dos 2 objetos. Uma conferência independente, abrindo apenas esse SQLite em modo somente leitura, verificou **40 tabelas, 233 registros, versão de esquema 7, zero violações de chave estrangeira e `integrity_check=ok`**. O CLI confirmou `remoteTarget=false`: nenhum PostgreSQL recebeu restauração ou escrita nesse teste.

O backup criptografado, a restauração com dados privados e a chave permanecem fora do Git e da publicação. O hash identifica este arquivo específico; não substitui a chave privada nem demonstra uma rotina automática de retenção ou recuperação remota.

## Nova prova após o vínculo Google — 20/10/2026

Após a confirmação do vínculo e do novo login Google na conta existente, foi criada outra cópia completa do principal: `backups/bkm-2026-10-20T15-25-24-674Z.bkmbackup`, com **40 tabelas, 244 registros e 2 objetos Storage**, criptografada com **AES-256-GCM**.

SHA-256 desse novo arquivo criptografado:

```text
3D795060290F65BFCA6811F98FE5973733BD57E9FD04F4B0866835F564B240CA
```

A restauração foi efetivamente executada em um novo SQLite isolado, `backups/restore-google-linked-20261020-152524.sqlite`, com os **2 objetos** recuperados. O resultado confirmou **`restored=true`, `integrity=ok` e `remoteTarget=false`**; nenhum PostgreSQL recebeu essa restauração. Backup, SQLite restaurado, objetos e chave continuam privados e fora do Git e da publicação.

Os **230 registros transferidos na migração**, os **233 registros do backup anterior** e os **244 registros desta cópia posterior** são contagens de momentos distintos. Esta prova acrescenta um novo snapshot e não substitui nem altera as evidências anteriores.

## Prova após a migration 008 — 21/10/2026

Após publicar o esquema 8 de resumos de desejos, foi criada uma nova cópia completa do principal: `backups/bkm-2026-10-21T09-43-45-155Z.bkmbackup`, com **41 tabelas, 199 registros e 2 objetos Storage**, criptografada com **AES-256-GCM**. A leitura PostgreSQL separada confirmou 41 tabelas com RLS e zero grants públicos nos dois ambientes.

SHA-256 desse arquivo criptografado:

```text
27712CEFE92FAF01E60EC063C10EDB137E6A124B4826AE6CFCD85EA6F26222C2
```

A restauração foi efetivamente executada em um novo SQLite isolado, `backups/restore-digests-20261021-094345.sqlite`. O resultado confirmou **`restored=true`, 41 tabelas, 199 registros, 2 objetos, `integrity=ok` e `remoteTarget=false`**. Nenhum PostgreSQL recebeu essa restauração. Backup, SQLite, objetos e chave continuam privados, fora do Git e da publicação.

Os snapshots anteriores permanecem preservados. A contagem total de registros pode diminuir com a expiração de sessões e aumentar com novos dados de QA; 244 e 199 são retratos de momentos distintos, sem equivalência com quantidade de clientes ou pedidos. Esta prova não apaga nem reinterpreta os snapshots anteriores e não constitui automação de backup.

## Rotina operacional

Não há agendamento ou exclusão automática. Como política inicial manual, mantenha **sete cópias diárias e quatro semanais**, com pelo menos uma cópia em local seguro separado do computador de trabalho. Revise os arquivos e a confirmação de restauração antes de remover cópias antigas. Faça um novo teste isolado após mudanças de schema e periodicamente; apenas gerar o arquivo não comprova a capacidade de recuperação.

Os testes automatizados usam dados fictícios e verificam adulteração, chave errada, objetos binários, round-trip e constraints SQLite. Uma execução real e sua restauração precisam ser registradas separadamente com contagens e resultado, sem divulgar conteúdo ou chave.
