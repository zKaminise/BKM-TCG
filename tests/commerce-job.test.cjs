'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {once}=require('node:events');
const {PGlite}=require('@electric-sql/pglite');
const {createServer}=require('../serve.cjs');
const {createCommerceJob,commerceJobAuthorized,COMMERCE_JOB_PATH}=require('../server/commerce-job.cjs');
const {MercadoPagoPaymentProvider}=require('../server/payments.cjs');
const {ResendEmailProvider,renderEmail}=require('../server/email.cjs');
const {main:configureCron}=require('../scripts/configure-commerce-cron.cjs');
const uid=()=>crypto.randomUUID();
const secret='isolated-commerce-scheduler-secret-not-real';

test('worker comercial rejeita requisições antes de abrir banco e antes da manutenção',async()=>{
  const original={CRON_SECRET:process.env.CRON_SECRET,BKM_MAINTENANCE_MODE:process.env.BKM_MAINTENANCE_MODE,DATABASE_URL:process.env.DATABASE_URL,BKM_PUBLIC_URL:process.env.BKM_PUBLIC_URL};
  Object.assign(process.env,{CRON_SECRET:secret,BKM_MAINTENANCE_MODE:'true',DATABASE_URL:'postgres://invalid:invalid@192.0.2.1:5432/never-connect',BKM_PUBLIC_URL:'https://bkm.example.test'});
  try{
    const {default:handler}=await import('../api/index.js');
    for(const headers of [{},{authorization:'Bearer wrong-secret'},{'user-agent':'vercel-cron/1.0',cookie:'admin=1'}]){
      let status,body;await handler({url:COMMERCE_JOB_PATH+'?secret='+secret,method:'GET',headers},{writeHead(code){status=code;},end(raw){body=JSON.parse(raw);}});assert.equal(status,401);assert.equal(body.error.code,'JOB_UNAUTHORIZED');assert.equal(JSON.stringify(body).includes(secret),false);
    }
    let status,headers;await handler({url:COMMERCE_JOB_PATH,method:'POST',headers:{authorization:'Bearer '+secret}},{writeHead(code,value){status=code;headers=value;},end(){}});assert.equal(status,405);assert.equal(headers.Allow,'GET');
    assert.equal(commerceJobAuthorized({authorization:'Bearer '+secret},{CRON_SECRET:secret}),true);assert.equal(commerceJobAuthorized({authorization:'Bearer '+secret},{}),false);
  }finally{for(const [key,value]of Object.entries(original))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});

test('prazo e quantidade são compartilhados por expiração e outbox; erros não expõem detalhes',async()=>{
  let current=100000,expiryCalls=0,emailCalls=0;
  const job=createCommerceJob({now:()=>current,async expireOrders({limit,deadlineAt}){assert.equal(limit,1);assert.equal(deadlineAt,125000);expiryCalls++;current+=12000;return {expired:1,reconciled:0,cancelled:0,pending:0};},async flushEmails({limit,deadlineAt}){assert.equal(limit,1);assert.equal(deadlineAt,138500);emailCalls++;current+=7000;return{processed:1,sent:1};}});
  const result=await job();assert.equal(expiryCalls,2);assert.equal(emailCalls,2);assert.equal(result.durationMs,38000);assert.equal(result.bounded,true);assert.ok(result.durationMs<=40000);
  current=0;expiryCalls=0;emailCalls=0;const capped=createCommerceJob({now:()=>current,async expireOrders(){expiryCalls++;return{expired:1};},async flushEmails(){emailCalls++;return{processed:1,previewed:1};}});const cappedResult=await capped();assert.equal(expiryCalls,3);assert.equal(emailCalls,12);assert.equal(cappedResult.bounded,true);
  const failed=createCommerceJob({async expireOrders(){throw new Error('private-token-or-customer');},async flushEmails(){return{processed:0};}});const failedResult=await failed();assert.equal(failedResult.ok,false);assert.deepEqual(failedResult.errors,[{phase:'expiry',code:'COMMERCE_EXPIRY_DEFERRED'}]);assert.equal(JSON.stringify(failedResult).includes('private-token-or-customer'),false);
});

test('gerador exige confirmação Pro e nunca sobrescreve cron ativo ou arquivo existente',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bkm-cron-'));
  try{const original=JSON.stringify({crons:[{path:'/api/jobs/email',schedule:'0 12 * * *'}],functions:{'api/index.js':{maxDuration:60}},rewrites:[{source:'/api/:path*',destination:'/api/index'}]});fs.writeFileSync(path.join(dir,'vercel.json'),original);
    assert.throws(()=>configureCron(['--output','candidate.json'],dir),/Pro/);assert.equal(fs.existsSync(path.join(dir,'candidate.json')),false);
    assert.throws(()=>configureCron(['--confirm-pro-plan','--output','vercel.json'],dir),/sobrescrita/);configureCron(['--confirm-pro-plan','--output','candidate.json'],dir);const next=JSON.parse(fs.readFileSync(path.join(dir,'candidate.json'),'utf8'));assert.deepEqual(next.crons,[{path:'/api/jobs/email',schedule:'0 12 * * *'},{path:'/api/jobs/commerce',schedule:'* * * * *'}]);assert.equal(next.functions['api/index.js'].maxDuration,60);assert.equal(fs.readFileSync(path.join(dir,'vercel.json'),'utf8'),original);assert.throws(()=>configureCron(['--confirm-pro-plan','--output','candidate.json'],dir),/exist/i);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

for(const engine of ['sqlite','postgres'])test('worker autenticado expira e consome outbox sem navegação, repetição ou sessão: '+engine,async t=>{
  const pg=engine==='postgres'?new PGlite():null,pgClient=pg?{query:async(sql,args)=>args?.length?pg.query(sql,args):(await pg.exec(sql)).at(-1),end:()=>pg.close()}:undefined;
  const server=createServer({dbPath:':memory:',databaseUrl:'',pgClient,env:{BKM_ENVIRONMENT:'demo',PAYMENT_PROVIDER:'mock',EMAIL_PROVIDER:'development',CRON_SECRET:secret,BKM_PUBLIC_URL:'https://bkm.example.test'}});await server.api.ready;server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.api.close();});
  const db=server.api.asyncStore,old=new Date(Date.now()-20*60000).toISOString(),userId=uid();await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,'buyer@example.test','Teste','not-used','CUSTOMER',?)").run(userId,old);
  const ids=[];
  for(let index=0;index<2;index++){
    const id=uid(),product=uid(),variant=uid(),payment='mock_'+crypto.randomBytes(16).toString('hex');ids.push(id);await db.prepare("INSERT INTO products(id,slug,kind,name,description,sku,tcg,set_id,set_name,images_json,search_text,published,created_at,updated_at) VALUES(?,?,'SEALED','Teste','Fixture',?,'pokemon','','','[]','test',1,?,?)").run(product,'unit-'+product,'UNIT-'+product,old,old);await db.prepare("INSERT INTO variants(id,product_id,language,condition,finish,price_cents,stock) VALUES(?,?,'pt','SEALED','NORMAL',10000,1)").run(variant,product);
    await db.prepare("INSERT INTO orders(id,user_id,status,payment_status,shipping_status,currency,subtotal_cents,discount_cents,shipping_cents,total_cents,address_json,idempotency_key,created_at,updated_at,number,environment,contact_json) VALUES(?,?,'PENDING','PENDING','UNFULFILLED','BRL',10000,0,0,10000,'{}',?,?,?,?,'demo',?)").run(id,userId,'job-'+id,old,old,'DEMO-'+id,JSON.stringify({name:'Teste',email:'buyer@example.test'}));await db.prepare('INSERT INTO order_items VALUES(?,?,?,?,?,?,1,10000,10000)').run(uid(),id,variant,'Teste','TEST','{}');await db.prepare("INSERT INTO inventory_reservations VALUES(?,?,?,1,'ACTIVE',?,?)").run(uid(),variant,id,Date.now()-1000,old);await db.prepare("INSERT INTO payments VALUES(?,?,'mock','PENDING',10000,'BRL','demo',?,?,?)").run(payment,id,JSON.stringify({id:payment,provider:'mock',demo:true,status:'PENDING',expiresAt:new Date(Date.now()-1000).toISOString()}),old,old);
  }
  const base='http://127.0.0.1:'+server.address().port;
  for(const suffix of ['','?secret='+secret]){const denied=await fetch(base+COMMERCE_JOB_PATH+suffix);assert.equal(denied.status,401);assert.equal(denied.headers.get('set-cookie'),null);}
  const invalidMethod=await fetch(base+COMMERCE_JOB_PATH,{method:'POST',headers:{authorization:'Bearer '+secret}});assert.equal(invalidMethod.status,405);
  const response=await fetch(base+COMMERCE_JOB_PATH,{headers:{authorization:'Bearer '+secret}}),result=await response.json();assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(result.expiry.expired,2);assert.equal(result.outbox.previewed,2);assert.equal(result.outbox.sent,0);for(const id of ids){const row=await db.prepare('SELECT status,payment_status FROM orders WHERE id=?').get(id);assert.equal(row.status,'CANCELLED');assert.equal(row.payment_status,'EXPIRED');assert.equal((await db.prepare('SELECT status FROM inventory_reservations WHERE order_id=?').get(id)).status,'RELEASED');}
  const again=await fetch(base+COMMERCE_JOB_PATH,{headers:{authorization:'Bearer '+secret}});const repeated=await again.json();assert.equal(repeated.expiry.expired,0);assert.equal(repeated.outbox.processed,0);assert.equal((await db.prepare('SELECT COUNT(*) n FROM sessions').get()).n,0);assert.equal((await db.prepare('SELECT COUNT(*) n FROM email_outbox').get()).n,2);assert.equal(JSON.stringify(result).includes('buyer@example.test'),false);
});

