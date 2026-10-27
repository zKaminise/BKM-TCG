'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {ResendEmailProvider,emailReadiness,renderEmail}=require('../server/email.cjs');
const env={BKM_ENVIRONMENT:'production',BKM_PUBLIC_URL:'https://bkm.example.test',EMAIL_PROVIDER:'resend',RESEND_ENABLED:'true',RESEND_DOMAIN_VERIFIED:'true',RESEND_API_KEY:'fixture-no-real-key',RESEND_FROM:'BKM <pedidos@bkm.example.test>'};
test('Reply-To operacional é opcional e não altera destinatário cliente',async()=>{
  for(const reply of [undefined,'',' Operational@Example.test ']){let body;const configuration={...env,...(reply!==undefined?{RESEND_REPLY_TO:reply}:{})};const provider=new ResendEmailProvider({env:configuration,fetchImpl:async(_,options)=>{body=JSON.parse(options.body);return Response.json({id:'fixture-email-only'});}});await provider.send({...renderEmail('welcome',{}, {env}),to:'customer@example.test'},{idempotencyKey:'reply-to/'+(reply?'configured':'optional')});assert.deepEqual(body.to,['customer@example.test']);assert.equal(body.from,env.RESEND_FROM);if(reply)assert.equal(body.reply_to,'operational@example.test');else assert.equal(Object.hasOwn(body,'reply_to'),false);}
});
test('Reply-To inválido ou com injeção é rejeitado antes da rede e fecha readiness',()=>{
  let calls=0;for(const reply of ['wrong','user@example.test\r\nBcc: attacker@example.test','user@example.test\n','Nome <user@example.test>','user@example.test,other@example.test',' ',123]){const configuration={...env,RESEND_REPLY_TO:reply};assert.equal(emailReadiness(configuration).enabled,false);assert.throws(()=>new ResendEmailProvider({env:configuration,fetchImpl:async()=>{calls++;}}),error=>error.code==='EMAIL_REPLY_TO_INVALID');}assert.equal(calls,0);
});
