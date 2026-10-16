const crypto=require('node:crypto');
function createCollections({db,ApiError,audit,imageUrl}) {
  function serialize(row) { return {id:row.id,name:row.name,aliases:JSON.parse(row.aliases_json),description:row.description,image:row.image,featured:!!row.featured,provider:row.provider,metadata:JSON.parse(row.metadata_json),createdAt:row.created_at,updatedAt:row.updated_at}; }
  async function list(query) {
    const rows=await db.prepare('SELECT * FROM collections ORDER BY featured DESC,name').all();
    const q=String(query.get('q') || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    return {items:rows.filter(row=>!q || [row.id,row.name,...JSON.parse(row.aliases_json)].join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(q)).map(serialize)};
  }
  async function save(data,user,id) {
    const key=String(id || data.id || '').trim(),name=String(data.name || '').trim();
    if(!/^[a-zA-Z0-9_+-]{1,100}$/.test(key) || !name || name.length>200) throw new ApiError(422,'VALIDATION','Informe identificador e nome válidos para a coleção.');
    const aliases=data.aliases || [];
    if(!Array.isArray(aliases) || aliases.length>30 || aliases.some(value=>typeof value!=='string'||value.length>100)) throw new ApiError(422,'VALIDATION','Aliases inválidos.');
    const description=String(data.description || '').slice(0,5000),image=data.image ? imageUrl(data.image) : '',stamp=new Date().toISOString();
    const previous=await db.prepare('SELECT * FROM collections WHERE id=?').get(key);
    if(id && !previous) throw new ApiError(404,'NOT_FOUND','Coleção não encontrada.');
    if(!id && previous) throw new ApiError(409,'CONFLICT','Esta coleção já está cadastrada.');
    await db.transaction(async()=>{
      if(previous) await db.prepare('UPDATE collections SET name=?,aliases_json=?,description=?,image=?,featured=?,updated_at=? WHERE id=?').run(name,JSON.stringify([...new Set(aliases)]),description,image,+!!data.featured,stamp,key);
      else await db.prepare('INSERT INTO collections VALUES(?,?,?,?,?,?,?,?,?,?)').run(key,name,JSON.stringify([...new Set(aliases)]),description,image,+!!data.featured,data.provider==='tcgdex'?'tcgdex':'manual',JSON.stringify(data.metadata && typeof data.metadata==='object'?data.metadata:{}),stamp,stamp);
      await audit(user.id,previous?'COLLECTION_UPDATED':'COLLECTION_CREATED',key);
    });
    return serialize(await db.prepare('SELECT * FROM collections WHERE id=?').get(key));
  }
  return {list,save};
}
module.exports={createCollections};
