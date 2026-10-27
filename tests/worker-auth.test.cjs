'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {workerAuthorized,commerceJobSignature,COMMERCE_JOB_PATH,EMAIL_JOB_PATH}=require('../server/worker-auth.cjs');
const {commerceJobAuthorized}=require('../server/commerce-job.cjs');
const secret='isolated-worker-signing-key-not-real-2026';
const clock=1793000000000;
const ts=String(clock/1000);
const sign=(timestamp=ts,message)=>crypto.createHmac('sha256',secret).update(message || 'bkm-commerce-job:v1\n'+timestamp+'\nGET\n/api/jobs/commerce').digest('hex');
const headers=(timestamp=ts)=>({'x-bkm-job-timestamp':timestamp,'x-bkm-job-signature':sign(timestamp)});
const options={path:COMMERCE_JOB_PATH,method:'GET',now:clock};

test('assinatura do worker usa HMAC canônico, segundos e limite de 90 segundos nos dois sentidos',()=>{
  assert.equal(commerceJobSignature(secret,ts),sign());
  assert.equal(workerAuthorized(headers(),{CRON_SECRET:secret},options),true);
  for(const offset of [-90000,90000])assert.equal(workerAuthorized(headers(String((clock+offset)/1000)),{CRON_SECRET:secret},options),true);
  for(const offset of [-91000,91000])assert.equal(workerAuthorized(headers(String((clock+offset)/1000)),{CRON_SECRET:secret},options),false);
  for(const now of [clock-90001,clock+90001,NaN,Infinity])assert.equal(workerAuthorized(headers(),{CRON_SECRET:secret},{...options,now}),false);
});

test('MAC do worker rejeita caminho, método, versão, relógio e cabeçalhos adulterados',()=>{
  for(const path of [EMAIL_JOB_PATH,'/api/jobs/commerce/','/api/account/orders','/api/jobs/commerce?secret=x'])assert.equal(commerceJobAuthorized(headers(),{CRON_SECRET:secret},{...options,path}),false);
  for(const method of ['POST','HEAD','get'])assert.equal(workerAuthorized(headers(),{CRON_SECRET:secret},{...options,method}),false);
  for(const message of ['bkm-commerce-job:v2\n'+ts+'\nGET\n/api/jobs/commerce','bkm-commerce-job:v1\n'+ts+'\nPOST\n/api/jobs/commerce','bkm-commerce-job:v1\n'+ts+'\nGET\n/api/jobs/email'])assert.equal(workerAuthorized({...headers(),'x-bkm-job-signature':sign(ts,message)},{CRON_SECRET:secret},options),false);
  for(const patch of [{'x-bkm-job-timestamp':String(clock)},{'x-bkm-job-timestamp':[ts]},{'x-bkm-job-timestamp':ts+', '+ts},{'x-bkm-job-signature':'0'.repeat(64)},{'x-bkm-job-signature':[sign()]},{'x-bkm-job-signature':sign().toUpperCase()},{'x-bkm-job-signature':undefined}])assert.equal(workerAuthorized({...headers(),...patch},{CRON_SECRET:secret},options),false);
  for(const env of [{},null,{CRON_SECRET:'short'},{CRON_SECRET:secret+'x'}])assert.equal(workerAuthorized(headers(),env,options),false);
  assert.equal(workerAuthorized(null,{CRON_SECRET:secret},options),false);
  assert.equal(commerceJobAuthorized({authorization:'Bearer '+secret},{CRON_SECRET:secret}),true,'Bearer existente continua compatível');
  assert.equal(workerAuthorized({authorization:'Bearer '+secret},{CRON_SECRET:secret},{...options,method:'POST'}),true,'o handler mantém 405 para método incorreto com Bearer autenticado');
});

test('Vercel rejeita HMAC inválido antes do banco; HMAC válido alcança somente a barreira de manutenção',async()=>{
  const names=['CRON_SECRET','BKM_MAINTENANCE_MODE','DATABASE_URL','BKM_PUBLIC_URL'],previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  Object.assign(process.env,{CRON_SECRET:secret,BKM_MAINTENANCE_MODE:'true',DATABASE_URL:'postgres://invalid:invalid@192.0.2.1/never-connect',BKM_PUBLIC_URL:'https://bkm.example.test'});
  try{
    const {default:handler}=await import('../api/index.js');
    const timestamp=String(Math.floor(Date.now()/1000)),valid=headers(timestamp);
    for(const request of [
      {url:COMMERCE_JOB_PATH,method:'GET',headers:{...valid,'x-bkm-job-signature':'f'.repeat(64)}},
      {url:EMAIL_JOB_PATH,method:'GET',headers:valid},
      {url:COMMERCE_JOB_PATH,method:'POST',headers:valid},
      {url:COMMERCE_JOB_PATH,method:'GET',headers:headers(String(Number(timestamp)-100))},
      {url:COMMERCE_JOB_PATH,method:'GET',headers:headers(String(Number(timestamp)+100))}
    ]){
      let status,body;await handler(request,{writeHead(code){status=code;},end(raw){body=JSON.parse(raw);}});
      assert.equal(status,401);assert.equal(body.error.code,'JOB_UNAUTHORIZED');assert.equal(JSON.stringify(body).includes(secret),false);
    }
    let status,body;await handler({url:COMMERCE_JOB_PATH,method:'GET',headers:valid},{writeHead(code){status=code;},end(raw){body=JSON.parse(raw);}});
    assert.equal(status,503);assert.equal(body.error.code,'MAINTENANCE');
  }finally{for(const [name,value]of Object.entries(previous))if(value===undefined)delete process.env[name];else process.env[name]=value;}
});
