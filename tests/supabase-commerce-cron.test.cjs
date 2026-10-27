'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {validateConfiguration,apply,review,FUNCTION_SQL,COMMAND}=require('../scripts/supabase-commerce-cron.cjs');
const ref='abcdefghijklmnopqrst';
const env={DATABASE_URL:'postgresql://postgres.'+ref+':isolated-fixture-password@aws-0-sa-east-1.pooler.supabase.com:6543/postgres',SUPABASE_URL:'https://'+ref+'.supabase.co',BKM_PUBLIC_URL:'https://bkm.example.test',CRON_SECRET:'isolated-private-worker-key-not-real-2026'};
function database(patch={}){
  const calls=[];
  return {calls,async query(sql,args){
    calls.push({sql,args});
    let rows=[];
    if(sql==='SELECT current_user name')rows=[{name:patch.user || 'postgres'}];
    else if(sql.includes("e.extname='pgcrypto'"))rows=[{schema:'extensions',available:true}];
    else if(sql.startsWith('SELECT extname'))rows=(patch.extensions || ['supabase_vault','pg_net','pg_cron']).map(extname=>({extname}));
    else if(sql.includes("has_table_privilege(r.rolname,'vault.decrypted_secrets'"))rows=[{role:'anon',schema_usage:true,secrets_read:!!patch.publicVault},{role:'authenticated',schema_usage:true,secrets_read:false}];
    else if(sql.startsWith('SELECT pg_get_userbyid(nspowner)'))rows=patch.schemaOwner?[{owner:patch.schemaOwner}]:[];
    else if(sql.startsWith('SELECT pg_get_userbyid(c.relowner)'))rows=patch.tableOwner?[{owner:patch.tableOwner,relkind:patch.relkind || 'r'}]:[];
    else if(sql.startsWith('SELECT pg_get_userbyid(proowner)'))rows=patch.functionOwner?[{owner:patch.functionOwner}]:[];
    else if(sql.startsWith('SELECT command,username FROM cron.job'))rows=patch.jobs || [];
    else if(sql.startsWith('SELECT cron.schedule'))rows=[{job_id:42}];
    return {rows};
  }};
}

test('helper Supabase valida projeto e domínio antes de qualquer instalação',()=>{
  assert.equal(validateConfiguration(env,{needSecret:true}).endpoint,'https://bkm.example.test/api/jobs/commerce');
  for(const patch of [{DATABASE_URL:env.DATABASE_URL.replace(ref,'zyxwvutsrqponmlkjihg')},{SUPABASE_URL:'https://attacker.example.test'},{BKM_PUBLIC_URL:'http://bkm.example.test'},{BKM_PUBLIC_URL:'https://bkm.example.test:8443'},{BKM_PUBLIC_URL:'https://bkm.example.test/path'},{BKM_PUBLIC_URL:'https://bkm.example.test?secret=x'},{CRON_SECRET:'short'}])assert.throws(()=>validateConfiguration({...env,...patch},{needSecret:true}));
  const metadata=review();assert.equal(metadata.noDeployment,true);assert.equal(metadata.noPaymentRequest,true);assert.equal(JSON.stringify(metadata).includes(env.CRON_SECRET),false);
});

test('instalação só usa bindings para chave Vault e pg_net contém apenas MAC temporário',async()=>{
  const client=database();const result=await apply(client,env,{approved:true,signatureDeploymentVerified:true});assert.equal(result.scheduled,true);assert.equal(result.jobId,42);
  const vaultWrites=client.calls.filter(call=>call.sql.startsWith('SELECT vault.create_secret'));assert.equal(vaultWrites.length,2);assert.ok(vaultWrites.some(call=>call.args[0]===env.CRON_SECRET));
  for(const call of client.calls)assert.equal(call.sql.includes(env.CRON_SECRET),false);
  const http=FUNCTION_SQL.slice(FUNCTION_SQL.indexOf('request_id := net.http_get'),FUNCTION_SQL.indexOf('INSERT INTO bkm_ops'));
  assert.match(http,/'x-bkm-job-timestamp',timestamp/);assert.match(http,/'x-bkm-job-signature',signature/);assert.equal(/signing_key|authorization|Bearer/i.test(http),false);assert.match(FUNCTION_SQL,/extensions\.hmac\(canonical,signing_key,'sha256'\)/);assert.match(FUNCTION_SQL,/SECURITY DEFINER SET search_path = ''/);
  assert.ok(client.calls.some(call=>call.sql.startsWith('REVOKE ALL ON FUNCTION')));assert.equal(client.calls.at(-1).sql,'COMMIT');
});

test('instalador recusa Vault exposto, dono incompatível e job conflitante sem sobrescrever segredos',async()=>{
  for(const patch of [{publicVault:true},{schemaOwner:'authenticated'},{tableOwner:'postgres',relkind:'v'},{tableOwner:'authenticated'},{functionOwner:'authenticated'},{jobs:[{command:COMMAND,username:'other_role'}]},{jobs:[{command:'SELECT other();',username:'postgres'}]}]){
    const client=database(patch);await assert.rejects(apply(client,env,{approved:true,signatureDeploymentVerified:true}));assert.equal(client.calls.at(-1).sql,'ROLLBACK');assert.equal(client.calls.some(call=>call.sql.startsWith('SELECT vault.create_secret')||call.sql.startsWith('SELECT vault.update_secret')),false);
  }
  const client=database();await assert.rejects(apply(client,env,{approved:true}));assert.equal(client.calls.length,0);
});
