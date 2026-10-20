const crypto = require('node:crypto');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const random = () => crypto.randomBytes(32).toString('base64url');
class GoogleAuthError extends Error {
  constructor(status, code, message) { super(message); Object.assign(this, { status, statusCode: status, code }); }
}
const fail = (status, code, message) => { throw new GoogleAuthError(status, code, message); };
function googleReadiness(env = process.env) {
  let callbackUrl = null;
  try {
    const base = new URL(env.BKM_PUBLIC_URL);
    if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost','127.0.0.1'].includes(base.hostname))) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error();
    callbackUrl = base.origin + '/api/auth/google/callback';
    if (env.GOOGLE_REDIRECT_URI && env.GOOGLE_REDIRECT_URI !== callbackUrl) throw new Error();
  } catch { return { enabled: false, callbackUrl: null, reason: 'URL canônica ou callback Google inválido.' }; }
  const enabled = env.GOOGLE_AUTH_ENABLED === 'true' && /^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(env.GOOGLE_CLIENT_ID || '') && typeof env.GOOGLE_CLIENT_SECRET === 'string' && env.GOOGLE_CLIENT_SECRET.length >= 10;
  return { enabled, callbackUrl, reason: enabled ? 'Google disponível.' : 'Google aguardando credenciais e ativação.' };
}
function safeReturn(value) {
  if (typeof value !== 'string' || value.length > 1000 || !/^\/(?!\/)/.test(value) || /[\\\r\n\0]/.test(value) || value.startsWith('/api/')) return '/conta';
  return value;
}
function createGoogleAuth({ db, env = process.env, fetchImpl = fetch, now = () => Date.now() } = {}) {
  let cachedKeys = [], keyExpiry = 0;
  const readiness = () => googleReadiness(env);
  function configured() { const config = readiness(); if (!config.enabled) fail(503,'GOOGLE_UNAVAILABLE','Login Google ainda não está configurado.'); return config; }
  async function request(url, options = {}) {
    let response;
    try { response = await fetchImpl(url,{ ...options, redirect:'error', signal:AbortSignal.timeout(8000) }); }
    catch { fail(502,'GOOGLE_PROVIDER_ERROR','Não foi possível concluir o login Google. Tente novamente.'); }
    if (!response.ok || Number(response.headers?.get?.('content-length') || 0) > 65536) fail(502,'GOOGLE_PROVIDER_ERROR','O Google não confirmou a autenticação.');
    let text;
    if (response.body?.getReader) {
      const reader=response.body.getReader(),chunks=[];let bytes=0;
      for (;;) { const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>65536){await reader.cancel();fail(502,'GOOGLE_PROVIDER_ERROR','Resposta Google inválida.');}chunks.push(Buffer.from(part.value)); }
      text=Buffer.concat(chunks).toString('utf8');
    } else text=await response.text();
    if(Buffer.byteLength(text)>65536)fail(502,'GOOGLE_PROVIDER_ERROR','Resposta Google inválida.');
    try { return {data:JSON.parse(text),headers:response.headers}; } catch { fail(502,'GOOGLE_PROVIDER_ERROR','Resposta Google inválida.'); }
  }
  async function keys(force=false) {
    if(!force && cachedKeys.length && keyExpiry>now())return cachedKeys;
    const result=await request('https://www.googleapis.com/oauth2/v3/certs');
    if(!Array.isArray(result.data.keys)||result.data.keys.length>20)fail(502,'GOOGLE_JWKS_INVALID','Chaves Google indisponíveis.');
    cachedKeys=result.data.keys.filter(key=>key.kty==='RSA' && key.use==='sig' && (!key.alg||key.alg==='RS256') && typeof key.kid==='string');
    const age=Number((result.headers?.get?.('cache-control')||'').match(/max-age=(\d+)/)?.[1]||300);
    keyExpiry=now()+Math.max(60000,Math.min(age*1000,3600000));
    return cachedKeys;
  }
  async function validateIdToken(token,nonceHash) {
    if(typeof token!=='string'||token.length>16384||!token.split('.').every(value=>/^[A-Za-z0-9_-]+$/.test(value))||token.split('.').length!==3)fail(401,'GOOGLE_TOKEN_INVALID','Identidade Google inválida.');
    const parts=token.split('.');let header,claims;
    try{header=JSON.parse(Buffer.from(parts[0],'base64url'));claims=JSON.parse(Buffer.from(parts[1],'base64url'));}catch{fail(401,'GOOGLE_TOKEN_INVALID','Identidade Google inválida.');}
    if(header.alg!=='RS256'||typeof header.kid!=='string'||header.kid.length>200||header.crit)fail(401,'GOOGLE_TOKEN_INVALID','Assinatura Google inválida.');
    let key=(await keys()).find(value=>value.kid===header.kid);
    if(!key)key=(await keys(true)).find(value=>value.kid===header.kid);
    if(!key)fail(401,'GOOGLE_TOKEN_INVALID','Chave Google desconhecida.');
    let valid=false;
    try{const publicKey=crypto.createPublicKey({key,format:'jwk'});valid=publicKey.asymmetricKeyDetails.modulusLength>=2048&&crypto.verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),publicKey,Buffer.from(parts[2],'base64url'));}catch{}
    const seconds=Math.floor(now()/1000),aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
    if(!valid||!['accounts.google.com','https://accounts.google.com'].includes(claims.iss)||!aud.includes(env.GOOGLE_CLIENT_ID)||(aud.length>1&&claims.azp!==env.GOOGLE_CLIENT_ID)||(claims.azp&&claims.azp!==env.GOOGLE_CLIENT_ID)||!Number.isInteger(claims.exp)||claims.exp<=seconds-30||!Number.isInteger(claims.iat)||claims.iat>seconds+60||claims.iat<seconds-86400||claims.exp<=claims.iat||(claims.nbf&&claims.nbf>seconds+30)||typeof claims.nonce!=='string'||sha(claims.nonce)!==nonceHash||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>255||claims.email_verified!==true||typeof claims.email!=='string'||claims.email.length>254||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(claims.email))fail(401,'GOOGLE_TOKEN_INVALID','O Google não confirmou uma identidade válida e verificada.');
    return {subject:claims.sub,email:claims.email.toLowerCase(),name:String(claims.name||'Colecionador').replace(/[\u0000-\u001f\u007f]/g,'').slice(0,120)||'Colecionador'};
  }
  return {
    readiness,
    async start({session,mode='login',returnTo='/conta'}={}) {
      const config=configured();
      if(!session?.token_hash || !['login','link'].includes(mode))fail(403,'GOOGLE_SESSION_REQUIRED','Atualize a página antes de continuar.');
      if(mode==='link'&&!session.user)fail(401,'UNAUTHENTICATED','Entre na conta BKM antes de vincular Google.');
      if(mode==='link'&&session.user.role==='ADMIN')fail(403,'GOOGLE_ADMIN_LINK_FORBIDDEN','O acesso administrativo permanece com a autenticação BKM.');
      const state=random(),nonce=random(),verifier=random(),stamp=new Date(now()).toISOString();
      await db.prepare('DELETE FROM oauth_states WHERE expires_at<?').run(now());
      await db.prepare('INSERT INTO oauth_states VALUES(?,?,?,?,?,?,?,?,NULL,?)').run(sha(state),session.token_hash,mode==='link'?session.user.id:null,mode,sha(nonce),verifier,safeReturn(returnTo),now()+10*60000,stamp);
      const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
      for(const [key,value] of Object.entries({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:config.callbackUrl,response_type:'code',scope:'openid email profile',state,nonce,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',prompt:'select_account'}))url.searchParams.set(key,value);
      return {authorizationUrl:url.href};
    },
    async finish({session,state,code,error}={}) {
      const config=configured();
      if(!session?.token_hash||typeof state!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(state))fail(403,'GOOGLE_STATE_INVALID','A autorização expirou ou não pertence a esta sessão.');
      const saved=await db.transaction(async()=>{
        const row=await db.prepare('SELECT * FROM oauth_states WHERE state_hash=?'+db.lockSuffix).get(sha(state));
        if(!row||row.used_at||row.expires_at<=now()||row.session_hash!==session.token_hash||(row.mode==='link'&&(!session.user||row.user_id!==session.user.id)))fail(403,'GOOGLE_STATE_INVALID','A autorização expirou ou não pertence a esta sessão.');
        await db.prepare('UPDATE oauth_states SET used_at=? WHERE state_hash=?').run(new Date(now()).toISOString(),row.state_hash);return row;
      });
      if(error)fail(400,'GOOGLE_CANCELLED','Login Google cancelado. Você pode tentar novamente.');
      if(typeof code!=='string'||!code||code.length>4096)fail(400,'GOOGLE_CODE_INVALID','Código Google inválido.');
      const exchanged=await request('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:config.callbackUrl,grant_type:'authorization_code',code_verifier:saved.code_verifier}).toString()});
      const identity=await validateIdToken(exchanged.data.id_token,saved.nonce_hash);
      return db.transaction(async()=>{
        if(db.engine==='postgres')await db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('google:'+identity.subject);
        const linked=await db.prepare("SELECT i.*,u.role FROM oauth_identities i JOIN users u ON u.id=i.user_id WHERE provider='google' AND subject=?").get(identity.subject);
        if(linked&&linked.role==='ADMIN')fail(403,'GOOGLE_ADMIN_LINK_FORBIDDEN','Use o acesso administrativo BKM.');
        let user,created=false;
        if(saved.mode==='link') {
          user=await db.prepare('SELECT * FROM users WHERE id=?').get(saved.user_id);
          if(!user||user.role==='ADMIN'||(linked&&linked.user_id!==user.id))fail(409,'GOOGLE_IDENTITY_CONFLICT','Esta identidade não pode ser vinculada à conta atual.');
          const other=await db.prepare("SELECT subject FROM oauth_identities WHERE user_id=? AND provider='google'").get(user.id);
          if(other&&other.subject!==identity.subject)fail(409,'GOOGLE_IDENTITY_CONFLICT','Esta conta já possui outra identidade Google vinculada.');
        } else if(linked)user=await db.prepare('SELECT * FROM users WHERE id=?').get(linked.user_id);
        else {
          if(db.engine==='postgres')await db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('google-email:'+identity.email);
          const prior=await db.prepare('SELECT id FROM users WHERE lower(email)=?').get(identity.email);
          if(prior)fail(409,'GOOGLE_ACCOUNT_LINK_REQUIRED','Já existe uma conta BKM com este e-mail. Entre com sua senha e vincule Google nas configurações da conta.');
          user={id:crypto.randomUUID(),email:identity.email,name:identity.name,role:'CUSTOMER'};
          await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,'oauth$google','CUSTOMER',?)").run(user.id,user.email,user.name,new Date(now()).toISOString());created=true;
        }
        if(!linked)await db.prepare("INSERT INTO oauth_identities VALUES(?,?,'google',?,?,?,?)").run(crypto.randomUUID(),user.id,identity.subject,identity.email,new Date(now()).toISOString(),new Date(now()).toISOString());
        else await db.prepare("UPDATE oauth_identities SET email=?,updated_at=? WHERE id=?").run(identity.email,new Date(now()).toISOString(),linked.id);
        return {user,created,linked:saved.mode==='link',returnTo:saved.return_to};
      });
    }
  };
}
module.exports={createGoogleAuth,googleReadiness,GoogleAuthError};
