const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {sealBackup,unsealBackup,restoreSnapshot}=require('../server/backup.cjs');
function fixture(){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'bkm-backup-test-'));assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep));return folder;}
function snapshot(){const stamp=new Date().toISOString(),bytes=Buffer.from([0,1,2,255,254,128,0]);return{format:'bkm-tcg-backup',version:1,createdAt:stamp,engine:'postgres',tables:[{name:'users',columns:['id','email','name','password_hash','role','created_at'],references:[],rows:[{id:'user-backup',email:'fixture@example.test',name:'Cliente de teste',password_hash:'unusable-fixture',role:'CUSTOMER',created_at:stamp}]},{name:'variants',columns:['id','product_id','language','condition','finish','price_cents','stock','active'],references:['products'],rows:[{id:'variant-backup',product_id:'product-backup',language:'pt',condition:'NM',finish:'HOLO',price_cents:990,stock:2,active:1}]},{name:'products',columns:['id','slug','kind','name','description','sku','tcg','set_id','set_name','images_json','attributes_json','search_text','featured','published','archived','created_at','updated_at'],references:[],rows:[{id:'product-backup',slug:'backup-product',kind:'SINGLE',name:'Carta fictícia',description:'Teste isolado',sku:'BACKUP-FIXTURE',tcg:'pokemon',set_id:'fixture',set_name:'Fixture',images_json:'[]',attributes_json:'{}',search_text:'fixture',featured:0,published:1,archived:0,created_at:stamp,updated_at:stamp}]}],objects:[{name:'fixture/preview.webp',size:bytes.length,contentType:'image/webp',sha256:crypto.createHash('sha256').update(bytes).digest('hex'),base64:bytes.toString('base64')}]};}
test('Backup criptografado detecta adulteração/chave errada antes de qualquer restauração',()=>{
  const key=crypto.randomBytes(32),source=snapshot(),sealed=sealBackup(source,key);
  assert.equal(sealed.includes(Buffer.from('fixture@example.test')),false);
  const tampered=Buffer.from(sealed);tampered[tampered.length-1]^=1;
  assert.throws(()=>unsealBackup(tampered,key),/alterado ou chave incorreta/);
  assert.throws(()=>unsealBackup(sealed,crypto.randomBytes(32)),/alterado ou chave incorreta/);
  assert.deepEqual(unsealBackup(sealed,key),source);
});
test('Backup restaura SQLite NOVO com objetos idênticos, FK/CHECK e sem sobrescrever destino',()=>{
  const folder=fixture(),filename=path.join(folder,'restored.sqlite'),key=crypto.randomBytes(32),source=snapshot();
  try{
    const restored=restoreSnapshot(unsealBackup(sealBackup(source,key),key),{filename});assert.equal(restored.integrity,'ok');assert.equal(restored.remoteTarget,false);assert.equal(restored.objects,1);
    assert.deepEqual(fs.readFileSync(filename+'.objects/fixture/preview.webp'),Buffer.from(source.objects[0].base64,'base64'));
    const db=new DatabaseSync(filename);db.exec('PRAGMA foreign_keys=ON');assert.equal(db.prepare('SELECT stock FROM variants WHERE id=?').get('variant-backup').stock,2);assert.equal(db.prepare('SELECT email FROM users').get().email,'fixture@example.test');
    assert.throws(()=>db.prepare('UPDATE variants SET stock=-1 WHERE id=?').run('variant-backup'),/CHECK/);
    assert.throws(()=>db.prepare('UPDATE variants SET product_id=? WHERE id=?').run('missing-product','variant-backup'),/FOREIGN KEY/);db.close();
    assert.throws(()=>restoreSnapshot(source,{filename}),/destino já existe/);
    const broken=snapshot();broken.tables.find(table=>table.name==='variants').rows[0].product_id='missing-product';const bad=path.join(folder,'invalid.sqlite');assert.throws(()=>restoreSnapshot(broken,{filename:bad}));assert.equal(fs.existsSync(bad),false);
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
