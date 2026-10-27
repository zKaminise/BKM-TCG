const test=require('node:test');
const assert=require('node:assert/strict');
const domain=()=>import('../collection-domain.js');

test('collection money accepts real pt-BR amounts with exact cents and distinguishes empty from zero',async()=>{
  const {parseCollectionMoney:parse,collectionDecimal}=await domain();
  for(const [input,expected]of[[null,null],['',null],['  ',null],['0',0],['0,00',0],['0.10',10],['150',15000],['150,50',15050],['1.234,56',123456],['R$ 1.234,56',123456],['1000000',100000000]])assert.equal(parse(input),expected,String(input));
  for(const input of['-10','1,2,3','NaN','Infinity','150,123','1.23,45','1e5','2/3','1000000,01'])assert.throws(()=>parse(input),Error,input);
  assert.equal(collectionDecimal(null),'');assert.equal(collectionDecimal(0),'0,00');assert.equal(collectionDecimal(15050),'150,50');
});

test('copy acquisition preserves catalog identity and independently touched fields, with explicit overwrite',async()=>{
  const {collectionCopyAcquisition:copy}=await domain();
  const queue=[{kind:'CARD',cardId:'sv03.5-166',paidCents:10000,condition:'NM',language:'pt',variant:'HOLO',attributes:['PROMO'],acquiredAt:'2026-10-10',touched:{paidCents:true}}, {kind:'CARD',cardId:'sv03.5-170',paidCents:15000,condition:'',language:'en',variant:'NORMAL',attributes:[],touched:{paidCents:true}},{kind:'SEALED',title:'ETB',condition:'SEALED',variant:'NORMAL',attributes:[],touched:{condition:true}}];
  const result=copy(queue,0);
  assert.equal(result[1].cardId,'sv03.5-170');assert.equal(result[1].paidCents,15000);assert.equal(result[1].condition,'NM');assert.equal(result[1].language,'pt');assert.equal(result[2].condition,'SEALED');assert.equal(result[2].paidCents,10000);
  assert.equal(queue[1].condition,'');result[1].attributes.push('STAMP');assert.deepEqual(queue[0].attributes,['PROMO']);
  assert.equal(copy(queue,0,{overwrite:true})[1].paidCents,10000);
});

test('mixed queue batch keeps per-unit metadata, optional values and stable caller idempotency key',async()=>{
  const {collectionBatchPayload:payload,collectionQueueTotals:totals,collectionDraftKey,collectionDate}=await domain();
  const queue=[{kind:'CARD',cardId:'sv03.5-166',setId:'sv03.5',card:{name:'Bulbasaur',language:'en'},referenceLanguage:'en',language:'pt',condition:'NM',paidCents:10000},{kind:'CARD',cardId:'sv03.5-170',setId:'sv03.5',language:'pt',condition:'SP',paidCents:15000},{kind:'CUSTOM',title:'Playmat',paidCents:null,manualValueCents:null,quantity:1},{kind:'SEALED',title:'ETB',paidCents:0,quantity:2}];
  const result=payload(queue,'fixed-id');assert.equal(result.requestId,'fixed-id');assert.equal(result.items[0].referenceLanguage,'en');assert.equal(result.items[0].language,'pt');assert.equal(result.items[2].paidCents,null);assert.equal(result.items[3].paidCents,0);assert.ok(!('userId'in result.items[0]));assert.deepEqual(totals(queue),{quantity:5,knownCost:25000,unknownCost:1,unpriced:5});
  assert.notEqual(collectionDraftKey('alice'),collectionDraftKey('bob'));assert.throws(()=>collectionDraftKey(''));assert.equal(collectionDate('2026-10-27'),'27/10/2026');assert.equal(collectionDate(null),'Não informada');
});

test('bulk cost form changes only explicit fields: date-only preserves known costs and clear differs from zero',async()=>{
  const {collectionCostMutation:build}=await domain();
  assert.deepEqual(build({ids:['alice-1','alice-2'],changeDate:true,acquiredAt:'2026-10-20'}),{action:'cost',ids:['alice-1','alice-2'],acquiredAt:'2026-10-20'});
  assert.equal(Object.hasOwn(build({ids:['alice-1'],changeDate:true,acquiredAt:null}),'paidCents'),false);
  assert.throws(()=>build({ids:['alice-1']}),/Informe um custo/);
  assert.deepEqual(build({ids:['alice-1'],costTouched:true,paidCents:null}),{action:'cost',ids:['alice-1'],paidCents:null,mode:'unit'});
  assert.deepEqual(build({ids:['alice-1'],costTouched:true,paidCents:0}),{action:'cost',ids:['alice-1'],paidCents:0,mode:'unit'});
  assert.deepEqual(build({ids:['alice-1'],costTouched:true,paidCents:10000,mode:'total',changeDate:true,acquiredAt:'2026-10-20'}),{action:'cost',ids:['alice-1'],paidCents:10000,mode:'total',acquiredAt:'2026-10-20'});
});
