const crypto = require('node:crypto');
const {assertPassword,assertPasswordConfirmation}=require('./password-policy.cjs');
const STATES = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
function createCustomerProfile({db,ApiError,hashPassword,verifyPassword}) {
  const invalid = message => { throw new ApiError(422,'VALIDATION',message); };
  function str(value,label,max=200,required=false) {
    if (value == null && !required) return '';
    if (typeof value !== 'string' || value.trim().length>max || required && !value.trim()) invalid(`Revise ${label}.`);
    return value.trim();
  }
  async function current(id,lock=false) { const row=await db.prepare('SELECT * FROM users WHERE id=?'+(lock?db.lockSuffix:'')).get(id); if(!row) throw new ApiError(401,'UNAUTHENTICATED','Entre novamente na sua conta.'); return row; }
  const profile = row => { try { return JSON.parse(row.profile_json || '{}'); } catch { return {}; } };
  function address(data,id) {
    const zip=str(data.zip,'o CEP',12,true).replace(/\D/g,'');
    const state=str(data.state,'a UF',2,true).toUpperCase();
    if (!/^\d{8}$/.test(zip) || !STATES.has(state)) invalid('Informe CEP e UF válidos.');
    if(data.default!==undefined && typeof data.default!=='boolean') invalid('Revise o endereço principal.');
    return {id,label:str(data.label,'o nome do endereço',60)||'Meu endereço',recipient:str(data.recipient,'o destinatário',120,true),zip,street:str(data.street,'a rua',160,true),number:str(data.number,'o número',30,true),complement:str(data.complement,'o complemento',120),district:str(data.district,'o bairro',100,true),city:str(data.city,'a cidade',100,true),state,default:!!data.default};
  }
  async function handle({user,method,path,body={}}) {
    if(path==='/api/account/addresses' && method==='GET') return {items:profile(await current(user.id)).addresses || []};
    if((path==='/api/account/addresses' && method==='POST') || /^\/api\/account\/addresses\/[^/]+$/.test(path) && ['PUT','DELETE'].includes(method)) {
      return db.transaction(async()=>{
        const row=await current(user.id,true), p=profile(row), items=Array.isArray(p.addresses)?p.addresses:[];
        const id=method==='POST'?crypto.randomUUID():path.split('/').at(-1), index=items.findIndex(item=>item.id===id);
        if(method!=='POST' && index<0) throw new ApiError(404,'ADDRESS_NOT_FOUND','Endereço não encontrado.');
        let saved;
        if(method==='DELETE') items.splice(index,1);
        else {
          if(method==='POST' && items.length>=20) invalid('Você pode salvar até 20 endereços.');
          saved=address(body,id);
          if(!items.length) saved.default=true;
          if(saved.default) items.forEach(item=>item.default=false);
          if(method==='POST') items.push(saved); else items[index]=saved;
        }
        if(items.length && !items.some(item=>item.default)) items[0].default=true;
        await db.prepare('UPDATE users SET profile_json=? WHERE id=?').run(JSON.stringify({...p,addresses:items}),user.id);
        return method==='DELETE'?{deleted:true}:{item:saved};
      });
    }
    if(path==='/api/account/security/password' && method==='POST') {
      assertPassword(body.password,invalid);
      assertPasswordConfirmation(body.password,body.confirmPassword,invalid);
      if(typeof body.currentPassword!=='string' || body.currentPassword.length>128) invalid('Informe sua senha atual.');
      const passwordHash=await hashPassword(body.password);
      await db.transaction(async()=>{
        const row=await current(user.id,true);
        if(!await verifyPassword(body.currentPassword,row.password_hash)) throw new ApiError(401,'INVALID_CREDENTIALS','A senha atual está incorreta.');
        await db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash,user.id);
        await db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
        await db.prepare('DELETE FROM password_resets WHERE user_id=?').run(user.id);
      });
      return {message:'Senha alterada. As outras sessões foram encerradas.'};
    }
    return null;
  }
  return {handle};
}
module.exports={createCustomerProfile};
