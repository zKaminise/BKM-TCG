'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {once}=require('node:events');
const {PGlite}=require('@electric-sql/pglite');
const {createServer}=require('../serve.cjs');
const {hashToken}=require('../server/auth.cjs');
const uid=()=>crypto.randomUUID();

for(const engine of ['sqlite','postgres'])test('listagem de vários pedidos expira o lote uma vez, com isolamento do cliente: '+engine,async t=>{
  const pg=engine==='postgres'?new PGlite():null;
  const pgClient=pg?{query:async(sql,args)=>args?.length?pg.query(sql,args):(await pg.exec(sql)).at(-1),end:()=>pg.close()}:undefined;
  const server=createServer({dbPath:':memory:',databaseUrl:'',pgClient,env:{BKM_ENVIRONMENT:'demo',PAYMENT_PROVIDER:'mock',EMAIL_PROVIDER:'development'}});
  await server.api.ready;
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await server.api.close();});
  const db=server.api.asyncStore,base='http://127.0.0.1:'+server.address().port,users=[];
  for(const [name,role] of [['Buyer','CUSTOMER'],['Other','CUSTOMER'],['Admin','ADMIN'],['Empty','CUSTOMER']]){
    const id=uid(),token=crypto.randomBytes(32).toString('base64url'),created=new Date().toISOString();
    await db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(id,name.toLowerCase()+'@example.test',name,'isolated-unused-password',role,created);
    await db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(hashToken(token),id,'unused-csrf',Date.now()+3600000,Date.now());
    users.push({id,token});
  }
  const [buyer,other,admin,empty]=users,ids=[];
  for(let index=0;index<7;index++){
    const id=uid(),product=uid(),variant=uid(),payment='mock_'+crypto.randomBytes(16).toString('hex'),created=new Date(Date.now()-30*60000+index*1000).toISOString(),user=index<6?buyer:other;
    if(index<6)ids.unshift(id);
    await db.prepare("INSERT INTO products(id,slug,kind,name,description,sku,tcg,set_id,set_name,images_json,search_text,published,created_at,updated_at) VALUES(?,?,'SEALED','Fixture','Fixture',?,'pokemon','','','[]','fixture',1,?,?)").run(product,'isolated-'+product,'UNIT-'+product,created,created);
    await db.prepare("INSERT INTO variants(id,product_id,language,condition,finish,price_cents,stock) VALUES(?,?,'pt','SEALED','NORMAL',1000,1)").run(variant,product);
    await db.prepare("INSERT INTO orders(id,user_id,status,payment_status,shipping_status,currency,subtotal_cents,discount_cents,shipping_cents,total_cents,address_json,idempotency_key,created_at,updated_at,number,environment,contact_json) VALUES(?,?,'PENDING','PENDING','UNFULFILLED','BRL',1000,0,0,1000,'{}',?,?,?,?,'demo',?)").run(id,user.id,'list-'+id,created,created,'DEMO-'+id,JSON.stringify({name:'Fixture',email:'buyer@example.test'}));
    await db.prepare('INSERT INTO order_items VALUES(?,?,?,?,?,?,1,1000,1000)').run(uid(),id,variant,'Fixture','UNIT','{}');
    await db.prepare("INSERT INTO inventory_reservations VALUES(?,?,?,1,'ACTIVE',?,?)").run(uid(),variant,id,Date.now()-1000,created);
    await db.prepare("INSERT INTO payments VALUES(?,?,'mock','PENDING',1000,'BRL','demo',?,?,?)").run(payment,id,JSON.stringify({id:payment,provider:'mock',demo:true,status:'PENDING',expiresAt:new Date(Date.now()-1000).toISOString()}),created,created);
  }
  let transactions=0;const transact=db.transaction.bind(db);db.transaction=async fn=>{transactions++;return transact(fn);};
  const get=async(user,route='/api/account/orders')=>{const response=await fetch(base+route,{headers:{cookie:'bkm_session='+user.token}});return {status:response.status,data:await response.json()};};
  const result=await get(buyer);
  assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.items.length,6);assert.deepEqual(result.data.items.map(order=>order.id),ids);assert.equal(transactions,1,'a expiração acontece uma vez para o lote, fora do Promise.all de snapshots');
  for(const order of result.data.items){assert.equal(order.status,'CANCELLED');assert.equal(order.paymentStatus,'EXPIRED');assert.equal(order.items.length,1);assert.equal(order.history.length,1);assert.equal(order.history[0].status,'EXPIRED');}
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM orders WHERE user_id=? AND status='PENDING'").get(other.id)).n,1,'a lista privada não expira ou serializa pedidos de outro cliente');
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM inventory_reservations WHERE status='RELEASED'").get()).n,6);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM email_outbox').get()).n,6);
  const repeated=await get(buyer);assert.equal(repeated.status,200);assert.equal(transactions,2);assert.equal((await db.prepare('SELECT COUNT(*) n FROM order_history').get()).n,6);assert.equal((await db.prepare('SELECT COUNT(*) n FROM email_outbox').get()).n,6,'nova leitura não duplica cancelamentos ou mensagens');
  const all=await get(admin,'/api/admin/orders');assert.equal(all.status,200);assert.equal(all.data.items.length,7);assert.equal(transactions,3);assert.ok(all.data.items.every(order=>order.status==='CANCELLED'));
  const none=await get(empty);assert.equal(none.status,200);assert.deepEqual(none.data.items,[]);assert.equal(transactions,3,'lista vazia dispensa uma expiração global');
});
