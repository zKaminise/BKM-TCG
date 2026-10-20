const crypto=require('node:crypto');
const {EmailError}=require('./email.cjs');
const preferenceKeys={wishlistEnabled:'wishlist_enabled',digestEnabled:'digest_enabled',cartEnabled:'cart_enabled',newsEnabled:'news_enabled',collectionEnabled:'collection_enabled',priceEnabled:'price_enabled'};
function createEmailNotifications({db,emailStore,env=process.env,now=()=>Date.now()}={}) {
  function view(row) {return {...Object.fromEntries(Object.entries(preferenceKeys).map(([key,column])=>[key,!!row?.[column]])),frequencyHours:row?.frequency_hours||24,consentedAt:row?.consented_at||null,source:row?.source||'account',abandonedCartAutomationEnabled:false};}
  async function getPreferences(userId){return view(await db.prepare('SELECT * FROM email_preferences WHERE user_id=?').get(userId));}
  return {
    getPreferences,
    async setPreferences(userId,input={}) {
      if(!userId||Object.keys(input).some(key=>!Object.hasOwn(preferenceKeys,key)&&key!=='frequencyHours'))throw new EmailError('EMAIL_PREFERENCES_INVALID','Preferências de e-mail inválidas.');
      for(const key of Object.keys(preferenceKeys))if(key in input&&typeof input[key]!=='boolean')throw new EmailError('EMAIL_PREFERENCES_INVALID','Use opções de consentimento válidas.');
      if('frequencyHours'in input&&(!Number.isInteger(input.frequencyHours)||input.frequencyHours<1||input.frequencyHours>168))throw new EmailError('EMAIL_PREFERENCES_INVALID','A frequência deve ficar entre 1 e 168 horas.');
      return db.transaction(async()=>{
        const prior=await getPreferences(userId),next={...prior,...input},stamp=new Date(now()).toISOString();
        const newlyConsented=Object.keys(preferenceKeys).some(key=>input[key]===true&&prior[key]!==true);
        const consentedAt=newlyConsented?stamp:prior.consentedAt;
        await db.prepare('INSERT INTO email_preferences VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET wishlist_enabled=excluded.wishlist_enabled,digest_enabled=excluded.digest_enabled,cart_enabled=excluded.cart_enabled,news_enabled=excluded.news_enabled,collection_enabled=excluded.collection_enabled,price_enabled=excluded.price_enabled,frequency_hours=excluded.frequency_hours,consented_at=excluded.consented_at,source=excluded.source,updated_at=excluded.updated_at').run(userId,...Object.keys(preferenceKeys).map(key=>+next[key]),next.frequencyHours,consentedAt,'account',stamp);
        return getPreferences(userId);
      });
    },
    async queueWishlist({userId,to,name,items,wishlistIds,eventKey,digest=false}={}) {
      if(!userId||typeof eventKey!=='string'||!eventKey||!Array.isArray(items)||!items.length)return {queued:false,reason:'empty'};
      return db.transaction(async()=>{
        if(db.engine==='postgres')await db.prepare('SELECT id FROM users WHERE id=? FOR UPDATE').get(userId);
        const preferences=await getPreferences(userId);
        if(!preferences.wishlistEnabled||!preferences.consentedAt||(digest&&!preferences.digestEnabled))return {queued:false,reason:'consent'};
        const owner=await db.prepare('SELECT email FROM users WHERE id=?').get(userId);
        if(!owner||owner.email.toLowerCase()!==String(to).toLowerCase()||await emailStore.isSuppressed(to))return {queued:false,reason:'suppressed'};
        const key='wishlist/'+crypto.createHash('sha256').update(userId+':'+eventKey).digest('hex');
        if(await db.prepare('SELECT event_key FROM email_notification_events WHERE event_key=?').get(key))return {queued:false,reason:'duplicate'};
        const threshold=new Date(now()-preferences.frequencyHours*3600000).toISOString();
        if(await db.prepare("SELECT event_key FROM email_notification_events WHERE user_id=? AND category='wishlist' AND created_at>? LIMIT 1").get(userId,threshold))return {queued:false,reason:'frequency'};
        const available=[];
        for(const item of items.slice(0,50)) {
          if(!item.variantId||!item.productId)continue;
          const row=await db.prepare("SELECT v.*,p.slug,p.name,p.images_json FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=? AND p.id=? AND v.active=1 AND p.published=1 AND p.archived=0").get(item.variantId,item.productId);
          if(!row)continue;
          const reservations=Number((await db.prepare("SELECT COALESCE(SUM(quantity),0) n FROM inventory_reservations WHERE variant_id=? AND status='ACTIVE' AND expires_at>?").get(row.id,now())).n);
          if(row.stock-reservations<1)continue;
          available.push({productId:item.productId,variantId:row.id,slug:row.slug,name:row.name,priceCents:row.price_cents,language:row.language,condition:row.condition,finish:row.finish,image:JSON.parse(row.images_json)[0]?.url||null});
        }
        if(!available.length)return {queued:false,reason:'unavailable'};
        const eligible=await emailStore.eligibleWishlistItems({userId,wishlistIds,items:available});
        if(!eligible.length)return {queued:false,reason:'wishlist-consent'};
        const email=await emailStore.enqueue({key,template:digest?'wishlist-digest':'wishlist-available',to,data:{name,items:eligible,wishlistIds:[...new Set(wishlistIds)],productUrl:'/produto/'+encodeURIComponent(eligible[0].slug),demo:env.BKM_ENVIRONMENT==='demo',notificationUserId:userId,consentVerified:true}});
        await db.prepare("INSERT INTO email_notification_events VALUES(?,?,'wishlist',?,?)").run(key,userId,email.id,new Date(now()).toISOString());
        return {queued:true,emailId:email.id};
      });
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
