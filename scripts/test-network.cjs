const net = require('node:net');
const originalConnect = net.Socket.prototype.connect;
const local = host => host === undefined || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host);

// Last-resort guard: even a future fixture mistake cannot touch a hosted database/API.
net.Socket.prototype.connect = function (...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args;
  const first = normalized[0];
  const host = first && typeof first === 'object' ? first.host : typeof first === 'number' && typeof normalized[1] === 'string' ? normalized[1] : undefined;
  if (!local(host)) throw new Error('TEST_NETWORK_ISOLATION: testes só podem conectar ao loopback local.');
  return originalConnect.apply(this, args);
};

const originalFetch = globalThis.fetch;
globalThis.fetch = function (input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!local(url.hostname)) return Promise.reject(new Error('TEST_NETWORK_ISOLATION: chamadas externas devem usar um provedor simulado.'));
  return originalFetch(input, init);
};
