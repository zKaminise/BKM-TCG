const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');

class Element {
  constructor(tag, props = {}, children = []) {
    Object.assign(this, { tag, children: [], parent: null, attributes: { ...props }, events: {} }, props);
    this.classes = new Set((props.class || '').split(' '));
    this.classList = { toggle: (key, on) => on ? this.classes.add(key) : this.classes.delete(key) };
    for (const [name, value] of Object.entries(props)) if (name.startsWith('on')) this.addEventListener(name.slice(2).toLowerCase(), value);
    this.append(...children);
  }
  append(...children) {
    for (const child of children.flat(Infinity).filter(child => child != null && child !== false)) {
      if (child instanceof Element) child.parent = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children) {
    for (const child of this.children) if (child instanceof Element) child.parent = null;
    this.children = [];
    this.append(...children);
  }
  set textContent(value) { this.replaceChildren(value); }
  get textContent() { return this.children.map(child => child instanceof Element ? child.textContent : String(child)).join(' '); }
  get isConnected() { return this.parent ? this.parent.isConnected : this.tag === 'body'; }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(name, callback) { (this.events[name] ||= []).push(callback); }
  removeEventListener(name, callback) { this.events[name] = (this.events[name] || []).filter(fn => fn !== callback); }
  fire(name, props) { return Promise.all((this.events[name] || []).map(fn => fn({ target: this, currentTarget: this, preventDefault() {}, ...props }))); }
  querySelectorAll(selector) {
    const [first, ...tail] = selector.split(' ');
    const [tag, name, value] = first.match(/^([\w-]*)\[([\w-]+)="?([\w-]+)"?\]$/)?.slice(1) || [];
    const matches = node => first.startsWith('.') ? node.classes.has(first.slice(1)) : name ? (!tag || node.tag === tag) && node.attributes[name] === value : node.tag === first;
    const found = this.children.flatMap(child => child instanceof Element ? [...(matches(child) ? [child] : []), ...child.querySelectorAll(first)] : []);
    return tail.length ? found.flatMap(node => node.querySelectorAll(tail.join(' '))) : found;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  contains(node) { return node === this || Boolean(node?.parent && this.contains(node.parent)); }
  focus() {}
  blur() {}
  scrollIntoView() {}
  reportValidity() { return !this.querySelectorAll('input').some(input => input.error); }
  setCustomValidity(error) { this.error = error; }
}

test('collection wizard follows the latest live query, then saves a selected printing and photo with no price panels', async t => {
  const previous = { window: global.window, localStorage: global.localStorage };
  t.after(() => Object.assign(global, previous));
  const storage = new Map(), requests = [], routes = [];
  global.window = { addEventListener() {} };
  global.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const card = { id: 'sv03.5-025', setId: 'sv03.5', setName: '151', displayNumber: '025/165', name: 'Pikachu', image: 'https://example.com/high.webp', imageSmall: 'https://example.com/low.webp', language: 'pt', referenceLanguage: 'pt' };
  const photoUrl = '/api/account/collection/photos/fca8c9da-3c15-470d-84b2-bc1c4e0eaec4';
  let releaseOld, saved;
  const el = (tag, props, ...children) => new Element(tag, props, children);
  const field = (text, name, type, value, props) => el('label', {}, text, el(type === 'textarea' ? type : 'input', { name, type, value, ...props }));
  const ctx = {
    el, field,
    button: (text, onClick, cls, props) => el('button', { class: cls, type: 'button', onClick, ...props }, text),
    selectField: (text, name, options, value) => el('label', {}, text, el('select', { name, value }, options.map(([value, label]) => el('option', { value }, label)))),
    checkbox: (text, name, checked) => el('label', {}, text, el('input', { name, checked })),
    message: text => el('p', {}, text), image: (src, alt, cls) => el('img', { src, alt, class: cls }), svgIcon: () => el('svg', {}),
    money: value => `R$ ${(value / 100).toFixed(2).replace('.', ',')}`, navigate: path => routes.push(path), toast() {}, getState: () => ({ user: { id: 'test-owner' } }),
    api: async (path, options = {}) => {
      const url = new URL(path, 'https://test.invalid');
      requests.push({ url, signal: options.signal });
      if (url.pathname.endsWith('/catalog/search')) {
        assert.equal(url.searchParams.get('view'), 'quick');
        assert.equal(url.searchParams.has('language'), false);
        if (url.searchParams.get('q') === 'Pikachu') return new Promise(resolve => { releaseOld = resolve; });
        return { items: [card], total: 1 };
      }
      if (url.pathname.endsWith('/catalog/card')) return { ...card, availableVariants: ['HOLO'] };
      if (url.pathname.endsWith('/photos')) {
        assert.deepEqual(options.body, { data: 'dGVzdA==', mime: 'image/png' });
        return { url: photoUrl };
      }
      if (url.pathname.endsWith('/inventory/batch')) { saved = options.body; return { added: 1 }; }
      throw Error(`Unexpected request ${path}`);
    }
  };
  const { createCollectionUI } = await import('../collection-ui.js');
  const wizard = await createCollectionUI(ctx).wizard();
  el('body', {}, wizard);
  await wizard.querySelector('.collection-type-button').fire('click');
  const form = wizard.querySelector('.collection-search-form'), input = form.querySelector('input');
  assert.equal(form.querySelectorAll('input').length, 1);
  assert.doesNotMatch(wizard.textContent, /Idioma do catálogo|Coleção de referência|Atualizar pesquisa|Estimativa em reais/i);
  input.value = 'Pikachu'; await input.fire('input'); await delay(220);
  input.value = '025/165'; await input.fire('input'); await delay(220);
  assert.equal(requests[0].signal.aborted, true);
  releaseOld({ items: [{ ...card, name: 'Resultado antigo' }], total: 1 });
  await delay(0);
  assert.doesNotMatch(wizard.textContent, /Resultado antigo/);
  assert.match(wizard.querySelector('.collection-search-result').textContent, /Pikachu 025\/165 151/);
  assert.equal(wizard.querySelector('.collection-search-result').querySelector('img').src, card.imageSmall);

  const cta = wizard.querySelector('.collection-wizard-continue');
  assert.equal(cta.hidden, true);
  await wizard.querySelector('.collection-search-add').fire('click');
  assert.equal(cta.hidden, false);
  assert.match(cta.textContent, /1 item selecionado Preencher detalhes/);
  input.value = ''; await input.fire('input'); await delay(220);
  assert.equal(requests.length, 2);
  assert.equal(wizard.querySelectorAll('.collection-search-result').length, 0);
  await cta.querySelector('.collection-wizard-primary').fire('click');
  const details = wizard.querySelector('.collection-item-form');
  assert.equal(details.querySelector('select[name="variant"]').value, 'HOLO');
  await details.querySelectorAll('input[name="condition"]').find(node => node.value === 'NM').fire('change');
  const paid = details.querySelector('input[name="paidCents"]');
  paid.value = '14,50'; await paid.fire('input');
  const photo = details.querySelector('input[type="file"]');
  photo.files = [new File(['test'], 'pikachu.png', { type: 'image/png' })]; await photo.fire('change');
  assert.match(details.textContent, /Foto enviada/);
  assert.doesNotMatch(details.textContent, /Estimativa em reais|Referência internacional|Referência de mercado/i);

  await details.fire('submit');
  const review = wizard.querySelector('.collection-review');
  assert.match(review.textContent, /Valor pago: R\$ 14,50/);
  assert.doesNotMatch(review.textContent, /Estimativa em reais|Referência internacional|Referência de mercado/i);
  await review.fire('submit'); await delay(0);
  assert.equal(saved.items[0].cardId, card.id);
  assert.equal(saved.items[0].photoUrl, photoUrl);
  assert.equal(saved.items[0].condition, 'NM');
  assert.equal(saved.items[0].paidCents, 1450);
  assert.deepEqual(routes, ['/conta/colecao']);
  assert.equal(storage.size, 0);
});
