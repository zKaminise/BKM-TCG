const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {openStore}=require('../server/store.cjs');
const {createEmailStore}=require('../server/email-store.cjs');
const {createEmailNotifications}=require('../server/email-notifications.cjs');
const {createEmailDispatcher}=require('../server/email.cjs');
const env={BKM_ENVIRONMENT:'demo',BKM_PUBLIC_URL:'https://bkm.example.test'};
const initial=Date.parse('2026-10-20T13:00:00.000Z'),daily=Date.parse('2026-10-21T12:00:00.000Z');

async function fixture(t,engine){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bkm-email-digests-'));let pg,tail=Promise.resolve(),clock=initial,db;
  // PGlite has one embedded connection. Lease that connection like a pool of
  // size one so concurrent workers cannot interleave separate transactions.
  const execute=async(sql,args)=>args?.length?pg.query(sql,args):(await pg.exec(sql)).at(-1);
  async function connect(){const previous=tail;let release;tail=new Promise(resolve=>{release=resolve;});await previous;return{query:execute,release};}
  const pgClient=engine==='postgres'?(pg=new PGlite(),{connect,async query(sql,args){const client=await connect();try{return await client.query(sql,args);}finally{client.release();}},end:()=>pg.close()}):undefined;
  function reopen(){db=openStore({dbPath:path.join(directory,'isolated.sqlite'),pgClient,env:{}});return db.ready;}
  await reopen();
  t.after(async()=>{await db.close();fs.rmSync(directory,{recursive:true,force:true});});
  let store=createEmailStore(db),notifications=createEmailNotifications({db,emailStore:store,env,now:()=>clock});
  async function owner(frequencyHours=24){
    const id=crypto.randomUUID(),stamp=new Date(clock).toISOString(),email='digest-'+id+'@example.test';
    await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,'Colecionador','unusable-fixture','CUSTOMER',?)").run(id,email,stamp);
    await db.prepare('INSERT INTO personal_preferences VALUES(?,?,?)').run(id,JSON.stringify({notifyEmail:true}),stamp);
    await notifications.setPreferences(id,{wishlistEnabled:true,digestEnabled:true,frequencyHours});
    return{id,email};
  }
  async function card(user,{price=990,number='001'}={}){
    const productId=crypto.randomUUID(),variantId=crypto.randomUUID(),metadataId=crypto.randomUUID(),wishId=crypto.randomUUID(),stamp=new Date(clock).toISOString(),cardId='fixture-'+productId;
    await db.prepare("INSERT INTO card_metadata VALUES(?,?,'pokemon','fixture',?,'pt',?,?)").run(metadataId,metadataId,number,JSON.stringify({providerId:cardId,number}),stamp);
    await db.prepare("INSERT INTO products(id,slug,kind,name,description,sku,tcg,set_id,set_name,card_id,images_json,attributes_json,search_text,published,created_at,updated_at) VALUES(?,?,'SINGLE',?,'Fixture',?,'pokemon','fixture','Coleção fixture',?,?,'{}','fixture',1,?,?)").run(productId,'card-'+productId,'Carta '+number,productId,metadataId,JSON.stringify([{url:'https://assets.example.test/'+productId+'.webp'}]),stamp,stamp);
    await db.prepare("INSERT INTO variants VALUES(?,?,'pt','NM','HOLO',?,NULL,1,1)").run(variantId,productId,price);
    const preferences={notifyEmail:true,languages:['pt'],conditions:['NM'],variants:['HOLO'],maxPriceCents:5000};
    await db.prepare("INSERT INTO personal_wishlist(id,user_id,set_id,card_id,reference_language,preferences_json,metadata_json,enabled,created_at,updated_at) VALUES(?,?,'fixture',?,'pt',?,?,1,?,?)").run(wishId,user.id,cardId,JSON.stringify(preferences),JSON.stringify({number,setId:'fixture'}),stamp,stamp);
    return{productId,variantId,wishId,preferences,input:{userId:user.id,to:user.email,name:'Colecionador',items:[{productId,variantId}],wishlistIds:[wishId],eventKey:'publication-'+productId}};
  }
  async function messages(user){return(await db.prepare('SELECT id,payload_json,status FROM email_outbox ORDER BY created_at,id').all()).map(row=>({...row,payload:JSON.parse(row.payload_json)})).filter(row=>row.payload.data.notificationUserId===user.id);}
  async function pending(user){return db.prepare("SELECT * FROM email_wishlist_digest_events WHERE user_id=? AND status='PENDING' ORDER BY event_key").all(user.id);}
  async function reopenSqlite(){assert.equal(engine,'sqlite');await db.close();await reopen();store=createEmailStore(db);notifications=createEmailNotifications({db,emailStore:store,env,now:()=>clock});}
  return{get db(){return db;},get store(){return store;},get notifications(){return notifications;},now(value){clock=value;},owner,card,messages,pending,reopenSqlite,peer(){return createEmailNotifications({db,emailStore:store,env,now:()=>clock});}};
}

