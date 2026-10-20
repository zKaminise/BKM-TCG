const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const MAGIC=Buffer.from('BKMTCG1\n');
const MAX_BYTES=512*1024*1024;
class BackupError extends Error{constructor(message){super(message);this.name='BackupError';}}
function keyBytes(value){const key=Buffer.isBuffer(value)?value:typeof value==='string'?Buffer.from(value,'base64'):Buffer.alloc(0);if(key.length!==32)throw new BackupError('BKM_BACKUP_KEY deve conter 32 bytes aleatórios em base64.');return key;}
function sealBackup(snapshot,key){const bytes=Buffer.from(JSON.stringify(snapshot));if(bytes.length>MAX_BYTES)throw new BackupError('O snapshot excedeu o limite de 512 MB desta ferramenta.');const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',keyBytes(key),iv);cipher.setAAD(MAGIC);const encrypted=Buffer.concat([cipher.update(zlib.gzipSync(bytes)),cipher.final()]);return Buffer.concat([MAGIC,iv,cipher.getAuthTag(),encrypted]);}
function unsealBackup(bytes,key){try{if(!Buffer.isBuffer(bytes)||bytes.length<36||bytes.length>MAX_BYTES||!bytes.subarray(0,MAGIC.length).equals(MAGIC))throw new Error();const offset=MAGIC.length,decipher=crypto.createDecipheriv('aes-256-gcm',keyBytes(key),bytes.subarray(offset,offset+12));decipher.setAAD(MAGIC);decipher.setAuthTag(bytes.subarray(offset+12,offset+28));const gzip=Buffer.concat([decipher.update(bytes.subarray(offset+28)),decipher.final()]);const snapshot=JSON.parse(zlib.gunzipSync(gzip,{maxOutputLength:MAX_BYTES}));if(snapshot.format!=='bkm-tcg-backup'||snapshot.version!==1||!Array.isArray(snapshot.tables)||!Array.isArray(snapshot.objects))throw new Error();return snapshot;}catch{throw new BackupError('Backup inválido, alterado ou chave incorreta. Nenhum dado foi restaurado.');}}
const identifier=value=>{if(typeof value!=='string'||!/^[_a-z][_a-z0-9]*$/.test(value))throw new BackupError('Identificador de tabela ou coluna inválido.');return '"'+value+'"';};
function objectPath(name){if(typeof name!=='string'||name.length>1024||name.includes('\\')||name.includes('\0')||name.split('/').some(part=>!part||part==='.'||part==='..'||/[<>:"|?*\u0000-\u001f]/.test(part)))throw new BackupError('Nome de objeto de armazenamento inválido.');return name.split('/');}
function tableOrder(tables){const names=new Set(tables.map(table=>table.name)),sorted=[],visiting=new Set(),visited=new Set();function visit(table){if(visited.has(table.name))return;if(visiting.has(table.name))throw new BackupError('Dependência cíclica exige restauração especializada.');visiting.add(table.name);for(const dependency of table.references||[])if(dependency!==table.name&&names.has(dependency))visit(tables.find(item=>item.name===dependency));visiting.delete(table.name);visited.add(table.name);sorted.push(table);}tables.forEach(visit);return sorted;}
function restoreSnapshot(snapshot,{filename}={}){
  if(!filename||!path.isAbsolute(filename))throw new BackupError('Informe um caminho absoluto para um SQLite novo e isolado.');
  const target=path.resolve(filename),objectsFolder=target+'.objects';
  if(fs.existsSync(target)||fs.existsSync(objectsFolder))throw new BackupError('O destino já existe. A restauração não sobrescreve arquivos ou bancos.');
  if(snapshot.format!=='bkm-tcg-backup'||snapshot.version!==1||!Array.isArray(snapshot.tables)||!Array.isArray(snapshot.objects)||snapshot.tables.length>100||snapshot.objects.length>50000)throw new BackupError('Estrutura do backup inválida.');
  const tables=tableOrder(snapshot.tables);for(const table of tables){identifier(table.name);if(!Array.isArray(table.columns)||!Array.isArray(table.rows))throw new BackupError('Tabela inválida.');table.columns.forEach(column=>identifier(column));}
  const objects=snapshot.objects.map(object=>{const segments=objectPath(object.name),buffer=Buffer.from(object.base64,'base64');if(buffer.length!==object.size||crypto.createHash('sha256').update(buffer).digest('hex')!==object.sha256)throw new BackupError('Objeto do backup não passou na verificação de integridade.');return{...object,segments,buffer};});
  const {openDatabase}=require('./db.cjs');let db,created=false;const written=[];
  try{
    const reserved=fs.openSync(target,'wx',0o600);fs.closeSync(reserved);created=true;db=openDatabase(target);
    const allowed=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
    if(tables.some(table=>table.name==='bkm_migrations')){db.exec('CREATE TABLE IF NOT EXISTS bkm_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)');allowed.add('bkm_migrations');}
    db.exec('BEGIN IMMEDIATE');
    // The target has just been created; remove only its default settings row.
    db.prepare('DELETE FROM settings').run();
    for(const table of tables){if(!allowed.has(table.name))throw new BackupError('O backup exige uma versão de esquema não instalada.');const columns=new Set(db.prepare('PRAGMA table_info('+identifier(table.name)+')').all().map(row=>row.name));if(table.columns.some(column=>!columns.has(column)))throw new BackupError('O esquema de destino não contém todas as colunas do backup.');const insert=db.prepare('INSERT INTO '+identifier(table.name)+'('+table.columns.map(identifier).join(',')+') VALUES('+table.columns.map(()=>'?').join(',')+')');for(const row of table.rows)insert.run(...table.columns.map(column=>row[column]??null));}
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw new BackupError('A restauração não passou na verificação de integridade referencial.');
    if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new BackupError('A restauração não passou na verificação de integridade SQLite.');
    db.exec('COMMIT');db.close();db=null;
    if(objects.length){fs.mkdirSync(objectsFolder);for(const object of objects){const output=path.join(objectsFolder,...object.segments);if(!output.startsWith(objectsFolder+path.sep))throw new BackupError('Destino de objeto inválido.');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,object.buffer,{flag:'wx',mode:0o600});written.push(output);}}
    return{restored:true,tables:tables.length,rows:tables.reduce((sum,table)=>sum+table.rows.length,0),objects:objects.length,integrity:'ok',remoteTarget:false};
  }catch(error){if(db){try{db.exec('ROLLBACK');}catch{}db.close();}if(created){try{fs.unlinkSync(target);}catch{}}for(const file of written){try{fs.unlinkSync(file);}catch{}}throw new BackupError(error instanceof BackupError?error.message:'A restauração isolada falhou. Nenhum banco remoto foi alterado.');}
}
module.exports={BackupError,sealBackup,unsealBackup,restoreSnapshot,keyBytes,objectPath,tableOrder};
