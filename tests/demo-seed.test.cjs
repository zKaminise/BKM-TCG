const test = require('node:test');
const assert = require('node:assert/strict');
const { openStore } = require('../server/store.cjs');
const { seedDemo } = require('../scripts/seed-demo.cjs');
test('seed only populates a dedicated demo and never overwrites administrative edits', async () => {
  const store = openStore({dbPath:':memory:',env:{}});
  try {
    await assert.rejects(seedDemo({store,env:{BKM_ENVIRONMENT:'production'}}), /somente/);
    assert.equal((await store.prepare('SELECT COUNT(*) n FROM products').get()).n,0);
    const result=await seedDemo({store,env:{BKM_ENVIRONMENT:'demo'}});
    assert.equal(result.products,14);
    assert.equal((await store.prepare('SELECT COUNT(*) n FROM users').get()).n,0);
    assert.equal((await store.prepare('SELECT COUNT(*) n FROM collections').get()).n,4);
    assert.equal((await store.prepare("SELECT name FROM collections WHERE id='sv09'").get()).name,'Amigos de Jornada');
    const settings=JSON.parse((await store.prepare('SELECT value_json FROM settings').get()).value_json);
    assert.equal(settings.shipping.freeShippingThresholdCents,15000);
    assert.equal(settings.banners[0].url,'/cartas');
    assert.equal(settings.banners[0].active,true);
    await store.prepare('UPDATE variants SET price_cents=12345').run();
    const repeat=await seedDemo({store,env:{BKM_ENVIRONMENT:'demo'}});
    assert.equal(repeat.seeded,false);
    assert.ok((await store.prepare('SELECT price_cents FROM variants').all()).every(v=>v.price_cents===12345));
    await store.prepare("UPDATE settings SET value_json='{}'").run();
    await assert.rejects(seedDemo({store,env:{BKM_ENVIRONMENT:'demo'}}), /Nenhum dado foi alterado/);
    assert.equal((await store.prepare('SELECT COUNT(*) n FROM products').get()).n,14);
  } finally { await store.close(); }
});