for(const engine of ['sqlite','postgres'])test('Resumos wishlist persistentes e seguros: '+engine,async t=>{
  const f=await fixture(t,engine);
  await t.test('duas cartas no mesmo dia, persistência, snapshot atual e cron concorrente idempotente',async()=>{
    f.now(initial);const user=await f.owner(),a=await f.card(user),b=await f.card(user,{number:'002'});
    const first=await f.notifications.queueWishlist(a.input);assert.equal(first.pending,true);assert.equal(first.queued,false);assert.equal(first.dueAt,new Date(daily).toISOString());
    f.now(initial+3*3600000);assert.equal((await f.notifications.queueWishlist(b.input)).pending,true);assert.equal((await f.notifications.queueWishlist(a.input)).reason,'duplicate');assert.equal((await f.messages(user)).length,0);
    if(engine==='sqlite')await f.reopenSqlite();
    assert.equal((await f.pending(user)).length,2);assert.equal((await f.notifications.processDigests({now:daily-1})).queued,0);
    await f.db.prepare('UPDATE variants SET price_cents=1250 WHERE id=?').run(a.variantId);
    await f.db.prepare("UPDATE products SET name='Nome atual' WHERE id=?").run(a.productId);
    f.now(daily+5000);const runs=await Promise.all([f.notifications.processDigests({limit:10}),f.peer().processDigests({limit:10})]);
    assert.equal(runs.reduce((sum,result)=>sum+result.queued,0),1);assert.equal((await f.pending(user)).length,0);
    const [message]=await f.messages(user);assert.equal((await f.messages(user)).length,1);assert.equal(message.payload.template,'wishlist-digest');assert.equal(message.payload.data.items.length,2);
    const item=message.payload.data.items.find(item=>item.variantId===a.variantId);assert.equal(item.priceCents,1250);assert.equal(item.name,'Nome atual');assert.equal(item.setName,'Coleção fixture');assert.equal(item.number,'001');assert.equal(item.language,'pt');assert.equal(item.condition,'NM');assert.equal(item.finish,'HOLO');assert.match(item.image,/^https:/);assert.match(item.productUrl,/^\/produto\//);
    assert.equal(await f.store.notificationAllowed(message.payload),true);
    let sends=0;const result=await createEmailDispatcher({store:f.store,env,provider:{name:'resend',async send(){sends++;return{id:'fixture-digest-accepted',accepted:true};}}}).flush();assert.equal(sends,1);assert.equal(result.sent,1);
    assert.equal((await f.notifications.processDigests()).queued,0);assert.equal((await f.messages(user)).length,1);
    // Yesterday's cron was five seconds late. Today's calendar boundary still
    // allows a daily summary instead of postponing it by another whole day.
    f.now(daily+3600000);const c=await f.card(user,{number:'003'});await f.notifications.queueWishlist(c.input);
    const next=await f.notifications.processDigests({now:daily+86400000});assert.equal(next.queued,1);assert.equal(next.deferred,0);assert.equal((await f.messages(user)).length,2);
  });
  await t.test('semanal vence segunda às 09h UTC-3 e mudança para diário recalcula pendências',async()=>{
    f.now(Date.parse('2026-10-22T13:00:00Z'));const user=await f.owner(168),a=await f.card(user),b=await f.card(user,{number:'002'});
    const monday=Date.parse('2026-10-26T12:00:00Z');assert.equal((await f.notifications.queueWishlist(a.input)).dueAt,new Date(monday).toISOString());await f.notifications.queueWishlist(b.input);
    assert.equal((await f.notifications.processDigests({now:monday-1})).queued,0);assert.equal((await f.notifications.processDigests({now:monday})).queued,1);assert.equal((await f.messages(user))[0].payload.data.items.length,2);
    f.now(Date.parse('2026-10-27T13:00:00Z'));const c=await f.card(user,{number:'003'});await f.notifications.queueWishlist(c.input);await f.notifications.setPreferences(user.id,{frequencyHours:24});
    assert.equal(Number((await f.pending(user))[0].due_at),Date.parse('2026-10-28T12:00:00Z'));assert.equal((await f.notifications.processDigests({now:Date.parse('2026-10-28T12:00:00Z')})).queued,1);
  });
  await t.test('revogação específica remove só a carta revogada e dispatcher revalida consentimento após consolidar',async()=>{
    f.now(initial);const user=await f.owner(),a=await f.card(user),b=await f.card(user,{number:'002'});await f.notifications.queueWishlist(a.input);await f.notifications.queueWishlist(b.input);
    await f.db.prepare('UPDATE personal_wishlist SET preferences_json=? WHERE id=?').run(JSON.stringify({...a.preferences,notifyEmail:false}),a.wishId);
    const result=await f.notifications.processDigests({now:daily});assert.equal(result.queued,1);assert.equal(result.discarded,1);
    const [message]=await f.messages(user);assert.deepEqual(message.payload.data.items.map(item=>item.variantId),[b.variantId]);
    await f.notifications.setPreferences(user.id,{wishlistEnabled:false});assert.equal(await f.store.notificationAllowed(message.payload),false);
  });
  await t.test('desejo de outro titular, condição, idioma, preço e estoque atuais não autorizam promessa',async()=>{
    f.now(initial);const user=await f.owner(),other=await f.owner(),a=await f.card(user),foreign=await f.card(other);
    assert.equal((await f.notifications.queueWishlist({...a.input,wishlistIds:[foreign.wishId]})).reason,'wishlist-consent');
    await f.notifications.queueWishlist(a.input);await f.db.prepare('UPDATE personal_wishlist SET user_id=? WHERE id=?').run(other.id,a.wishId);
    assert.equal((await f.notifications.processDigests({now:daily})).queued,0);assert.equal((await f.messages(user)).length,0);
    for(const mutation of ["stock=0","price_cents=6000","language='ja'","condition='LP'","finish='REVERSE'","active=0"]){
      const value=await f.card(user);await f.notifications.queueWishlist(value.input);await f.db.prepare('UPDATE variants SET '+mutation+' WHERE id=?').run(value.variantId);
      const result=await f.notifications.processDigests({now:daily});assert.equal(result.queued,0);assert.equal((await f.pending(user)).length,0);
    }
  });
  await t.test('opt-out global/pessoal e supressão descartam pendência sem gerar e-mail',async()=>{
    for(const scenario of ['global','personal','suppression']){
      f.now(initial);const user=await f.owner(),a=await f.card(user);await f.notifications.queueWishlist(a.input);
      if(scenario==='global')await f.notifications.setPreferences(user.id,{wishlistEnabled:false});
      if(scenario==='personal')await f.db.prepare('UPDATE personal_preferences SET preferences_json=? WHERE user_id=?').run(JSON.stringify({notifyEmail:false}),user.id);
      if(scenario==='suppression')await f.db.prepare('INSERT INTO email_suppressions VALUES(?,?,?,?)').run(crypto.createHash('sha256').update(user.email).digest('hex'),'BOUNCED',new Date(initial).toISOString(),new Date(initial).toISOString());
      await f.notifications.processDigests({now:daily});assert.equal((await f.messages(user)).length,0);assert.equal((await f.pending(user)).length,0);
    }
  });
  await t.test('reserva ativa consome disponibilidade e reserva expirada não bloqueia a carta',async()=>{
    for(const active of [true,false]){
      f.now(initial);const user=await f.owner(),a=await f.card(user),orderId=crypto.randomUUID(),stamp=new Date(initial).toISOString();await f.notifications.queueWishlist(a.input);
      await f.db.prepare("INSERT INTO orders(id,user_id,status,payment_status,shipping_status,subtotal_cents,discount_cents,shipping_cents,total_cents,address_json,idempotency_key,created_at,updated_at) VALUES(?,?,'PENDING','PENDING','UNFULFILLED',990,0,0,990,'{}',?,?,?)").run(orderId,user.id,crypto.randomUUID(),stamp,stamp);
      await f.db.prepare("INSERT INTO inventory_reservations VALUES(?,?,?,1,'ACTIVE',?,?)").run(crypto.randomUUID(),a.variantId,orderId,active?daily+3600000:daily-1,stamp);
      const result=await f.notifications.processDigests({now:daily});assert.equal(result.queued,active?0:1);assert.equal((await f.messages(user)).length,active?0:1);assert.equal((await f.pending(user)).length,0);
    }
  });
  await t.test('mais de 50 eventos preservam o excedente para período seguinte sem perda',async()=>{
    f.now(initial);const user=await f.owner();for(let i=0;i<53;i++){const value=await f.card(user,{number:String(i+1)});await f.notifications.queueWishlist(value.input);}
    const first=await f.notifications.processDigests({now:daily});assert.equal(first.queued,1);assert.equal((await f.messages(user))[0].payload.data.items.length,50);assert.equal((await f.pending(user)).length,3);
    assert.equal((await f.notifications.processDigests({now:daily+1000})).queued,0);assert.equal((await f.pending(user)).length,3);
    assert.equal((await f.notifications.processDigests({now:daily+86400000})).queued,1);assert.equal((await f.pending(user)).length,0);
    const ids=(await f.messages(user)).flatMap(message=>message.payload.data.items.map(item=>item.variantId));assert.equal(ids.length,53);assert.equal(new Set(ids).size,53);
  });
  await t.test('imediato mantém frequência anterior e entradas do processador são limitadas',async()=>{
    f.now(initial);const user=await f.owner();await f.notifications.setPreferences(user.id,{digestEnabled:false});const a=await f.card(user),b=await f.card(user,{number:'002'});
    assert.equal((await f.notifications.queueWishlist(a.input)).queued,true);assert.equal((await f.notifications.queueWishlist({...a.input,eventKey:'repeat-immediate'})).reason,'frequency');assert.equal((await f.notifications.queueWishlist(b.input)).reason,'frequency');assert.equal((await f.pending(user)).length,0);
    for(const options of [{limit:0},{limit:21},{limit:1.5},{now:NaN},{now:-1}])await assert.rejects(f.notifications.processDigests(options),error=>error.code==='EMAIL_QUEUE_LIMIT_INVALID');
    if(engine==='postgres')assert.equal((await f.db.prepare("SELECT relrowsecurity FROM pg_class WHERE relname='email_wishlist_digest_events'").get()).relrowsecurity,true);
  });
});