test('provedores não iniciam envio ou cancelamento depois do prazo compartilhado',async()=>{
  const env={BKM_ENVIRONMENT:'staging',PAYMENT_PROVIDER:'mercadopago',MERCADO_PAGO_ENABLED:'true',MERCADO_PAGO_ENVIRONMENT:'sandbox',MERCADO_PAGO_ACCESS_TOKEN:'unit-not-real-token',MERCADO_PAGO_PUBLIC_KEY:'unit-not-real-public',MERCADO_PAGO_WEBHOOK_SECRET:'unit-not-real-secret',MERCADO_PAGO_SELLER_ID:'123456'};
  let current=100000,calls=0;const provider=new MercadoPagoPaymentProvider({env,now:()=>current,deadlineAt:101500,fetchImpl:async()=>{calls++;current=101000;return Response.json({id:'ORDUNITBUDGET12345',external_reference:'order_budget_123',user_id:'123456',country_code:'BRA',currency_id:'BRL',live_mode:false,total_amount:'10.00',total_paid_amount:'0.00',status:'action_required',status_detail:'waiting_transfer',last_updated_date:new Date(current).toISOString(),transactions:{payments:[{amount:'10.00',status:'created',status_detail:'created',payment_method:{id:'pix',type:'bank_transfer'}}]}});}});
  await assert.rejects(provider.cancelOrder('ORDUNITBUDGET12345',{orderId:'order_budget_123',amountCents:1000,currency:'BRL'}),e=>e.code==='PAYMENT_BUDGET_EXHAUSTED');assert.equal(calls,1,'apenas GET, nenhum POST financeiro fora do orçamento');
  const emailEnv={BKM_ENVIRONMENT:'production',BKM_PUBLIC_URL:'https://bkm.example.test',EMAIL_PROVIDER:'resend',RESEND_ENABLED:'true',RESEND_DOMAIN_VERIFIED:'true',RESEND_API_KEY:'unit-not-real-email-key',RESEND_FROM:'BKM <pedidos@bkm.example.test>'};let sends=0;const email=new ResendEmailProvider({env:emailEnv,deadlineAt:Date.now()-1,fetchImpl:async()=>{sends++;return Response.json({id:'not-sent'});}});await assert.rejects(email.send({...renderEmail('welcome',{}, {env:emailEnv}),to:'buyer@example.test'},{idempotencyKey:'job/late-email'}),e=>e.code==='EMAIL_BUDGET_EXHAUSTED');assert.equal(sends,0);
});
