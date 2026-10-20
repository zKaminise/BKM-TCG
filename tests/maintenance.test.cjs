const test = require('node:test');
const assert = require('node:assert/strict');

test('manutenção interrompe todas as APIs antes de conectar ao banco ou processar webhooks', async () => {
  const previous = process.env.BKM_MAINTENANCE_MODE;
  process.env.BKM_MAINTENANCE_MODE = 'true';
  try {
    const { default: handler } = await import('../api/index.js');
    for (const [method, url] of [['GET', '/api/session'], ['POST', '/api/auth/register'], ['POST', '/api/email/webhook/resend']]) {
      let status, headers, text;
      await handler({method, url}, {writeHead(code, values) {status=code;headers=values;},end(value) {text=value;}});
      assert.equal(status, 503);
      assert.equal(headers['Cache-Control'], 'no-store');
      assert.equal(headers['Retry-After'], '60');
      assert.equal(JSON.parse(text).error.code, 'MAINTENANCE');
    }
  } finally {
    if (previous === undefined) delete process.env.BKM_MAINTENANCE_MODE;
    else process.env.BKM_MAINTENANCE_MODE = previous;
  }
});
