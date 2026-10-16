const crypto=require('node:crypto');
const {EmailError}=require('./email.cjs');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const fingerprint=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function createEmailStore(db) {
  const fence=claim=>claim&&Number.isInteger(claim.attempts)&&Number.isFinite(claim.leaseUntil)?{sql:" AND status='PROCESSING' AND attempts=? AND locked_until=?",args:[claim.attempts,claim.leaseUntil]}:{sql:'',args:[]};
  return {
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
    async complete(id,{providerId,preview,now=Date.now(),claim}) { const f=fence(claim);return db.prepare("UPDATE email_outbox SET status='SENT',provider_id=?,preview_json=?,sent_at=?,locked_until=NULL,last_error=NULL WHERE id=?"+f.sql).run(providerId || null,preview?JSON.stringify(preview):null,new Date(now).toISOString(),id,...f.args); },
    async retry(id,{attempts,nextAttemptAt,errorCode,claim}) { const f=fence(claim);return db.prepare("UPDATE email_outbox SET status='PENDING',attempts=?,next_attempt_at=?,last_error=?,locked_until=NULL WHERE id=?"+f.sql).run(attempts,nextAttemptAt,errorCode,id,...f.args); },
    async fail(id,{errorCode,claim}) { const f=fence(claim);return db.prepare("UPDATE email_outbox SET status='FAILED',last_error=?,locked_until=NULL WHERE id=?"+f.sql).run(errorCode,id,...f.args); }
  };
}
module.exports={createEmailStore};
