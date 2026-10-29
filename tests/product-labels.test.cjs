const test=require('node:test'),assert=require('node:assert/strict');
test('buyer sees kind and exact physical variant instead of calling custom items sealed',async()=>{
  const {productKindLabel,productKindPath,productVariantText}=await import('../product-labels.js');
  assert.equal(productKindLabel('CUSTOM'),'Personalizado');assert.equal(productKindPath('CUSTOM'),'/busca?kind=CUSTOM');
  assert.equal(productKindLabel('SINGLE',{plural:true}),'Cartas avulsas');assert.equal(productKindLabel('SEALED'),'Lacrado');
  assert.equal(productVariantText({language:'zh-tw',condition:'SP',finish:'MASTER_BALL',attributes:['PROMO','FIRST_EDITION','PROMO']}),'Chinês tradicional · Slightly Played · Master Ball · Promocional · 1ª edição');
  assert.equal(productVariantText({language:'pt',condition:'NM',finish:'NORMAL',attributes:['STAMP']},{includeLanguage:false}),'Near Mint · Normal · Carimbo');
  assert.match(productVariantText({language:'en',condition:'LP',finish:'FOIL'}),/LP.*Foil/);
  assert.equal(productVariantText({language:'id',condition:'CUSTOM',finish:'NORMAL'}),'Indonésio · Não se aplica · Normal');
});

test('catalog cards show distinct conservation codes and availability before opening the product',async()=>{
 const {catalogCardConditions}=await import('../product-labels.js');
 assert.deepEqual(catalogCardConditions({kind:'SEALED',variants:[{condition:'SEALED',stock:1}]}),[]);
 assert.deepEqual(catalogCardConditions({kind:'CUSTOM',variants:[{condition:'CUSTOM',stock:1}]}),[]);
 const values=catalogCardConditions({kind:'SINGLE',variants:[{condition:'HP',stock:2},{condition:'NM',stock:0},{condition:'NM',stock:1},{condition:'M',stock:0},{condition:'SP',stock:1}]});
 assert.deepEqual(values.map(v=>v.code),['M','NM','SP','HP']);assert.equal(values.find(v=>v.code==='NM').available,true);assert.equal(values[0].available,false);assert.equal(values[1].label,'Near Mint');
});
