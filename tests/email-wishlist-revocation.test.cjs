const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {openStore}=require('../server/store.cjs');
const {createEmailStore}=require('../server/email-store.cjs');
const {createEmailNotifications}=require('../server/email-notifications.cjs');
const {createEmailDispatcher}=require('../server/email.cjs');
const env={BKM_ENVIRONMENT:'demo',BKM_PUBLIC_URL:'https://bkm.example.test'};

async function fixture(t,engine) {
  let pg;const pgClient=engine==='postgres'?(pg=new PGlite(),{query:async(sql,args)=>args?.length?pg.query(sql,args):(await pg.exec(sql)).at(-1),end:()=>pg.close()}):undefined;
  const db=openStore({dbPath:':memory:',pgClient,env:{}});await db.ready;t.after(()=>db.close());const store=createEmailStore(db),notifications=createEmailNotifications({db,emailStore:store,env});
  async function create() {
    const userId=crypto.randomUUID(),productId=crypto.randomUUID(),variantId=crypto.randomUUID(),cardMetadataId=crypto.randomUUID(),wishId=crypto.randomUUID(),stamp=new Date().toISOString(),email='test-'+userId+'@example.test';
    await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,'Fixture','unusable','CUSTOMER',?)").run(userId,email,stamp);
    await db.prepare("INSERT INTO card_metadata(id,identity_key,tcg,set_id,number,language,metadata_json,created_at) VALUES(?,?,'pokemon','fixture','001','pt',?,?)").run(cardMetadataId,cardMetadataId,JSON.stringify({providerId:'fixture-001',number:'001'}),stamp);
    await db.prepare("INSERT INTO products(id,slug,kind,name,description,sku,tcg,set_id,set_name,card_id,images_json,attributes_json,search_text,published,created_at,updated_at) VALUES(?,?,'SINGLE','Carta fixture','Fixture',?,'pokemon','fixture','Fixture',?,'[]','{}','fixture',1,?,?)").run(productId,'card-'+productId,productId,cardMetadataId,stamp,stamp);
    await db.prepare("INSERT INTO variants VALUES(?,?,'pt','NM','HOLO',990,NULL,1,1)").run(variantId,productId);
    const preferences={notifyEmail:true,languages:['pt'],conditions:['NM'],variants:['HOLO'],maxPriceCents:1000};
    await db.prepare('INSERT INTO personal_preferences VALUES(?,?,?)').run(userId,JSON.stringify({notifyEmail:true}),stamp);
    await db.prepare("INSERT INTO personal_wishlist(id,user_id,set_id,card_id,reference_language,preferences_json,metadata_json,enabled,created_at,updated_at) VALUES(?,?,'fixture','fixture-001','pt',?,?,1,?,?)").run(wishId,userId,JSON.stringify(preferences),JSON.stringify({id:'fixture-001',number:'001',setId:'fixture'}),stamp,stamp);
    await notifications.setPreferences(userId,{wishlistEnabled:true});
    const input={userId,to:email,name:'Fixture',items:[{productId,variantId}],wishlistIds:[wishId],eventKey:'published-'+productId};
    return {userId,productId,variantId,cardMetadataId,wishId,input,preferences};
  }
  return {db,store,notifications,create};
}

for(const engine of ['sqlite','postgres'])test('Alertas wishlist revalidam consentimento específico no disparo: '+engine,async t=>{
  const f=await fixture(t,engine),{db,store,notifications}=f;
  await t.test('controle positivo e falha fechada sem referência de wishlist ou com referência de outro dono',async()=>{
    const a=await f.create(),b=await f.create();assert.equal((await notifications.queueWishlist({...a.input,wishlistIds:undefined})).reason,'wishlist-consent');assert.equal((await notifications.queueWishlist({...a.input,wishlistIds:[b.wishId]})).reason,'wishlist-consent');
    assert.equal((await notifications.queueWishlist(a.input)).queued,true);const payload=JSON.parse((await db.prepare('SELECT payload_json FROM email_outbox').get()).payload_json);assert.deepEqual(payload.data.wishlistIds,[a.wishId]);assert.equal(await store.notificationAllowed(payload),true);
    let sends=0;const result=await createEmailDispatcher({store,env,provider:{name:'resend',async send(){sends++;return {id:'fixture-accepted',accepted:true};}}}).flush();assert.equal(sends,1);assert.equal(result.sent,1);
  });
  for(const scenario of ['specific-optout','delete','disable','variant-preference','language-preference','max-price','personal-optout','identity-change'])await t.test(scenario+' bloqueia mensagem já enfileirada sem revogar consentimento global',async()=>{
    const value=await f.create();assert.equal((await notifications.queueWishlist(value.input)).queued,true);const record=await db.prepare('SELECT payload_json FROM email_outbox WHERE key LIKE ? ORDER BY created_at DESC LIMIT 1').get('wishlist/%');
    // Fetch the exact owner's payload; earlier fixtures may share a millisecond.
    const messages=await db.prepare("SELECT payload_json FROM email_outbox WHERE status='PENDING'").all(),payload=messages.map(row=>JSON.parse(row.payload_json)).find(message=>message.data.notificationUserId===value.userId);
    assert.equal(await store.notificationAllowed(payload),true);
    if(scenario==='delete')await db.prepare('DELETE FROM personal_wishlist WHERE id=?').run(value.wishId);
    else if(scenario==='disable')await db.prepare('UPDATE personal_wishlist SET enabled=0 WHERE id=?').run(value.wishId);
    else if(scenario==='personal-optout')await db.prepare('UPDATE personal_preferences SET preferences_json=? WHERE user_id=?').run(JSON.stringify({notifyEmail:false}),value.userId);
    else if(scenario==='identity-change')await db.prepare('UPDATE card_metadata SET metadata_json=? WHERE id=?').run(JSON.stringify({providerId:'fixture-002',number:'002'}),value.cardMetadataId);
    else {const next={...value.preferences};if(scenario==='specific-optout')next.notifyEmail=false;if(scenario==='variant-preference')next.variants=['REVERSE'];if(scenario==='language-preference')next.languages=['en'];if(scenario==='max-price')next.maxPriceCents=500;await db.prepare('UPDATE personal_wishlist SET preferences_json=? WHERE id=?').run(JSON.stringify(next),value.wishId);}
    assert.equal((await notifications.getPreferences(value.userId)).wishlistEnabled,true);assert.equal(await store.notificationAllowed(payload),false);
    let sends=0;const result=await createEmailDispatcher({store,env,provider:{name:'resend',async send(){sends++;return {id:'must-not-send',accepted:true};}}}).flush();assert.equal(sends,0);assert.equal(result.failed,1);
  });
});
