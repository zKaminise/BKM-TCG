'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderEmail } = require('../server/email.cjs');

const base = 'https://lojabkm.com.br';
const env = { BKM_PUBLIC_URL: base, BKM_ENVIRONMENT: 'staging', HOSTING_DEMO_ONLY: 'false' };
const card = (overrides = {}) => ({
  productId: 'fixture-product', variantId: 'fixture-variant', slug: 'pikachu-ex-fixture', name: 'Pikachu ex',
  priceCents: 12345, language: 'pt', condition: 'NM', finish: 'HOLO', setName: 'Heróis Excelsos', number: '276/217',
  image: 'https://assets.example.test/pikachu.webp?size=large&fit=contain', productUrl: `${base}/produto/pikachu-ex-fixture`,
  ...overrides,
});
const links = html => [...html.matchAll(/\b(href|src)="([^"]*)"/g)].map(match => ({ attribute: match[1], url: match[2].replace(/&amp;/g, '&') }));

for (const template of ['wishlist-available', 'wishlist-digest']) {
  test(`email wishlist template ${template} mostra cada carta e preço BRL sem totais de pedido`, () => {
    const second = card({ productId: 'fixture-second', variantId: 'fixture-second-variant', slug: 'eevee-fixture', name: 'Eevee',
      priceCents: 7850, language: 'en', condition: 'LP', finish: 'REVERSE', setName: 'Coleção de teste', number: '005/100',
      image: 'https://assets.example.test/eevee.webp', productUrl: `${base}/produto/eevee-fixture` });
    const result = renderEmail(template, { name: 'Colecionador', items: [card(), second], subtotalCents: 0, shippingCents: 0, totalCents: 0, trackingCode: 'IGNORED-WISHLIST-TRACKING' }, { env });
    for (const value of ['Pikachu ex', 'Heróis Excelsos', '276/217', 'pt', 'NM', 'HOLO', 'Eevee', 'Coleção de teste', '005/100', 'en', 'LP', 'REVERSE']) {
      assert.ok(result.html.includes(value), `${template}: campo ausente no HTML: ${value}`);
      assert.ok(result.text.includes(value), `${template}: campo ausente no texto: ${value}`);
    }
    for (const output of [result.html, result.text]) {
      assert.match(output, /R\$\s*123,45/u);
      assert.match(output, /R\$\s*78,50/u);
      assert.doesNotMatch(output, /Subtotal|Desconto|Frete|\bTotal\b|R\$\s*0,00|IGNORED-WISHLIST-TRACKING|E-mail transacional/u);
      assert.ok(output.includes(`${base}/conta/preferencias`));
      assert.match(output, /autorizou notificações da sua lista de desejos/u);
    }
    assert.ok(result.text.includes(`${base}/produto/pikachu-ex-fixture`));
    assert.ok(result.text.includes(`${base}/produto/eevee-fixture`));
    const attributes = links(result.html);
    assert.equal(attributes.filter(value => value.attribute === 'src').length, 3, 'logo e duas imagens de cartas');
    assert.ok(attributes.some(value => value.attribute === 'src' && value.url === card().image));
    for (const { attribute, url } of attributes) {
      const parsed = new URL(url);
      assert.equal(parsed.protocol, 'https:');
      assert.equal(parsed.username + parsed.password, '');
      if (attribute === 'href') assert.equal(parsed.origin, base);
    }
    if (template === 'wishlist-digest') assert.ok(result.text.includes(`${base}/conta/desejos`));
  });
}

test('email wishlist template escapa texto e atributos sem executar conteúdo cadastrado', () => {
  const item = card({ name: 'Pikachu " ><script>alert(1)</script>', setName: 'A & B <img src=x onerror=alert(2)>',
    number: '" onmouseover="alert(3)', language: '<svg onload=alert(4)>', condition: "NM' <iframe>", finish: '<b>HOLO</b>',
    image: 'https://assets.example.test/card.webp?caption="test"&next=<script>',
    productUrl: `${base}/produto/x?label="teste"&next=<script>` });
  const result = renderEmail('wishlist-digest', { items: [item] }, { env });
  assert.ok(result.html.includes('&lt;script&gt;'));
  assert.ok(result.html.includes('A &amp; B &lt;img'));
  assert.ok(result.html.includes('&quot; onmouseover=&quot;'));
  assert.ok(result.html.includes('&lt;svg onload='));
  assert.doesNotMatch(result.html, /<script|<svg|<iframe|<b>HOLO|<[^>]+\son(?:error|load|mouseover)\s*=/i);
  for (const { url } of links(result.html)) {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, 'https:');
    assert.equal(parsed.username + parsed.password, '');
  }
  assert.ok(result.text.includes('A & B <img'), 'texto puro preserva o conteúdo sem transformá-lo em HTML');
});

