const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {openStore}=require('../server/store.cjs');
const {createEmailStore}=require('../server/email-store.cjs');
const {createEmailNotifications}=require('../server/email-notifications.cjs');
const {createEmailDispatcher,EmailError}=require('../server/email.cjs');
const env={BKM_ENVIRONMENT:'demo',BKM_PUBLIC_URL:'https://bkm.example.test'};

async function fixture(t,engine){
  let pg,tail=Promise.resolve();
  const execute=async(sql,args)=>args?.length?pg.query(sql,args):(await pg.exec(sql)).at(-1);
  async function connect(){const prior=tail;let release;tail=new Promise(resolve=>{release=resolve;});await prior;return{query:execute,release};}
  const pgClient=engine==='postgres'?(pg=new PGlite(),{connect,async query(sql,args){const client=await connect();try{return await client.query(sql,args);}finally{client.release();}},end:()=>pg.close()}):undefined;
  const db=openStore({dbPath:':memory:',env:{},pgClient});await db.ready;t.after(()=>db.close());
  const store=createEmailStore(db),queueAt=Date.now()-2*86400000;
  const notifications=createEmailNotifications({db,emailStore:store,env,now:()=>queueAt});
  async function createDigest(){
    const userId=crypto.randomUUID(),email='digest-'+userId+'@example.test',stamp=new Date(queueAt).toISOString(),cards=[];
    await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,'Colecionador','unusable-fixture','CUSTOMER',?)").run(userId,email,stamp);
    await db.prepare('INSERT INTO personal_preferences VALUES(?,?,?)').run(userId,JSON.stringify({notifyEmail:true}),stamp);
    await notifications.setPreferences(userId,{wishlistEnabled:true,digestEnabled:true,frequencyHours:24});
    for(let n=1;n<=2;n++){
      const productId=crypto.randomUUID(),variantId=crypto.randomUUID(),metadataId=crypto.randomUUID(),wishId=crypto.randomUUID(),cardId='fixture-'+productId,number=String(n);
      await db.prepare("INSERT INTO card_metadata VALUES(?,?,'pokemon','fixture',?,'pt',?,?)").run(metadataId,metadataId,number,JSON.stringify({providerId:cardId,number}),stamp);
      await db.prepare("INSERT INTO products(id,slug,kind,name,description,sku,tcg,set_id,set_name,card_id,images_json,attributes_json,search_text,published,created_at,updated_at) VALUES(?,?,'SINGLE',?,'Fixture',?,'pokemon','fixture','Coleção fixture',?,?,'{}','fixture',1,?,?)").run(productId,'card-'+productId,'Carta '+number,productId,metadataId,JSON.stringify([{url:'https://assets.example.test/'+productId+'.webp'}]),stamp,stamp);
      await db.prepare("INSERT INTO variants VALUES(?,?,'pt','NM','HOLO',990,NULL,1,1)").run(variantId,productId);
      const preferences={notifyEmail:true,languages:['pt'],conditions:['NM'],variants:['HOLO'],maxPriceCents:5000};
      await db.prepare("INSERT INTO personal_wishlist(id,user_id,set_id,card_id,reference_language,preferences_json,metadata_json,enabled,created_at,updated_at) VALUES(?,?,'fixture',?,'pt',?,?,1,?,?)").run(wishId,userId,cardId,JSON.stringify(preferences),JSON.stringify({number,setId:'fixture'}),stamp,stamp);
      await notifications.queueWishlist({userId,to:email,name:'Colecionador',items:[{productId,variantId}],wishlistIds:[wishId],eventKey:'publication-'+productId});
      cards.push({productId,variantId,wishId,preferences});
    }
    assert.equal((await notifications.processDigests({now:Date.now()})).queued,1);
    const saved=await db.prepare("SELECT o.* FROM email_outbox o JOIN email_notification_events e ON e.email_id=o.id WHERE e.user_id=? AND e.category='wishlist'").get(userId);
    return{userId,email,cards,id:saved.id};
  }
  const saved=id=>db.prepare('SELECT * FROM email_outbox WHERE id=?').get(id);
  const events=id=>db.prepare('SELECT item_json,status FROM email_wishlist_digest_events WHERE email_id=? ORDER BY event_key').all(id);
  const revoke=card=>db.prepare('UPDATE personal_wishlist SET preferences_json=? WHERE id=?').run(JSON.stringify({...card.preferences,notifyEmail:false}),card.wishId);
  return{db,store,createDigest,saved,events,revoke};
}

