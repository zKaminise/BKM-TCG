'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCatalogProvider } = require('./catalog.cjs');
const set = { id: 'sv09', name: 'Amigos de Jornada', cardCount: { official: 159, total: 190 }, serie: { id: 'sv', name: 'Escarlate e Violeta' }, cards: [{ id: 'sv09-025', localId: '025', name: 'Carta A' }, { id: 'sv09-TG01', localId: 'TG01', name: 'Carta B' }] };
const card = (id = 'sv09-025', localId = '025') => ({ id, localId, name: 'Carta A', rarity: 'Rare', hp: 100, types: ['Lightning'], image: `https://assets.tcgdex.net/pt/sv/sv09/${localId}`, set: { id: 'sv09', cardCount: { official: 159, total: 190 } } });
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

test('coleção + número com zeros recupera apenas correspondência local e metadados normalizados', async () => {
  const calls = [];
  const provider = createCatalogProvider({ fetch: async url => { calls.push(url); return response(url.includes('/sets/') ? set : card()); } });
  const result = await provider.searchCards({ language: 'pt', set: 'sv09', number: '00025/159' });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'tcgdex:pt:sv09-025');
  assert.equal(result.items[0].providerId, 'sv09-025');
  assert.equal(result.items[0].number, '025');
  assert.equal(result.items[0].total, 159);
  assert.equal(result.items[0].image, 'https://assets.tcgdex.net/pt/sv/sv09/025/high.webp');
  assert.equal(result.items[0].imageKind, 'reference');
  assert.deepEqual(calls, ['https://api.tcgdex.net/v2/pt/sets/sv09', 'https://api.tcgdex.net/v2/pt/cards/sv09-025']);
  assert.equal('stock' in result.items[0], false);
  assert.equal('price' in result.items[0], false);
});

test('número alfanumérico é comparado sem diferenciar maiúsculas e zeros', async () => {
  const provider = createCatalogProvider({ fetch: async url => response(url.includes('/sets/') ? set : card('sv09-TG01', 'TG01')) });
  const result = await provider.searchCards({ set: 'sv09', number: 'tg0001' });
  assert.equal(result.items[0].number, 'TG01');
});

test('entrada inválida não dispara rede; pt-br resolve explicitamente para pt', async () => {
  let count = 0;
  const provider = createCatalogProvider({ fetch: async url => { count++; assert.equal(url, 'https://api.tcgdex.net/v2/pt/sets'); return response([set]); } });
  for (const input of [{ language: 'fr', set: 'sv09', number: '1' }, { set: '../secret', number: '1' }, { set: 'sv09', number: '1?name=abc' }, { set: 'sv09', number: '' }]) {
    await assert.rejects(provider.searchCards(input), error => error.status === 400);
  }
  assert.equal(count, 0);
  const result = await provider.listSets({ language: 'pt-br' });
  assert.equal(result.language, 'pt');
  assert.equal(count, 1);
});

test('cache tem TTL, limite e não expõe referências mutáveis; consultas iguais são coalescidas', async () => {
  let count = 0, timestamp = 0;
  const provider = createCatalogProvider({ maxEntries: 1, ttlMs: 10, now: () => timestamp, fetch: async () => { count++; return response([set]); } });
  const [a, b] = await Promise.all([provider.listSets(), provider.listSets()]);
  assert.equal(count, 1);
  a.items[0].name = 'Alterada';
  assert.equal(b.items[0].name, set.name);
  assert.equal((await provider.listSets()).items[0].name, set.name);
  await provider.listSets({ language: 'en' });
  assert.equal(provider.cacheInfo().entries, 1);
  timestamp = 20;
  await provider.listSets({ language: 'en' });
  assert.equal(count, 3);
});

test('falha transitória faz somente uma repetição, mas 404 não repete nem cacheia', async () => {
  let count = 0;
  const provider = createCatalogProvider({ delay: async () => {}, fetch: async () => { count++; return response(count === 1 ? { error: 'temporary' } : [set], count === 1 ? 503 : 200); } });
  assert.equal((await provider.listSets()).items.length, 1);
  assert.equal(count, 2);
  const unavailable = createCatalogProvider({ delay: async () => {}, fetch: async () => { count++; return response({ error: 'missing' }, 404); } });
  await assert.rejects(unavailable.listSets(), error => error.status === 404 && error.code === 'CATALOG_NOT_FOUND');
  assert.equal(count, 3);
  assert.equal(unavailable.cacheInfo().entries, 0);
});

test('timeout aborta as duas tentativas e informa 504 com alternativa manual', async () => {
  let count = 0;
  const provider = createCatalogProvider({ timeoutMs: 2, delay: async () => {}, fetch: async (_url, { signal }) => {
    count++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
  } });
  await assert.rejects(provider.listSets(), error => error.status === 504 && error.code === 'CATALOG_TIMEOUT' && error.message.includes('manual'));
  assert.equal(count, 2);
  assert.equal(provider.cacheInfo().pending, 0);
});

test('não aceita carta retornada de outra coleção nem imagens de host arbitrário', async () => {
  const mismatched = createCatalogProvider({ fetch: async url => response(url.includes('/sets/') ? set : { ...card(), set: { id: 'other' } }) });
  await assert.rejects(mismatched.searchCards({ set: 'sv09', number: '25' }), error => error.code === 'CATALOG_RESPONSE_INVALID');
  const unsafeImage = createCatalogProvider({ fetch: async url => response(url.includes('/sets/') ? set : { ...card(), image: 'https://example.org/private.png' }) });
  const result = await unsafeImage.searchCards({ set: 'sv09', number: '25' });
  assert.equal(result.items[0].image, null);
  assert.equal(result.warnings.length, 1);
});

test('coleção sem cobertura retorna vazio e nunca usa outro idioma', async () => {
  let count = 0;
  const provider = createCatalogProvider({ fetch: async url => { count++; assert.match(url, /\/pt\/sets\/sv09$/); return response({ ...set, cards: [] }); } });
  const result = await provider.searchCards({ set: 'sv09', number: '25' });
  assert.deepEqual(result.items, []);
  assert.equal(count, 1);
  assert.match(result.warnings[0], /cadastro manual/);
});

test('coleções japonesas com sinal de mais usam ID genuíno codificado na URL', async () => {
  const provider = createCatalogProvider({ fetch: async url => {
    assert.equal(url, 'https://api.tcgdex.net/v2/ja/sets/SM1%2B');
    return response({ ...set, id: 'SM1+', cards: [] });
  } });
  const result = await provider.searchCards({ language: 'ja', set: 'SM1+', number: '001' });
  assert.equal(result.set.id, 'SM1+');
});

test('resposta malformada e resposta excessiva falham como 502', async () => {
  const malformed = createCatalogProvider({ fetch: async () => new Response('<html>bad</html>') });
  await assert.rejects(malformed.listSets(), error => error.status === 502 && error.code === 'CATALOG_RESPONSE_INVALID');
  const oversized = createCatalogProvider({ fetch: async () => new Response('{}', { headers: { 'content-length': String(3 * 1024 * 1024) } }) });
  await assert.rejects(oversized.listSets(), error => error.code === 'CATALOG_RESPONSE_INVALID');
});