test('email wishlist template omite imagens inseguras e mantém links somente na rota canônica de produto', () => {
  const unsafe = ['javascript:alert(1)', 'data:image/svg+xml,<svg onload=alert(1)>', 'http://images.example.test/card.png',
    'https://fixture-user:fixture-password@images.example.test/card.png', 'ftp://images.example.test/card.png'];
  const items = unsafe.map((image, index) => card({ image, productUrl: image, slug: `safe-fallback-${index}`, name: `Carta ${index}` }));
  items.push(card({ image: null, productUrl: `${base}/admin`, slug: 'safe-admin-fallback' }));
  items.push(card({ image: null, productUrl: 'https://external.example.test/produto/other', slug: null }));
  items.push(null);
  const result = renderEmail('wishlist-digest', { items }, { env });
  const attributes = links(result.html);
  assert.equal(attributes.filter(value => value.attribute === 'src').length, 1, 'somente a logo, nenhuma imagem insegura');
  for (const { attribute, url } of attributes) {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, 'https:');
    assert.equal(parsed.origin, base);
    assert.equal(parsed.username + parsed.password, '');
    if (attribute === 'href') assert.match(parsed.pathname, /^\/$|^\/produto\/[^/]+$|^\/conta\/(?:desejos|preferencias)$/);
  }
  assert.ok(result.text.includes(`${base}/produto/safe-fallback-0`));
  assert.ok(result.text.includes(`${base}/produto/safe-admin-fallback`));
  assert.doesNotMatch(result.html + result.text, /javascript:|data:image|fixture-password|external\.example\.test|http:\/\/images|ftp:\/\//i);
  const local = renderEmail('wishlist-available', { items: [card({ image: '/assets/local-card.png' })] }, { env: { ...env, BKM_PUBLIC_URL: 'http://localhost:4173' } });
  assert.ok(local.html.includes('Imagem indisponível'), 'imagem de carta exige HTTPS inclusive no ambiente local');
});

test('email wishlist template indica metadados e preço ausentes sem inventar valor zero', () => {
  const result = renderEmail('wishlist-available', { items: [card({ priceCents: null, setName: null, number: null, language: null, condition: null, finish: null })] }, { env });
  for (const output of [result.html, result.text]) {
    assert.ok(output.includes('Preço indisponível'));
    assert.ok(output.includes('Não informad'));
    assert.doesNotMatch(output, /R\$\s*0,00/u);
  }
});

test('email wishlist template preserva totais e rastreamento de pedidos e segurança da recuperação', () => {
  const order = renderEmail('order-confirmation', { orderNumber: 'QA-123', orderId: 'fixture-order', items: [{ name: 'Carta do pedido', quantity: 2, unitPriceCents: 1000 }],
    subtotalCents: 2000, discountCents: 100, shippingCents: 500, totalCents: 2400, trackingCode: 'TRACK-QA-123' }, { env });
  assert.ok(order.html.includes('Subtotal'));
  assert.ok(order.html.includes('Desconto'));
  assert.ok(order.html.includes('Frete'));
  assert.match(order.html, /R\$\s*24,00/u);
  assert.match(order.text, /Total: R\$\s*24,00/u);
  assert.ok(order.html.includes('TRACK-QA-123'));
  assert.ok(order.html.includes('E-mail transacional referente à sua conta ou pedido.'));
  assert.ok(order.html.includes(`${base}/conta/pedidos/fixture-order`));
  const resetUrl = `${base}/recuperar-senha?token=fixture-private-reset-token`;
  const reset = renderEmail('password-reset', { resetUrl }, { env });
  assert.ok(reset.html.includes(resetUrl));
  const preview = renderEmail('password-reset', { resetUrl }, { env, redactSecrets: true });
  assert.doesNotMatch(preview.html + preview.text, /fixture-private-reset-token/);
  assert.throws(() => renderEmail('password-reset', { resetUrl: 'https://external.example.test/reset' }, { env }), error => error.code === 'EMAIL_RESET_URL_INVALID');
});
