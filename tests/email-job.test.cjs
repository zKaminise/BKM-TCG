const test=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {PGlite}=require('@electric-sql/pglite');
const {openStore}=require('../server/store.cjs');
const {createEmailStore}=require('../server/email-store.cjs');
const {createEmailDispatcher,EmailError}=require('../server/email.cjs');
const {createEmailJob,emailJobAuthorized,EMAIL_JOB_PATH}=require('../server/email-job.cjs');
const {createServer}=require('../serve.cjs');
const secret='test-only-scheduler-secret-not-a-real-credential';
const zeroDigests={processed:0,queued:0,discarded:0,deferred:0,remaining:0};

test('job exige Bearer secreto; query, user-agent, cookies e segredo ausente não autorizam',()=>{
  assert.equal(emailJobAuthorized({authorization:'Bearer '+secret},{CRON_SECRET:secret}),true);
  for(const authorization of [undefined,'','Bearer '+secret+'x','bearer '+secret,secret,'Bearer '+secret+'\n'])assert.equal(emailJobAuthorized({authorization,'user-agent':'vercel-cron/1.0',cookie:'admin=1'},{CRON_SECRET:secret}),false);
  assert.equal(emailJobAuthorized({authorization:'Bearer '+secret},{}),false);
  assert.equal(emailJobAuthorized({authorization:'Bearer short'},{CRON_SECRET:'short'}),false);
});

test('handler serverless rejeita job sem chave antes de exigir configuração do banco',async()=>{
  const {default:handler}=await import('../api/index.js');
  let status,headers,body;
  await handler({url:EMAIL_JOB_PATH,method:'GET',headers:{}},{writeHead(code,value){status=code;headers=value;},end(value){body=JSON.parse(value);}});
  assert.equal(status,401);assert.equal(headers['Cache-Control'],'no-store');assert.equal(body.error.code,'JOB_UNAUTHORIZED');
});

test('job limita o trabalho pelo prazo e por quantidade sem pré-reservar o restante',async()=>{
  let elapsed=0,calls=0;
  const job=createEmailJob({notifications:{async processDigests({limit}){assert.equal(limit,5);return zeroDigests;}},now:()=>elapsed,async flushEmails({limit}){assert.equal(limit,1);calls++;elapsed+=11000;return{processed:1,sent:1};}});
  const result=await job();assert.equal(result.outbox.sent,4);assert.equal(result.bounded,true);assert.equal(calls,4);
  elapsed=0;calls=0;
  const bounded=createEmailJob({notifications:{async processDigests(){return zeroDigests;}},now:()=>elapsed,async flushEmails(){calls++;return{processed:1,previewed:1};}});
  assert.equal((await bounded()).outbox.processed,20);assert.equal(calls,20);
});

for(const engine of ['sqlite','postgres'])test('job '+engine+' reprocessa falha dentro da janela de idempotência sem navegação nem duplicação',async t=>{
  const pg=engine==='postgres'?new PGlite():null;
  const db=openStore({dbPath:':memory:',env:{},...(pg?{pgClient:{query:async(sql,args)=>args?.length?pg.query(sql,args):(await pg.exec(sql)).at(-1),end:()=>pg.close()}}:{})});
  await db.ready;t.after(()=>db.close());const store=createEmailStore(db);
  let current=Date.now(),sends=0;const keys=[];
  await store.enqueue({key:'worker/retry-once',template:'welcome',to:'fixture@example.test',data:{name:'Cliente'}});
  current=Number((await db.prepare('SELECT next_attempt_at FROM email_outbox').get()).next_attempt_at)+1;
  const dispatcher=createEmailDispatcher({store,env:{BKM_ENVIRONMENT:'demo',BKM_PUBLIC_URL:'https://bkm.example.test'},now:()=>current,random:()=>0,provider:{name:'resend',async send(message,{idempotencyKey}){keys.push(idempotencyKey);if(++sends===1)throw new EmailError('EMAIL_NETWORK_ERROR','Fixture transitória',{retryable:true});return{id:'fixture-job-accepted',accepted:true};}}});
  const job=createEmailJob({notifications:{async processDigests(){return zeroDigests;}},flushEmails:options=>dispatcher.flush(options),now:()=>current});
  assert.equal((await job()).outbox.retried,1);assert.equal(sends,1);
  const waiting=await db.prepare('SELECT status,next_attempt_at FROM email_outbox').get();assert.equal(waiting.status,'PENDING');
  assert.equal((await job()).outbox.processed,0);assert.equal(sends,1);
  current=waiting.next_attempt_at+1;
  assert.equal((await job()).outbox.sent,1);assert.equal(sends,2);assert.deepEqual(keys,['worker/retry-once','worker/retry-once']);
  assert.equal((await job()).outbox.processed,0);assert.equal((await db.prepare('SELECT status,attempts,delivery_status FROM email_outbox').get()).delivery_status,'ACCEPTED');
  await t.test('retorno diário depois de falha ambígua exige reconciliação e não arrisca novo envio',async()=>{
    await store.enqueue({key:'worker/ambiguous-old',template:'welcome',to:'fixture@example.test',data:{name:'Cliente'}});
    let ambiguousSends=0;
    const ambiguous=createEmailDispatcher({store,env:{BKM_ENVIRONMENT:'demo',BKM_PUBLIC_URL:'https://bkm.example.test'},now:()=>current,random:()=>0,provider:{name:'resend',async send(){ambiguousSends++;throw new EmailError('EMAIL_TIMEOUT','Fixture ambígua',{retryable:true});}}});
    const dailyJob=createEmailJob({notifications:{async processDigests(){return zeroDigests;}},flushEmails:options=>ambiguous.flush(options),now:()=>current});
    assert.equal((await dailyJob()).outbox.retried,1);assert.equal(ambiguousSends,1);
    current+=24*3600000;
    assert.equal((await dailyJob()).outbox.failed,1);assert.equal(ambiguousSends,1);
    assert.equal((await db.prepare('SELECT last_error FROM email_outbox WHERE key=?').get('worker/ambiguous-old')).last_error,'EMAIL_IDEMPOTENCY_WINDOW_EXPIRED');
  });
});

test('endpoint do worker não cria sessão e rejeita acesso público ou método incorreto',async t=>{
  const server=createServer({dbPath:':memory:',databaseUrl:'',env:{BKM_ENVIRONMENT:'demo',EMAIL_PROVIDER:'development',CRON_SECRET:secret}});
  await server.api.ready;server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.api.close();});
  const base='http://127.0.0.1:'+server.address().port;
  for(const suffix of ['', '?secret='+secret]) {
    const denied=await fetch(base+EMAIL_JOB_PATH+suffix,{headers:{'User-Agent':'vercel-cron/1.0'}});assert.equal(denied.status,401);assert.equal(denied.headers.get('set-cookie'),null);
  }
  const invalidMethod=await fetch(base+EMAIL_JOB_PATH,{method:'POST',headers:{Authorization:'Bearer '+secret}});assert.equal(invalidMethod.status,405);
  const response=await fetch(base+EMAIL_JOB_PATH,{headers:{Authorization:'Bearer '+secret}});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('set-cookie'),null);
  const result=await response.json();assert.equal(result.ok,true);assert.equal(result.outbox.processed,0);assert.equal(JSON.stringify(result).includes(secret),false);
  assert.equal((await server.api.asyncStore.prepare('SELECT COUNT(*) n FROM sessions').get()).n,0);
});