for(const engine of ['sqlite','postgres'])test('Primeiro envio do resumo preserva cartas elegíveis: '+engine,async t=>{
  const f=await fixture(t,engine);
  await t.test('revogação de uma carta após consolidar mantém a outra, atualiza snapshot persistido e dois workers enviam uma vez',async()=>{
    const digest=await f.createDigest(),[revoked,remaining]=digest.cards;await f.revoke(revoked);
    await f.db.prepare('UPDATE variants SET price_cents=1250 WHERE id=?').run(remaining.variantId);
    const sent=[];const provider={name:'resend',async send(message,{idempotencyKey}){sent.push({message,idempotencyKey});return{id:'fixture-accepted-'+digest.id,accepted:true};}};
    const make=()=>createEmailDispatcher({store:f.store,env,provider});
    const results=await Promise.all([make().flush(),make().flush()]);
    assert.equal(results.reduce((sum,result)=>sum+result.sent,0),1);assert.equal(sent.length,1);
    const persisted=JSON.parse((await f.saved(digest.id)).payload_json);
    assert.deepEqual(persisted.data.items.map(item=>item.variantId),[remaining.variantId]);assert.equal(persisted.data.items[0].priceCents,1250);
    assert.deepEqual(sent[0].message.data,persisted.data);assert.equal(sent[0].idempotencyKey,persisted.key);assert.equal(persisted.to,digest.email);
    const states=new Map((await f.events(digest.id)).map(event=>[JSON.parse(event.item_json).variantId,event.status]));
    assert.equal(states.get(revoked.variantId),'DISCARDED');assert.equal(states.get(remaining.variantId),'QUEUED');
    assert.equal((await make().flush()).processed,0);
  });
  await t.test('se todas forem revogadas não há envio e os eventos ficam descartados',async()=>{
    const digest=await f.createDigest();for(const card of digest.cards)await f.revoke(card);
    let sends=0;const result=await createEmailDispatcher({store:f.store,env,provider:{name:'resend',async send(){sends++;throw new Error('Não deve enviar');}}}).flush();
    assert.equal(sends,0);assert.equal(result.failed,1);assert.equal((await f.saved(digest.id)).last_error,'EMAIL_CONSENT_REQUIRED');
    assert.deepEqual((await f.events(digest.id)).map(event=>event.status),['DISCARDED','DISCARDED']);
  });
  await t.test('timeout com retry preserva exatamente payload e chave enviados na primeira tentativa',async()=>{
    const digest=await f.createDigest();await f.revoke(digest.cards[0]);let current=Date.now()+1000;const calls=[];
    const dispatcher=createEmailDispatcher({store:f.store,env,now:()=>current,random:()=>0,provider:{name:'resend',async send(message,{idempotencyKey}){calls.push({data:message.data,key:idempotencyKey});if(calls.length===1)throw new EmailError('EMAIL_TIMEOUT','Fixture ambígua',{retryable:true});return{id:'fixture-retry-'+digest.id,accepted:true};}}});
    assert.equal((await dispatcher.flush()).retried,1);const first=await f.saved(digest.id),payload=first.payload_json;
    current=Number(first.next_attempt_at)+1;assert.equal((await dispatcher.flush()).sent,1);
    assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal((await f.saved(digest.id)).payload_json,payload);
  });
  await t.test('retry ambíguo seguido de alteração não remonta payload nem envia item fora do consentimento',async()=>{
    const digest=await f.createDigest();let current=Date.now()+1000,sends=0;
    const dispatcher=createEmailDispatcher({store:f.store,env,now:()=>current,random:()=>0,provider:{name:'resend',async send(){sends++;throw new EmailError('EMAIL_TIMEOUT','Fixture ambígua',{retryable:true});}}});
    assert.equal((await dispatcher.flush()).retried,1);const first=await f.saved(digest.id),payload=first.payload_json;
    await f.revoke(digest.cards[0]);current=Number(first.next_attempt_at)+1;
    assert.equal((await dispatcher.flush()).failed,1);assert.equal(sends,1);assert.equal((await f.saved(digest.id)).payload_json,payload);
    assert.equal((await f.saved(digest.id)).last_error,'EMAIL_CONSENT_REQUIRED');
  });
  await t.test('claim vencida ou retomada não altera payload nem descarta eventos de outro worker',async()=>{
    const digest=await f.createDigest(),at=Date.now()+1000;
    const [oldClaim]=await f.store.claimDue({limit:1,now:at,leaseUntil:at+10});assert.equal(oldClaim.id,digest.id);
    await f.revoke(digest.cards[0]);
    const [newClaim]=await f.store.claimDue({limit:1,now:at+11,leaseUntil:at+300000});assert.equal(newClaim.id,digest.id);
    const before=await f.saved(digest.id),beforeEvents=await f.events(digest.id);
    assert.equal(await f.store.prepareDigest(oldClaim,{now:at+11}),null);
    assert.equal(await f.store.prepareDigest({...oldClaim,claim:{...oldClaim.claim,leaseUntil:at+300000}},{now:at+11}),null);
    assert.equal(await f.store.prepareDigest(newClaim,{now:at+11}),null);
    assert.equal((await f.saved(digest.id)).payload_json,before.payload_json);assert.deepEqual(await f.events(digest.id),beforeEvents);
    await f.store.fail(digest.id,{errorCode:'FIXTURE_COMPLETE',claim:newClaim.claim});
  });
});
