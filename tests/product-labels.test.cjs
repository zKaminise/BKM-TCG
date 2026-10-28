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
