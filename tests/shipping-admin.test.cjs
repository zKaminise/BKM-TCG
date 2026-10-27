const test=require('node:test'),assert=require('node:assert/strict');
test('admin interpreta CEPs com limites inclusivos, ordenação e rejeição de sobreposição',async()=>{
  const {parseShippingCepRanges}=await import('../shipping-admin-ui.js');
  assert.deepEqual(parseShippingCepRanges('90010-000:90010-999\n01001000:01001999'),[{start:'01001000',end:'01001999'},{start:'90010000',end:'90010999'}]);
  assert.deepEqual(parseShippingCepRanges(''),[]);
  for(const value of['01001999:01001000','0100100x:01001999','00000000:01001999','01001000:01001999,01001999:01002999','01001000:01001999:12345678'])assert.throws(()=>parseShippingCepRanges(value));
});
test('admin não transforma tarifa vazia em frete grátis e mantém centavos exatos',async()=>{
  const {parseShippingMoney}=await import('../shipping-admin-ui.js');
  assert.equal(parseShippingMoney('0','frete'),0);assert.equal(parseShippingMoney('12.34','frete'),1234);assert.equal(parseShippingMoney('12,3','frete'),1230);assert.equal(parseShippingMoney('','frete',{nullable:true}),null);
  for(const value of['','1.005','1e2','-1','NaN','1 000','2,0.0'])assert.throws(()=>parseShippingMoney(value,'frete'));
  assert.throws(()=>parseShippingMoney('0','mínimo grátis',{minimum:1}));
});
