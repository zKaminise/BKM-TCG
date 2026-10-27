'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
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

test('função SQL publicada aceita chaves de 32 e 256 caracteres e recusa limites inválidos no PostgreSQL',async t=>{
  const db=new PGlite();t.after(()=>db.close());
  // Execute the exported function itself. Only Vault, crypto and HTTP are
  // isolated local substitutes; PostgreSQL parses and evaluates its real guard.
  await db.exec(`CREATE SCHEMA bkm_ops;CREATE SCHEMA vault;CREATE SCHEMA extensions;CREATE SCHEMA net;
    CREATE TABLE bkm_ops.commerce_worker_requests(request_id bigint PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE vault.decrypted_secrets(name text PRIMARY KEY,decrypted_secret text);
    CREATE TABLE net.fixture_requests(id bigserial PRIMARY KEY,url text,headers jsonb,timeout_ms integer);
    CREATE FUNCTION extensions.hmac(text,text,text) RETURNS bytea LANGUAGE sql AS $$ SELECT decode(repeat('ab',32),'hex') $$;
    CREATE FUNCTION net.http_get(url text,headers jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$
      DECLARE issued bigint;BEGIN
        INSERT INTO net.fixture_requests(url,headers,timeout_ms) VALUES(url,headers,timeout_milliseconds) RETURNING id INTO issued;
        RETURN issued;
      END $$;`);
  await db.query('INSERT INTO vault.decrypted_secrets VALUES($1,$2)',['bkm_commerce_worker_url','https://bkm.example.test/api/jobs/commerce']);
  await db.exec(FUNCTION_SQL);
  for(const key of ['a'.repeat(32),'a'.repeat(256),'a'.repeat(31),'a'.repeat(257),'a'.repeat(31)+'!','a'.repeat(31)+'\n',null]){
    await db.exec('DELETE FROM bkm_ops.commerce_worker_requests;DELETE FROM net.fixture_requests;');
    await db.query('INSERT INTO vault.decrypted_secrets VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET decrypted_secret=excluded.decrypted_secret',['bkm_commerce_cron_secret',key]);
    if(key!==null&&[32,256].includes(key.length)&&/^a+$/.test(key)){
      const result=await db.query('SELECT bkm_ops.invoke_commerce_worker() request_id');assert.ok(result.rows[0].request_id);
      const request=(await db.query('SELECT * FROM net.fixture_requests')).rows;assert.equal(request.length,1);assert.equal(request[0].url,'https://bkm.example.test/api/jobs/commerce');assert.equal(request[0].timeout_ms,45000);assert.match(request[0].headers['x-bkm-job-timestamp'],/^\d{10}$/);assert.match(request[0].headers['x-bkm-job-signature'],/^[a-f0-9]{64}$/);assert.equal(JSON.stringify(request[0]).includes(key),false);
    }else{
      await assert.rejects(db.query('SELECT bkm_ops.invoke_commerce_worker()'),/Commerce worker configuration unavailable/);
      assert.equal((await db.query('SELECT COUNT(*) count FROM net.fixture_requests')).rows[0].count,0);
    }
  }
});
