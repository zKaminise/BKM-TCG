const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {openDatabase}=require('../server/db.cjs');
const {verifyPassword}=require('../server/auth.cjs');
const {testEnvironment}=require('../scripts/test-env.cjs');
test('bootstrap usa senha stdin, não a divulga e cria somente um admin sob concorrência',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bkm-bootstrap-')),filename=path.join(dir,'store.sqlite');
  let db=openDatabase(filename);db.close();
  const run=email=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.resolve(__dirname,'../scripts/create-admin.cjs'),'--email',email,'--name','Teste automatizado'],{env:testEnvironment(process.env,{BKM_DB_PATH:filename}),stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);child.on('error',reject);child.on('close',code=>resolve({code,output}));child.stdin.end('SafeTest1234\n');});
  try{const results=await Promise.all([run('first@example.test'),run('second@example.test')]);assert.equal(results.filter(x=>x.code===0).length,1);for(const result of results)assert.ok(!result.output.includes('SafeTest1234'));db=openDatabase(filename);const users=db.prepare("SELECT * FROM users WHERE role='ADMIN'").all();assert.equal(users.length,1);assert.notEqual(users[0].password_hash,'SafeTest1234');assert.ok(await verifyPassword('SafeTest1234',users[0].password_hash));db.close();}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
