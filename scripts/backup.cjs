const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {BackupError,sealBackup,unsealBackup,restoreSnapshot,keyBytes,objectPath}=require('../server/backup.cjs');
const root=path.resolve(__dirname,'..');
const usage='Uso: node scripts/backup.cjs create --project REFERENCIA | restore --file ARQUIVO.bkmbackup --out CAMINHO_ABSOLUTO_NOVO.sqlite | create-key';
function args(values){const options={command:values[0]};for(let index=1;index<values.length;index+=2){if(!['--project','--file','--out'].includes(values[index])||!values[index+1]||Object.hasOwn(options,values[index].slice(2)))throw new BackupError(usage);options[values[index].slice(2)]=values[index+1];}return options;}
async function storageObjects(env){
  if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw new BackupError('Configure o Storage privado antes do backup completo.');
  const base=new URL(env.SUPABASE_URL),bucket=env.SUPABASE_STORAGE_BUCKET||'bkm-public';
  if(base.protocol!=='https:'||!base.hostname.endsWith('.supabase.co')||base.pathname!=='/'||base.username||base.password||base.search||base.hash||!/^[a-z0-9][a-z0-9-]{1,62}$/.test(bucket))throw new BackupError('Configuração Storage inválida.');
  const headers={apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY};const objects=[];let bytes=0;
  async function list(prefix=''){
    for(let offset=0;;offset+=100){const response=await fetch(new URL('/storage/v1/object/list/'+bucket,base),{method:'POST',redirect:'error',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({prefix,limit:100,offset,sortBy:{column:'name',order:'asc'}}),signal:AbortSignal.timeout(30000)});if(!response.ok)throw new BackupError('Não foi possível listar os objetos do Storage.');const rows=await response.json();if(!Array.isArray(rows))throw new BackupError('Resposta Storage inválida.');for(const row of rows){const name=prefix?prefix+'/'+row.name:row.name;objectPath(name);if(!row.id){await list(name);continue;}if(objects.length>=50000||bytes>256*1024*1024)throw new BackupError('Storage excede os limites deste backup manual.');const download=await fetch(new URL('/storage/v1/object/authenticated/'+bucket+'/'+name.split('/').map(encodeURIComponent).join('/'),base),{redirect:'error',headers,signal:AbortSignal.timeout(30000)});if(!download.ok||Number(download.headers.get('content-length'))>8388608)throw new BackupError('Não foi possível copiar um objeto do Storage.');const buffer=Buffer.from(await download.arrayBuffer());bytes+=buffer.length;if(buffer.length>8388608||bytes>256*1024*1024)throw new BackupError('Storage excede os limites deste backup manual.');objects.push({name,size:buffer.length,contentType:download.headers.get('content-type')||'application/octet-stream',sha256:crypto.createHash('sha256').update(buffer).digest('hex'),base64:buffer.toString('base64')});}if(rows.length<100)break;}
  }
  await list();return objects;
}
async function snapshotPostgres(env,project){
  if(!/^[a-z]{20}$/.test(project||''))throw new BackupError('Confirme explicitamente a referência do projeto BKM.');
  const uri=new URL(env.DATABASE_URL||'postgres://missing');
  if(!['postgres:','postgresql:'].includes(uri.protocol)||uri.search||uri.hash||uri.port!=='6543'||uri.pathname!=='/postgres'||decodeURIComponent(uri.username)!=='postgres.'+project||env.SUPABASE_URL!=='https://'+project+'.supabase.co'||!uri.hostname.endsWith('.pooler.supabase.com'))throw new BackupError('A confirmação do projeto difere das configurações privadas ou a URI contém opções SSL não permitidas.');
  const {Pool}=require('pg');
  // Deliberately bypass openStore: a backup must never run application migrations.
  const pool=new Pool({connectionString:env.DATABASE_URL,max:1,connectionTimeoutMillis:10000,ssl:{rejectUnauthorized:true,...(env.DATABASE_CA_CERT?{ca:env.DATABASE_CA_CERT.replace(/\\n/g,'\n')}:{})}}),client=await pool.connect();
  try{
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query("SET LOCAL statement_timeout='60s'");
    const allowed=new Set(['bkm_migrations']);for(const file of fs.readdirSync(path.join(root,'server/migrations')).filter(name=>/^\d+.*\.sql$/.test(name))){const sql=fs.readFileSync(path.join(root,'server/migrations',file),'utf8');for(const match of sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?([a-z_][a-z_0-9]*)/gi))allowed.add(match[1]);}
    const found=(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row=>row.tablename).filter(name=>allowed.has(name));if(!['users','products','orders'].every(name=>found.includes(name)))throw new BackupError('O banco não contém o esquema BKM esperado.');
    const tables=[];for(const name of found){const columns=(await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",[name])).rows.map(row=>row.column_name);const references=(await client.query("SELECT ccu.table_name referenced_table FROM information_schema.table_constraints tc JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.constraint_schema=tc.constraint_schema WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public' AND tc.table_name=$1",[name])).rows.map(row=>row.referenced_table);const rows=(await client.query('SELECT * FROM public."'+name+'" LIMIT 200001')).rows;if(rows.length>200000)throw new BackupError('Uma tabela excede o limite de 200 mil registros desta ferramenta.');tables.push({name,columns,references:[...new Set(references)],rows});}
    await client.query('COMMIT');return{format:'bkm-tcg-backup',version:1,createdAt:new Date().toISOString(),project,engine:'postgres',tables,objects:await storageObjects(env)};
  }catch(error){try{await client.query('ROLLBACK');}catch{}throw error;}finally{client.release();await pool.end();}
}
async function main(values=process.argv.slice(2)){
  const options=args(values);if(!['create','restore','create-key'].includes(options.command))throw new BackupError(usage);
  require('../server/env.cjs').loadProjectEnvFile(path.join(root,'.env'));
  if(options.command==='create-key'){
    const filename=path.join(root,'.env');if(!fs.existsSync(filename))throw new BackupError('Configure primeiro o .env privado.');const source=fs.readFileSync(filename,'utf8');if(/^[ \t]*BKM_BACKUP_KEY[ \t]*=[ \t]*\S+/m.test(source)||process.env.BKM_BACKUP_KEY)throw new BackupError('Já existe uma chave. Preserve-a para restaurar os backups anteriores.');
    const assignment='BKM_BACKUP_KEY='+crypto.randomBytes(32).toString('base64');
    const updated=/^[ \t]*BKM_BACKUP_KEY[ \t]*=[ \t]*$/m.test(source)?source.replace(/^[ \t]*BKM_BACKUP_KEY[ \t]*=[ \t]*$/m,assignment):source+(source.endsWith('\n')?'':'\n')+assignment+'\n';
    const temporary=path.join(root,'.env.'+crypto.randomUUID()+'.tmp');
    try{fs.writeFileSync(temporary,updated,{flag:'wx',mode:0o600});if(fs.readFileSync(filename,'utf8')!==source)throw new BackupError('O .env mudou durante a operação. Execute novamente.');fs.renameSync(temporary,filename);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
    console.log('Chave criada no .env privado sem exibir seu valor. Guarde uma cópia separada e segura.');return;
  }
  const key=keyBytes(process.env.BKM_BACKUP_KEY);
  if(options.command==='restore'){
    if(!options.file||!options.out)throw new BackupError(usage);const snapshot=unsealBackup(fs.readFileSync(path.resolve(options.file)),key);const result=restoreSnapshot(snapshot,{filename:options.out});console.log(JSON.stringify(result));return result;
  }
  const snapshot=await snapshotPostgres(process.env,options.project),backup=sealBackup(snapshot,key),folder=path.join(root,'backups');fs.mkdirSync(folder,{recursive:true});const filename='bkm-'+new Date().toISOString().replace(/[:.]/g,'-')+'.bkmbackup';fs.writeFileSync(path.join(folder,filename),backup,{flag:'wx',mode:0o600});const result={backup:filename,tables:snapshot.tables.length,rows:snapshot.tables.reduce((sum,table)=>sum+table.rows.length,0),objects:snapshot.objects.length,encrypted:true};console.log(JSON.stringify(result));return result;
}
if(require.main===module)main().catch(error=>{console.error(error instanceof BackupError?error.message:'A operação de backup falhou. Confira a conexão e os arquivos privados; nenhum segredo foi exibido.');process.exitCode=1;});
module.exports={snapshotPostgres,storageObjects};
