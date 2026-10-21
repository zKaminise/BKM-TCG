const crypto=require('node:crypto');
const {EmailError}=require('./email.cjs');
const preferenceKeys={wishlistEnabled:'wishlist_enabled',digestEnabled:'digest_enabled',cartEnabled:'cart_enabled',newsEnabled:'news_enabled',collectionEnabled:'collection_enabled',priceEnabled:'price_enabled'};
function createEmailNotifications({db,emailStore,env=process.env,now=()=>Date.now()}={}) {
  function view(row) {return {...Object.fromEntries(Object.entries(preferenceKeys).map(([key,column])=>[key,!!row?.[column]])),frequencyHours:row?.frequency_hours||24,consentedAt:row?.consented_at||null,source:row?.source||'account',abandonedCartAutomationEnabled:false};}
  async function getPreferences(userId){return view(await db.prepare('SELECT * FROM email_preferences WHERE user_id=?').get(userId));}
  const eventHash=value=>crypto.createHash('sha256').update(value).digest('hex');
  function nextDigestDue(at,hours) {
    if(hours!==24&&hours!==168)return at+hours*3600000;
    // Match the daily 12:00 UTC worker: 09:00 in the store's UTC-3 calendar.
    // Weekly summaries close on Monday. A late cron must not shift this boundary.
    const local=new Date(at-3*3600000),days=hours===168?(8-local.getUTCDay())%7:0;
    let due=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()+days,12);
    if(due<=at)due+=(hours===168?7:1)*86400000;
    return due;
  }
  async function lockOwner(userId){if(db.engine==='postgres')await db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(userId);}
  async function latestWishlist(userId){return db.prepare("SELECT created_at FROM email_notification_events WHERE user_id=? AND category='wishlist' ORDER BY created_at DESC LIMIT 1").get(userId);}
  async function finishPending(rows,{emailId=null,availableIds=new Set(),at}) {
    const queued=[],discarded=[];
    for(const row of rows)(emailId&&availableIds.has(JSON.parse(row.item_json).variantId)?queued:discarded).push(row.event_key);
    for(const [status,ids]of [['QUEUED',queued],['DISCARDED',discarded]])if(ids.length)await db.prepare("UPDATE email_wishlist_digest_events SET status=?,email_id=?,processed_at=? WHERE event_key IN ("+ids.map(()=>'?').join(',')+") AND status='PENDING'").run(status,status==='QUEUED'?emailId:null,at,...ids);
    return discarded.length;
  }
  return {
    getPreferences,
    async setPreferences(userId,input={}) {
      if(!userId||Object.keys(input).some(key=>!Object.hasOwn(preferenceKeys,key)&&key!=='frequencyHours'))throw new EmailError('EMAIL_PREFERENCES_INVALID','Preferências de e-mail inválidas.');
      for(const key of Object.keys(preferenceKeys))if(key in input&&typeof input[key]!=='boolean')throw new EmailError('EMAIL_PREFERENCES_INVALID','Use opções de consentimento válidas.');
      if('frequencyHours'in input&&(!Number.isInteger(input.frequencyHours)||input.frequencyHours<1||input.frequencyHours>168))throw new EmailError('EMAIL_PREFERENCES_INVALID','A frequência deve ficar entre 1 e 168 horas.');
      return db.transaction(async()=>{
        await lockOwner(userId);
        const prior=await getPreferences(userId),next={...prior,...input},stamp=new Date(now()).toISOString();
        const newlyConsented=Object.keys(preferenceKeys).some(key=>input[key]===true&&prior[key]!==true);
        const consentedAt=newlyConsented?stamp:prior.consentedAt;
        await db.prepare('INSERT INTO email_preferences VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET wishlist_enabled=excluded.wishlist_enabled,digest_enabled=excluded.digest_enabled,cart_enabled=excluded.cart_enabled,news_enabled=excluded.news_enabled,collection_enabled=excluded.collection_enabled,price_enabled=excluded.price_enabled,frequency_hours=excluded.frequency_hours,consented_at=excluded.consented_at,source=excluded.source,updated_at=excluded.updated_at').run(userId,...Object.keys(preferenceKeys).map(key=>+next[key]),next.frequencyHours,consentedAt,'account',stamp);
        if(!next.wishlistEnabled||!next.digestEnabled)await db.prepare("UPDATE email_wishlist_digest_events SET status='DISCARDED',processed_at=? WHERE user_id=? AND status='PENDING'").run(now(),userId);
        else if(next.frequencyHours!==prior.frequencyHours)await db.prepare("UPDATE email_wishlist_digest_events SET due_at=? WHERE user_id=? AND status='PENDING'").run(nextDigestDue(now(),next.frequencyHours),userId);
        return getPreferences(userId);
      });
    },
    async queueWishlist({userId,to,name,items,wishlistIds,eventKey,digest=false}={}) {
      if(!userId||typeof eventKey!=='string'||!eventKey||eventKey.length>256||!Array.isArray(items)||!items.length||items.length>50)return {queued:false,reason:'empty'};
      return db.transaction(async()=>{
        await lockOwner(userId);
        const preferences=await getPreferences(userId);
        if(!preferences.wishlistEnabled||!preferences.consentedAt||(digest&&!preferences.digestEnabled))return {queued:false,reason:'consent'};
        const owner=await db.prepare('SELECT email FROM users WHERE id=?').get(userId);
        if(!owner||owner.email.toLowerCase()!==String(to).toLowerCase()||await emailStore.isSuppressed(to))return {queued:false,reason:'suppressed'};
        const key='wishlist/'+eventHash(userId+':'+eventKey);
        if(await db.prepare('SELECT event_key FROM email_notification_events WHERE event_key=?').get(key))return {queued:false,reason:'duplicate'};
        const at=now(),eligible=await emailStore.currentWishlistItems({userId,wishlistIds,items,now:at});
        if(!eligible.length)return {queued:false,reason:'wishlist-consent'};
        if(preferences.digestEnabled){
          const dueAt=nextDigestDue(at,preferences.frequencyHours),ids=JSON.stringify([...new Set(wishlistIds)]);
          const values=eligible.flatMap(item=>['wishlist-pending/'+eventHash(key+':'+item.productId+':'+item.variantId),key,userId,ids,JSON.stringify({productId:item.productId,variantId:item.variantId}),at,dueAt]);
          await db.prepare("INSERT INTO email_wishlist_digest_events(event_key,source_key,user_id,wishlist_ids_json,item_json,created_at,due_at) VALUES "+eligible.map(()=>'(?,?,?,?,?,?,?)').join(',')+" ON CONFLICT(event_key) DO NOTHING").run(...values);
          await db.prepare("INSERT INTO email_notification_events VALUES(?,?,'wishlist-pending',NULL,?)").run(key,userId,new Date(at).toISOString());
          return {queued:false,pending:true,reason:'digest',dueAt:new Date(dueAt).toISOString()};
        }
        const threshold=new Date(at-preferences.frequencyHours*3600000).toISOString();
        if(await db.prepare("SELECT event_key FROM email_notification_events WHERE user_id=? AND category='wishlist' AND created_at>? LIMIT 1").get(userId,threshold))return {queued:false,reason:'frequency'};
        const email=await emailStore.enqueue({key,template:'wishlist-available',to,data:{name,items:eligible,wishlistIds:[...new Set(wishlistIds)],productUrl:eligible[0].productUrl,demo:env.BKM_ENVIRONMENT==='demo',notificationUserId:userId,consentVerified:true}});
        await db.prepare("INSERT INTO email_notification_events VALUES(?,?,'wishlist',?,?)").run(key,userId,email.id,new Date(at).toISOString());
        return {queued:true,emailId:email.id};
      });
    },
    async processDigests({limit=10,now:providedNow}={}) {
      const at=providedNow===undefined?now():providedNow;
      if(!Number.isInteger(limit)||limit<1||limit>20||!Number.isSafeInteger(at)||at<0||at>8640000000000000)throw new EmailError('EMAIL_QUEUE_LIMIT_INVALID','Limite ou horário de processamento inválido.');
      const result={processed:0,queued:0,discarded:0,deferred:0,remaining:0};
      const owners=await db.prepare("SELECT user_id,MIN(due_at) due_at FROM email_wishlist_digest_events WHERE status='PENDING' AND due_at<=? GROUP BY user_id ORDER BY due_at,user_id LIMIT ?").all(at,limit);
      for(const candidate of owners)await db.transaction(async()=>{
        await lockOwner(candidate.user_id);
        const pending=await db.prepare("SELECT * FROM email_wishlist_digest_events WHERE user_id=? AND status='PENDING' AND due_at<=? ORDER BY created_at,event_key LIMIT 50").all(candidate.user_id,at);
        if(!pending.length)return;
        result.processed++;
        const preferences=await getPreferences(candidate.user_id),owner=await db.prepare('SELECT email,name FROM users WHERE id=?').get(candidate.user_id);
        if(!owner||!preferences.wishlistEnabled||!preferences.digestEnabled||!preferences.consentedAt||await emailStore.isSuppressed(owner.email)){
          result.discarded+=await finishPending(pending,{at});return;
        }
        const previous=await latestWishlist(candidate.user_id),earliest=Math.min(...pending.map(row=>Number(row.due_at)));
        const due=Math.max(earliest,previous?nextDigestDue(Date.parse(previous.created_at),preferences.frequencyHours):0);
        if(due>at){await db.prepare("UPDATE email_wishlist_digest_events SET due_at=? WHERE user_id=? AND status='PENDING' AND due_at<?").run(due,candidate.user_id,due);result.deferred++;return;}
        // Bound each batch to 50 events and 100 owned wishlist references. Extra
        // events stay pending for a later period rather than being discarded.
        const selected=[],wishIds=new Set();
        for(const row of pending){const ids=JSON.parse(row.wishlist_ids_json),combined=new Set([...wishIds,...ids]);if(combined.size>100)continue;ids.forEach(id=>wishIds.add(id));selected.push(row);}
        const items=selected.map(row=>JSON.parse(row.item_json));
        const current=await emailStore.currentWishlistItems({userId:candidate.user_id,wishlistIds:[...wishIds],items,now:at});
        if(!current.length){result.discarded+=await finishPending(selected,{at});return;}
        const key='wishlist-digest/'+eventHash(candidate.user_id+':'+selected.map(row=>row.event_key).sort().join(':'));
        const email=await emailStore.enqueue({key,template:'wishlist-digest',to:owner.email,data:{name:owner.name,items:current,wishlistIds:[...wishIds],productUrl:current[0].productUrl,demo:env.BKM_ENVIRONMENT==='demo',notificationUserId:candidate.user_id,consentVerified:true}});
        await db.prepare("INSERT INTO email_notification_events VALUES(?,?,'wishlist',?,?) ON CONFLICT(event_key) DO NOTHING").run(key,candidate.user_id,email.id,new Date(at).toISOString());
        result.discarded+=await finishPending(selected,{emailId:email.id,availableIds:new Set(current.map(item=>item.variantId)),at});
        const nextDue=nextDigestDue(at,preferences.frequencyHours);
        await db.prepare("UPDATE email_wishlist_digest_events SET due_at=? WHERE user_id=? AND status='PENDING' AND due_at<?").run(nextDue,candidate.user_id,nextDue);
        result.queued++;
      });
      result.remaining=Number((await db.prepare("SELECT COUNT(*) count FROM email_wishlist_digest_events WHERE status='PENDING'").get()).count);
      return result;
    },
    async trackCart({userId,items}={}) {
      if(!userId||!Array.isArray(items)||items.length>100||items.some(item=>typeof item.variantId!=='string'||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>1000))throw new EmailError('EMAIL_CART_INVALID','Carrinho inválido para acompanhamento.');
      const clean=items.map(({variantId,quantity})=>({variantId,quantity}));
      await db.prepare('INSERT INTO email_cart_tracking VALUES(?,?,?,NULL) ON CONFLICT(user_id) DO UPDATE SET items_json=excluded.items_json,updated_at=excluded.updated_at,converted_at=NULL').run(userId,JSON.stringify(clean),new Date(now()).toISOString());
      return {tracked:true,automationEnabled:false};
    },
    async markCartConverted(userId){await db.prepare('UPDATE email_cart_tracking SET converted_at=? WHERE user_id=?').run(new Date(now()).toISOString(),userId);return {automationEnabled:false};}
  };
}
module.exports={createEmailNotifications};
