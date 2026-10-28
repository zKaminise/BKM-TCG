const crypto=require('node:crypto');
// The current wishlist has no explicit attribute criteria. A special-print
// variant must not be advertised as a match for an ordinary copy. Invalid
// metadata also fails closed; migrated legacy variants have an empty array.
function ordinaryWishlistVariant(value){if(value==null)return true;try{const parsed=typeof value==='string'?JSON.parse(value):value;return Array.isArray(parsed)&&parsed.length===0;}catch{return false;}}
const {EmailError}=require('./email.cjs');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const fingerprint=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function createEmailStore(db) {
  const fence=claim=>claim&&Number.isInteger(claim.attempts)&&Number.isFinite(claim.leaseUntil)?{sql:" AND status='PROCESSING' AND attempts=? AND locked_until=?",args:[claim.attempts,claim.leaseUntil]}:{sql:'',args:[]};
  const recipientHash=value=>crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
  const statuses={'email.sent':'ACCEPTED','email.delivered':'DELIVERED','email.delivery_delayed':'DEFERRED','email.bounced':'BOUNCED','email.complained':'COMPLAINED','email.failed':'FAILED','email.suppressed':'SUPPRESSED'};
  async function apply(row,event) {
    const status=statuses[event.type];if(!row||!status)return;
    const severe=['BOUNCED','COMPLAINED','SUPPRESSED'];
    if(severe.includes(status)) {
      const address=JSON.parse(row.payload_json).to,stamp=new Date().toISOString();
      await db.prepare('INSERT INTO email_suppressions VALUES(?,?,?,?) ON CONFLICT(recipient_hash) DO UPDATE SET reason=excluded.reason,updated_at=excluded.updated_at').run(recipientHash(address),status,stamp,stamp);
    }
    if((severe.includes(row.delivery_status)&&!severe.includes(status))||(row.last_event_at&&row.last_event_at>event.created_at))return;
    await db.prepare('UPDATE email_outbox SET delivery_status=?,last_event_at=? WHERE id=?').run(status,event.created_at,row.id);
  }
  const store={
    async enqueue(message) {
      const id=crypto.randomUUID(),now=Date.now();
      await db.prepare("INSERT INTO email_outbox(id,key,payload_json,status,attempts,next_attempt_at,created_at) VALUES(?,?,?,'PENDING',0,?,?) ON CONFLICT(key) DO NOTHING").run(id,message.key,JSON.stringify(message),now,new Date(now).toISOString());
      const saved=await db.prepare('SELECT id,payload_json FROM email_outbox WHERE key=?').get(message.key);
      if(!saved||fingerprint(JSON.parse(saved.payload_json))!==fingerprint(message)) throw new EmailError('EMAIL_EVENT_CONFLICT','O identificador deste e-mail já foi associado a outro evento.');
      return {id:saved.id};
    },
    async claimDue({limit=10,now=Date.now(),leaseUntil=now+60000}) {
      return db.transaction(async()=>{
        const rows=await db.prepare("SELECT * FROM email_outbox WHERE (status='PENDING' AND next_attempt_at<=?) OR (status='PROCESSING' AND locked_until<?) ORDER BY next_attempt_at LIMIT ?"+(db.engine==='postgres'?' FOR UPDATE SKIP LOCKED':'')).all(now,now,limit);
        for(const row of rows) await db.prepare("UPDATE email_outbox SET status='PROCESSING',locked_until=?,attempts=attempts+1 WHERE id=?").run(leaseUntil,row.id);
        return rows.map(row=>({id:row.id,...JSON.parse(row.payload_json),attempts:row.attempts,createdAt:row.created_at,claim:{attempts:row.attempts+1,leaseUntil}}));
      });
    },
    async complete(id,{providerId,preview,accepted=false,now=Date.now(),claim}) { const f=fence(claim);return db.transaction(async()=>{
      const result=await db.prepare("UPDATE email_outbox SET status='SENT',provider_id=?,preview_json=?,delivery_status=?,sent_at=?,locked_until=NULL,last_error=NULL WHERE id=?"+f.sql).run(providerId || null,preview?JSON.stringify(preview):null,accepted?'ACCEPTED':'PREVIEW',new Date(now).toISOString(),id,...f.args);
      if(result.changes&&providerId){const events=await db.prepare('SELECT * FROM email_events WHERE provider_id=? ORDER BY occurred_at').all(providerId);for(const saved of events){const row=await db.prepare('SELECT * FROM email_outbox WHERE id=?'+db.lockSuffix).get(id);await apply(row,JSON.parse(saved.payload_json));await db.prepare('UPDATE email_events SET outbox_id=? WHERE id=?').run(id,saved.id);}}
      return result;
    }); },
    async retry(id,{attempts,nextAttemptAt,errorCode,claim}) { const f=fence(claim);return db.prepare("UPDATE email_outbox SET status='PENDING',attempts=?,next_attempt_at=?,last_error=?,locked_until=NULL WHERE id=?"+f.sql).run(attempts,nextAttemptAt,errorCode,id,...f.args); },
    async fail(id,{errorCode,claim}) { const f=fence(claim);return db.prepare("UPDATE email_outbox SET status='FAILED',delivery_status=?,last_error=?,locked_until=NULL WHERE id=?"+f.sql).run(errorCode==='EMAIL_SUPPRESSED'?'SUPPRESSED':'FAILED',errorCode,id,...f.args); },
    async isSuppressed(address) {return !!await db.prepare('SELECT recipient_hash FROM email_suppressions WHERE recipient_hash=?').get(recipientHash(address));},
    async currentWishlistItems({userId,wishlistIds,items,now=Date.now()}={}) {
      if(!Array.isArray(items)||!items.length||items.length>50||!Number.isSafeInteger(now)||now<0)return [];
      const ids=[...new Set(items.map(item=>item?.variantId).filter(id=>typeof id==='string'&&id&&id.length<=100))];
      if(!ids.length)return [];
      const rows=await db.prepare("SELECT v.*,p.slug,p.name,p.set_name,p.images_json,cm.number,COALESCE(vm.attributes_json,'[]') variant_attributes_json,COALESCE(r.units,0) reserved FROM variants v JOIN products p ON p.id=v.product_id JOIN card_metadata cm ON cm.id=p.card_id LEFT JOIN variant_metadata vm ON vm.variant_id=v.id LEFT JOIN (SELECT variant_id,SUM(quantity) units FROM inventory_reservations WHERE status='ACTIVE' AND expires_at>? GROUP BY variant_id) r ON r.variant_id=v.id WHERE v.id IN ("+ids.map(()=>'?').join(',')+") AND v.active=1 AND p.kind='SINGLE' AND p.published=1 AND p.archived=0").all(now,...ids);
      const byId=new Map(rows.map(row=>[row.id,row])),seen=new Set(),current=[];
      for(const item of items){const row=byId.get(item.variantId);if(!row||row.product_id!==item.productId||row.stock-Number(row.reserved)<1||!ordinaryWishlistVariant(row.variant_attributes_json)||seen.has(row.id))continue;seen.add(row.id);
        const images=JSON.parse(row.images_json);
        current.push({productId:row.product_id,variantId:row.id,slug:row.slug,name:row.name,setName:row.set_name,number:row.number,priceCents:row.price_cents,language:row.language,condition:row.condition,finish:row.finish,attributes:[],image:Array.isArray(images)?images[0]?.url||null:null,productUrl:'/produto/'+encodeURIComponent(row.slug)});
      }
      return store.eligibleWishlistItems({userId,wishlistIds,items:current});
    },
    async prepareDigest(message,{now=Date.now()}={}) {
      // Only a first, still-owned claim can change an unsent digest. Once a
      // provider attempt may have happened, its idempotency payload is frozen.
      if(message?.template!=='wishlist-digest'||message.attempts!==0||message.claim?.attempts!==1||!Number.isSafeInteger(now)||now<0)return null;
      const f=fence(message.claim);if(!f.sql||message.claim.leaseUntil<=now)return null;
      return db.transaction(async()=>{
        const ownerId=message.data?.notificationUserId;
        if(!ownerId)return null;
        if(db.engine==='postgres')await db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(ownerId);
        const saved=await db.prepare('SELECT * FROM email_outbox WHERE id=?'+f.sql+db.lockSuffix).get(message.id,...f.args);
        if(!saved)return null;
        const payload=JSON.parse(saved.payload_json);
        if(payload.template!=='wishlist-digest'||payload.key!==message.key||payload.to!==message.to||payload.data?.notificationUserId!==ownerId||payload.data.consentVerified!==true)return null;
        const preferences=await db.prepare('SELECT p.*,u.email FROM email_preferences p JOIN users u ON u.id=p.user_id WHERE p.user_id=?').get(ownerId);
        const consent=preferences&&preferences.email.toLowerCase()===payload.to.toLowerCase()&&preferences.wishlist_enabled&&preferences.digest_enabled&&preferences.consented_at&&!await store.isSuppressed(payload.to);
        const items=consent?await store.currentWishlistItems({userId:ownerId,wishlistIds:payload.data.wishlistIds,items:payload.data.items,now}):[];
        const variants=new Set(items.map(item=>item.variantId));
        const events=await db.prepare("SELECT event_key,item_json FROM email_wishlist_digest_events WHERE email_id=? AND status='QUEUED'").all(message.id);
        const discarded=events.filter(event=>!variants.has(JSON.parse(event.item_json).variantId)).map(event=>event.event_key);
        if(discarded.length)await db.prepare("UPDATE email_wishlist_digest_events SET status='DISCARDED',processed_at=? WHERE email_id=? AND status='QUEUED' AND event_key IN ("+discarded.map(()=>'?').join(',')+")").run(now,message.id,...discarded);
        if(!items.length)return null;
        const prepared={...payload,data:{...payload.data,items,productUrl:items[0].productUrl}};
        const updated=await db.prepare('UPDATE email_outbox SET payload_json=? WHERE id=?'+f.sql).run(JSON.stringify(prepared),message.id,...f.args);
        return updated.changes?{...message,...prepared}:null;
      });
    },
    async eligibleWishlistItems({userId,wishlistIds,items}={}) {
      if(!userId||!Array.isArray(wishlistIds)||!wishlistIds.length||wishlistIds.length>100||wishlistIds.some(id=>typeof id!=='string'||!id||id.length>100)||!Array.isArray(items)||!items.length||items.length>50)return [];
      const personal=await db.prepare('SELECT preferences_json FROM personal_preferences WHERE user_id=?').get(userId);
      if(!personal||JSON.parse(personal.preferences_json).notifyEmail!==true)return [];
      const ids=[...new Set(wishlistIds)],wishes=await db.prepare('SELECT * FROM personal_wishlist WHERE user_id=? AND enabled=1 AND id IN ('+ids.map(()=>'?').join(',')+')').all(userId,...ids);
      const normalized=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b0+(?=\d)/g,'');
      const variantIds=[...new Set(items.map(item=>item?.variantId).filter(id=>typeof id==='string'&&id&&id.length<=100))];if(!variantIds.length||!wishes.length)return [];
      const variants=await db.prepare("SELECT v.id,v.product_id,v.language,v.condition,v.finish,v.price_cents,p.set_id,p.tcg,cm.number,cm.metadata_json,COALESCE(vm.attributes_json,'[]') variant_attributes_json FROM variants v JOIN products p ON p.id=v.product_id JOIN card_metadata cm ON cm.id=p.card_id LEFT JOIN variant_metadata vm ON vm.variant_id=v.id WHERE v.id IN ("+variantIds.map(()=>'?').join(',')+") AND v.active=1 AND p.kind='SINGLE' AND p.published=1 AND p.archived=0").all(...variantIds);
      return items.filter(item=>{
        const variant=variants.find(row=>row.id===item.variantId&&row.product_id===item.productId);if(!variant||!ordinaryWishlistVariant(variant.variant_attributes_json)||!ordinaryWishlistVariant(item.attributes))return false;
        const card=JSON.parse(variant.metadata_json);
        return wishes.some(wish=>{
          const prefs=JSON.parse(wish.preferences_json),reference=JSON.parse(wish.metadata_json);
          return prefs.notifyEmail===true&&normalized(variant.tcg)==='pokemon'&&wish.set_id===variant.set_id&&(card.providerId===wish.card_id||normalized(card.number||variant.number)===normalized(reference.number))&&(!prefs.languages?.length||prefs.flexible||prefs.languages.includes(variant.language))&&(!prefs.conditions?.length||prefs.flexible||prefs.conditions.includes(variant.condition))&&(!prefs.variants?.length||prefs.flexible||prefs.variants.includes(variant.finish))&&(prefs.maxPriceCents==null||variant.price_cents<=prefs.maxPriceCents);
        });
      });
    },
    async notificationAllowed(message) {
      if(!message.data?.notificationUserId||message.data.consentVerified!==true||!['wishlist-available','wishlist-digest'].includes(message.template))return false;
      const row=await db.prepare('SELECT p.*,u.email FROM email_preferences p JOIN users u ON u.id=p.user_id WHERE p.user_id=?').get(message.data.notificationUserId);
      if(!row||row.email.toLowerCase()!==message.to.toLowerCase()||!row.wishlist_enabled||!row.consented_at||(message.template==='wishlist-digest'&&!row.digest_enabled)||!Array.isArray(message.data.items)||!message.data.items.length)return false;
      const eligible=await store.eligibleWishlistItems({userId:message.data.notificationUserId,wishlistIds:message.data.wishlistIds,items:message.data.items});
      if(eligible.length!==message.data.items.length)return false;
      for(const item of message.data.items) {
        const variant=await db.prepare("SELECT v.*,p.published,p.archived,COALESCE(vm.attributes_json,'[]') variant_attributes_json FROM variants v JOIN products p ON p.id=v.product_id LEFT JOIN variant_metadata vm ON vm.variant_id=v.id WHERE v.id=? AND p.id=?").get(item.variantId,item.productId);
        if(!variant||!ordinaryWishlistVariant(variant.variant_attributes_json)||!variant.active||!variant.published||variant.archived||variant.price_cents!==item.priceCents||variant.language!==item.language||variant.condition!==item.condition||variant.finish!==item.finish)return false;
        const reserved=Number((await db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM inventory_reservations WHERE variant_id=? AND status='ACTIVE' AND expires_at>?").get(variant.id,Date.now())).n);
        if(variant.stock-reserved<1)return false;
      }
      return true;
    },
    async applyProviderEvent({id,event}) {
      const payload={type:event.type,created_at:new Date(event.created_at).toISOString(),data:{email_id:event.data.email_id}};
      return db.transaction(async()=>{
        if(db.engine==='postgres')await db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('resend:'+id);
        const prior=await db.prepare('SELECT payload_json FROM email_events WHERE id=?').get(id);
        if(prior){if(fingerprint(JSON.parse(prior.payload_json))!==fingerprint(payload))throw new EmailError('EMAIL_EVENT_CONFLICT','O evento de e-mail já foi recebido com outro conteúdo.');return {duplicate:true};}
        const row=await db.prepare('SELECT * FROM email_outbox WHERE provider_id=?'+db.lockSuffix).get(payload.data.email_id);
        await db.prepare('INSERT INTO email_events VALUES(?,?,?,?,?,?,?)').run(id,payload.data.email_id,row?.id||null,payload.type,JSON.stringify(payload),payload.created_at,new Date().toISOString());
        await apply(row,payload);
        return {duplicate:false,matched:!!row,deliveryStatus:statuses[payload.type]||null};
      });
    }
  };
  return store;
}
module.exports={createEmailStore};
