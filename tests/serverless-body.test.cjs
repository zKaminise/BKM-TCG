const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {readJson}=require('../server/api.cjs');

function parsed(body,headers={}) {
  return {headers:{'content-type':'application/json',...headers},body,
    async *[Symbol.asyncIterator](){throw new Error('O stream consumido não deve ser lido novamente.');}};
}

test('JSON pré-processado pelo serverless conserva validação e limite em bytes',async()=>{
  const data={contact:{name:'João'},quantity:2};
  for(const body of [data,JSON.stringify(data),Buffer.from(JSON.stringify(data))]) assert.deepEqual(await readJson(parsed(body)),data);
  for(const body of [null,[],42,true,'not-json','"text"']) await assert.rejects(readJson(parsed(body)),error=>error.status===400 && error.code==='INVALID_JSON');
  const cycle={};cycle.self=cycle;
  await assert.rejects(readJson(parsed(cycle)),error=>error.code==='INVALID_JSON');
  await assert.rejects(readJson(parsed({value:'á'.repeat(30)}),30),error=>error.status===413);
  await assert.rejects(readJson(parsed({}, {'content-length':'200'}),100),error=>error.status===413);
  await assert.rejects(readJson(parsed({}, {'content-type':'text/plain'})),error=>error.status===415);
});

test('o mesmo leitor aceita o stream JSON de um servidor Node normal',async()=>{
  const request=Readable.from([Buffer.from('{"name":'),Buffer.from('"BKM TCG"}')]);request.headers={'content-type':'application/json; charset=utf-8'};
  assert.deepEqual(await readJson(request),{name:'BKM TCG'});
  const oversized=Readable.from([Buffer.from('{"message":"'+ 'x'.repeat(50)+'"}')]);oversized.headers={'content-type':'application/json'};
  await assert.rejects(readJson(oversized,20),error=>error.status===413);
});
