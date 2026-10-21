'use strict';

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const TEMPLATES = Object.freeze(['welcome','email-verification','password-reset','order-confirmation','payment-approved','payment-rejected','order-preparing','order-shipped','order-delivered','order-cancelled','order-refunded','wishlist-available','wishlist-digest','abandoned-cart','tracking-update']);
const NON_TRANSACTIONAL = new Set(['wishlist-available','wishlist-digest','abandoned-cart']);
const sha = value => createHash('sha256').update(value).digest('hex');
const clean = (value, max = 500) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
const escape = value => clean(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number.isSafeInteger(cents) ? cents / 100 : 0);
const emailValid = value => typeof value === 'string' && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);

class EmailError extends Error {
  constructor(code, message, { retryable = false, retryAfterMs = null } = {}) { super(message); this.name = 'EmailError'; this.code = code; this.status = code==='EMAIL_WEBHOOK_INVALID'?401:['EMAIL_EVENT_CONFLICT','EMAIL_QUEUE_CONFLICT'].includes(code)?409:['EMAIL_PREFERENCES_INVALID','EMAIL_CART_INVALID','EMAIL_TEMPLATE_INVALID'].includes(code)?422:503; this.statusCode = this.status; this.retryable = retryable; this.retryAfterMs = retryAfterMs; }
}

function publicBase(env) {
  try {
    const url = new URL(env.BKM_PUBLIC_URL || 'http://127.0.0.1:4173');
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) || url.username || url.password) throw new Error();
    return url.origin;
  } catch { throw new EmailError('EMAIL_URL_INVALID', 'A URL pública da loja é inválida.'); }
}

function safeLink(value, base, { sameOrigin = true } = {}) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, base);
    if ((url.protocol !== 'https:' && url.origin !== base) || url.username || url.password || (sameOrigin && url.origin !== base)) return null;
    return url.href;
  } catch { return null; }
}

function wishlistCard(item, base) {
  const candidates = [item.productUrl, typeof item.slug === 'string' && item.slug.trim() ? '/produto/' + encodeURIComponent(item.slug.trim()) : null];
  let url = null;
  for (const candidate of candidates) {
    const link = safeLink(candidate, base);
    if (link && /^\/produto\/[^/]+\/?$/.test(new URL(link).pathname)) { url = link; break; }
  }
  const imageLink = safeLink(item.image, base, { sameOrigin: false });
  const image = imageLink && new URL(imageLink).protocol === 'https:' ? imageLink : null;
  const name = clean(item.name || item.productName || 'Carta desejada', 200);
  const fields = [
    ['Coleção', clean(item.setName || 'Não informada', 160)],
    ['Número', clean(item.number || 'Não informado', 80)],
    ['Idioma', clean(item.language || 'Não informado', 50)],
    ['Condição', clean(item.condition || 'Não informada', 50)],
    ['Variante / acabamento', clean(item.finish || item.variant || 'Não informado', 80)],
  ];
  const price = Number.isSafeInteger(item.priceCents) && item.priceCents >= 0 ? money(item.priceCents) : 'Preço indisponível';
  const thumbnail = image ? `<img src="${escape(image)}" alt="${escape(name)}" width="88" height="122" style="display:block;max-width:88px;height:auto;border:0;border-radius:6px">` : '<span style="font-size:11px;color:#a1a6ad">Imagem indisponível</span>';
  const heading = url ? `<a href="${escape(url)}" style="color:#f4f5f6;text-decoration:none">${escape(name)}</a>` : escape(name);
  const details = fields.map(([label, value]) => `<span style="display:block"><strong>${label}:</strong> ${escape(value)}</span>`).join('');
  return {
    url,
    html: `<tr><td style="padding:16px 0;border-bottom:1px solid #282d33"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td width="100" valign="top" style="width:100px;padding-right:12px">${thumbnail}</td><td valign="top"><p style="margin:0 0 8px;font-size:16px;font-weight:bold">${heading}</p><p style="margin:0;font-size:12px;line-height:1.6;color:#a1a6ad">${details}</p><p style="margin:10px 0 0;font-size:16px;font-weight:bold;color:#44e5ed">Preço anunciado: ${escape(price)}</p>${url ? `<p style="margin:10px 0 0;font-size:13px"><a href="${escape(url)}" style="color:#44e5ed">Ver carta na loja</a></p>` : '<p style="margin:10px 0 0;font-size:12px;color:#a1a6ad">Consulte sua lista de desejos para localizar o anúncio.</p>'}</td></tr></table></td></tr>`,
    text: [name, ...fields.map(([label, value]) => `${label}: ${value}`), `Preço anunciado: ${price}`, url ? `Ver carta na loja: ${url}` : `Lista de desejos: ${base}/conta/desejos`].join('\n'),
  };
}

function renderEmail(template, data = {}, { env = process.env, redactSecrets = false } = {}) {
  if (!TEMPLATES.includes(template)) throw new EmailError('EMAIL_TEMPLATE_INVALID', 'Modelo de e-mail inválido.');
  const base = publicBase(env), demo = env.HOSTING_DEMO_ONLY === 'true' || env.BKM_ENVIRONMENT === 'demo' || data.demo === true;
  const storeName = clean(data.storeName || 'BKM TCG', 100), name = clean(data.customerName || data.name || 'colecionador', 100);
  const number = clean(data.orderNumber || data.number || '', 80);
  const orderLink = safeLink(data.orderUrl || `/conta/pedidos/${encodeURIComponent(data.orderId || '')}`, base) || `${base}/conta`;
  const wishlist = template === 'wishlist-available' || template === 'wishlist-digest';
  const items = Array.isArray(data.items) ? data.items.slice(0, 50) : [];
  const cards = wishlist ? items.filter(item => item && typeof item === 'object').map(item => wishlistCard(item, base)) : [];
  const messages = {
    welcome: ['Bem-vindo à BKM TCG', `Olá, ${name}. Sua conta na ${storeName} foi criada. Acesse a loja para explorar sua próxima descoberta.`, 'Explorar a loja', base],
    'order-confirmation': [`Pedido ${number} recebido`, `Olá, ${name}. Recebemos o pedido ${number}. Você pode acompanhar os detalhes e o andamento na sua conta.`, 'Ver pedido', orderLink],
    'payment-approved': [`Pagamento do pedido ${number} aprovado`, `Olá, ${name}. O pagamento do pedido ${number} foi aprovado${demo ? ' na simulação' : ''}. Acompanhe os próximos passos na sua conta.`, 'Acompanhar pedido', orderLink],
    'payment-rejected': [`Pagamento do pedido ${number} recusado`, `Olá, ${name}. O pagamento do pedido ${number} não foi aprovado${demo ? ' na simulação' : ''}. Consulte o pedido para conferir o resultado.`, 'Ver pedido', orderLink],
    'order-shipped': [`Pedido ${number} enviado`, `Olá, ${name}. O pedido ${number} foi enviado${demo ? ' no fluxo de demonstração' : ''}. Consulte os detalhes de entrega.`, 'Acompanhar entrega', orderLink],
    'tracking-update': [`Rastreamento do pedido ${number}`, `Olá, ${name}. Há uma atualização no rastreamento do pedido ${number}.`, 'Ver rastreamento', orderLink],
    'password-reset': ['Recuperação de senha — BKM TCG', `Olá, ${name}. Recebemos uma solicitação para redefinir sua senha. Se você não fez essa solicitação, ignore esta mensagem. O link é de uso único e expira em 30 minutos.`, 'Redefinir senha', redactSecrets ? `${base}/recuperar-senha` : safeLink(data.resetUrl, base)],
    'email-verification': ['Confirme seu e-mail — BKM TCG', `Olá, ${name}. Confirme o endereço de e-mail da sua conta pelo link seguro. Se não criou a conta, ignore esta mensagem.`, 'Confirmar e-mail', redactSecrets ? `${base}/conta` : safeLink(data.verificationUrl,base)],
    'order-preparing': [`Pedido ${number} em preparação`, `Olá, ${name}. Seu pedido ${number} está em preparação. Acompanhe as informações na sua conta.`, 'Ver pedido', orderLink],
    'order-delivered': [`Pedido ${number} entregue`, `Olá, ${name}. A entrega do pedido ${number} foi confirmada. Você pode conferir os itens e adicionar cartas recebidas à sua coleção.`, 'Ver pedido',orderLink],
    'order-cancelled': [`Pedido ${number} cancelado`, `Olá, ${name}. O pedido ${number} foi cancelado. Confira o histórico na sua conta.`, 'Ver pedido',orderLink],
    'order-refunded': [`Reembolso do pedido ${number}`, `Olá, ${name}. Há uma atualização de reembolso confirmada para o pedido ${number}. Consulte os detalhes na sua conta.`, 'Ver pedido',orderLink],
    'wishlist-available': ['Uma carta que você procura chegou à BKM TCG!', `Olá, ${name}. Uma carta compatível com suas preferências está disponível. A disponibilidade pode mudar e este aviso não reserva estoque.`, 'Ver carta na loja',cards[0]?.url || `${base}/conta/desejos`],
    'wishlist-digest': ['Suas cartas desejadas na BKM TCG', `Olá, ${name}. Confira as cartas disponíveis compatíveis com sua lista de desejos. Preços e disponibilidade são os do momento da consulta; nenhum item foi reservado.`, 'Ver cartas desejadas',`${base}/conta/desejos`],
    'abandoned-cart': ['Sua próxima descoberta espera por você', `Olá, ${name}. Você deixou itens no carrinho. Confira os preços e o estoque atuais antes de concluir; este lembrete não garante preço anterior nem reserva produtos.`, 'Rever carrinho',`${base}/carrinho`],
  };
  const [subject, message, cta, url] = messages[template];
  if (template === 'password-reset' && !url) throw new EmailError('EMAIL_RESET_URL_INVALID', 'Link de recuperação inválido.');
  if(template==='email-verification'&&!url)throw new EmailError('EMAIL_VERIFICATION_URL_INVALID','Link de verificação inválido.');
  const tableRows = wishlist ? '' : items.map(item => `<tr><td style="padding:12px 0;border-bottom:1px solid #282d33;color:#f4f5f6">${escape(item.name || item.productName)} <span style="color:#a1a6ad">× ${Number.isInteger(item.quantity) ? item.quantity : 1}</span></td><td style="padding:12px 0;text-align:right;border-bottom:1px solid #282d33;white-space:nowrap;color:#f4f5f6">${escape(money(item.subtotalCents ?? ((item.priceCents ?? item.unitPriceCents ?? 0) * (item.quantity || 1))))}</td></tr>`).join('');
  const totals = wishlist ? (cards.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0">${cards.map(card => card.html).join('')}</table>` : '') : items.length ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:24px 0;font-size:14px">${tableRows}<tr><td style="padding-top:16px;color:#a1a6ad">Subtotal</td><td align="right" style="padding-top:16px;color:#f4f5f6">${escape(money(data.subtotalCents))}</td></tr><tr><td style="color:#a1a6ad">Desconto</td><td align="right" style="color:#f4f5f6">− ${escape(money(data.discountCents))}</td></tr><tr><td style="color:#a1a6ad">Frete${demo ? ' demonstrativo' : ''}</td><td align="right" style="color:#f4f5f6">${escape(money(data.shippingCents))}</td></tr><tr><td style="padding-top:12px;font-weight:bold;color:#f4f5f6">Total</td><td align="right" style="padding-top:12px;font-size:22px;font-weight:bold;color:#44e5ed">${escape(money(data.totalCents))}</td></tr></table>` : '';
  const notice = demo ? '<p style="padding:12px;background:#29191d;border:1px solid #ff3038;color:#ff969b;font-size:12px">DEMONSTRAÇÃO — dados e pagamentos de teste. Nenhuma cobrança ou entrega comercial foi realizada.</p>' : '';
  const tracking = !wishlist && data.trackingCode ? `<p style="color:#d0d5db">Código de rastreamento: <strong>${escape(data.trackingCode)}</strong></p>` : '';
  const preferencesUrl = `${base}/conta/preferencias`;
  const footer = wishlist ? `Você recebe este alerta porque autorizou notificações da sua lista de desejos.<br><a href="${escape(preferencesUrl)}" style="color:#44e5ed">Gerenciar preferências e desativar alertas</a>` : 'E-mail transacional referente à sua conta ou pedido.';
  const redacted = redactSecrets && ['password-reset','email-verification'].includes(template) ? '<p style="color:#a1a6ad;font-size:12px">Prévia segura: o token de recuperação foi omitido. Nenhum e-mail foi enviado.</p>' : '';
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(subject)}</title></head><body style="margin:0;padding:28px 12px;background:#070809;font-family:Arial,Helvetica,sans-serif;color:#f4f5f6"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="width:100%;max-width:560px;background:#111417;border:1px solid #282d33;border-top:3px solid #ff3038;border-radius:16px"><tr><td style="padding:32px"><a href="${escape(base)}"><img src="${escape(`${base}/assets/bkm-logo-original.png`)}" width="96" height="96" alt="BKM TCG" style="display:block;border:0"></a><p style="font-size:11px;letter-spacing:3px;color:#44e5ed">SUA PRÓXIMA DESCOBERTA</p>${notice}<h1 style="font-size:26px;line-height:1.2;color:#f4f5f6">${escape(subject)}</h1><p style="font-size:15px;line-height:1.7;color:#d0d5db">${escape(message)}</p>${totals}${tracking}<p style="margin:28px 0"><a href="${escape(url || base)}" style="display:inline-block;background:#ff3038;color:#fff;font-weight:bold;text-decoration:none;padding:15px 22px;border-radius:8px">${escape(cta)}</a></p>${redacted}<p style="margin-top:32px;border-top:1px solid #282d33;padding-top:20px;font-size:12px;line-height:1.7;color:#a1a6ad">${escape(storeName)}<br>${footer}<br>${escape(data.storeContact || '')}</p></td></tr></table></td></tr></table></body></html>`;
  const itemLines = wishlist ? cards.map(card => card.text) : items.map(item => `${clean(item.name || item.productName)} × ${item.quantity || 1}`);
  const lines = [demo ? 'DEMONSTRAÇÃO — nenhuma cobrança ou entrega comercial.' : '', subject, message, ...itemLines, !wishlist && items.length ? `Total: ${money(data.totalCents)}` : '', !wishlist && data.trackingCode ? `Rastreamento: ${clean(data.trackingCode)}` : '', `${cta}: ${url || base}`, redactSecrets && template === 'password-reset' ? 'Prévia segura: token de recuperação omitido; nenhum envio externo.' : '', wishlist ? `Você recebe este alerta porque autorizou notificações da sua lista de desejos.\nGerenciar preferências e desativar alertas: ${preferencesUrl}` : '', storeName].filter(Boolean);
  return { template, demo, subject: `${demo ? '[DEMONSTRAÇÃO] ' : ''}${subject}`, html, text: lines.join('\n\n') };
}

class EmailProvider { async send() { throw new EmailError('EMAIL_PROVIDER_UNAVAILABLE', 'Provedor de e-mail indisponível.'); } }

function validateMessage(message, idempotencyKey) {
  if (!message || !emailValid(message.to) || typeof message.subject !== 'string' || !message.subject.trim() || /[\r\n]/.test(message.subject) || typeof message.html !== 'string' || Buffer.byteLength(message.html) > 250000 || typeof message.text !== 'string') throw new EmailError('EMAIL_MESSAGE_INVALID', 'Mensagem transacional inválida.');
  if (typeof idempotencyKey !== 'string' || !/^[a-zA-Z0-9_:/-]{1,256}$/.test(idempotencyKey)) throw new EmailError('EMAIL_IDEMPOTENCY_INVALID', 'Chave de e-mail inválida.');
}

class DevelopmentEmailProvider extends EmailProvider {
  constructor({ env = process.env } = {}) { super(); this.env = { ...env }; this.name = 'development'; }
  async send(message, { idempotencyKey } = {}) {
    validateMessage(message, idempotencyKey);
    // Re-render from private template data so reset tokens can never leak into previews.
    const rendered = message.template ? renderEmail(message.template, message.data || {}, { env: this.env, redactSecrets: true }) : { subject: message.subject, html: '<p>Prévia de modelo externo omitida por segurança.</p>', text: 'Prévia omitida por segurança.', demo: this.env.HOSTING_DEMO_ONLY === 'true' || this.env.BKM_ENVIRONMENT === 'demo' };
    const [local, domain] = message.to.split('@');
    return { id: `preview_${sha(idempotencyKey).slice(0, 40)}`, provider: 'development', delivered: false,
      preview: { ...rendered, toMasked: `${local.slice(0, 1)}***@${domain}`, externalSend: false } };
  }
}

function emailReadiness(env = process.env) {
  const allowlist=(env.RESEND_TEST_RECIPIENTS||'').split(',').map(value=>value.trim().toLowerCase()).filter(emailValid);
  const controlledDemo=env.BKM_ENVIRONMENT==='demo'&&env.RESEND_DEMO_TEST_ENABLED==='true'&&allowlist.length>0;
  const development = !controlledDemo && (env.HOSTING_DEMO_ONLY === 'true' || env.BKM_ENVIRONMENT === 'demo' || !env.EMAIL_PROVIDER || env.EMAIL_PROVIDER === 'development');
  const from = env.RESEND_FROM || '', parsedFrom = from.match(/^(?:[^<>\r\n]+ <)?([^<>\s]+@[^<>\s]+)>?$/)?.[1];
  const enabled = !development && (controlledDemo || ['staging','production'].includes(env.BKM_ENVIRONMENT)) && env.EMAIL_PROVIDER === 'resend' && env.RESEND_ENABLED === 'true' && env.RESEND_DOMAIN_VERIFIED === 'true' && typeof env.RESEND_API_KEY === 'string' && env.RESEND_API_KEY.length > 10 && emailValid(parsedFrom);
  return { provider: development ? 'development' : 'resend', enabled, externalSend: enabled, controlledDemo:enabled&&controlledDemo, reason: development ? 'Prévias privadas; nenhum envio externo.' : enabled ? controlledDemo?'Teste transacional restrito aos destinatários autorizados.':'Resend configurado; entrega confirmada somente por evento do provedor.' : 'Resend desativado até configurar chave, remetente e domínio verificado.' };
}

class ResendEmailProvider extends EmailProvider {
  constructor({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
    super(); if (!emailReadiness(env).enabled) throw new EmailError('EMAIL_PROVIDER_UNCONFIGURED', 'Resend não está habilitado neste ambiente.');
    if (typeof fetchImpl !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new TypeError('Transporte ou timeout inválido.');
    this.env = { ...env }; this.fetchImpl = fetchImpl; this.timeoutMs = timeoutMs; this.name = 'resend';
  }
  async send(message, { idempotencyKey } = {}) {
    validateMessage(message, idempotencyKey);
    const ready=emailReadiness(this.env);
    if (!ready.enabled || (message.demo===true&&!ready.controlledDemo)) throw new EmailError('EMAIL_DEMO_SEND_FORBIDDEN', 'E-mails de simulação exigem teste controlado explícito.');
    const base=new URL(publicBase(this.env));
    if(base.protocol!=='https:'||['localhost','127.0.0.1'].includes(base.hostname)||base.hostname.endsWith('.vercel.app'))throw new EmailError('EMAIL_CANONICAL_REQUIRED','Configure o domínio canônico HTTPS antes do envio real.');
    const controlledWishlist=['wishlist-available','wishlist-digest'].includes(message.template)&&message.data?.consentVerified===true;
    if(ready.controlledDemo && (!(this.env.RESEND_TEST_RECIPIENTS||'').split(',').map(value=>value.trim().toLowerCase()).includes(message.to.toLowerCase()) || (NON_TRANSACTIONAL.has(message.template)&&!controlledWishlist)))throw new EmailError('EMAIL_TEST_RECIPIENT_FORBIDDEN','O teste permite destinatários autorizados e alertas desejados com consentimento verificado.');
    const controller = new AbortController(); let timer;
    try {
      return await Promise.race([(async () => {
        const response = await this.fetchImpl('https://api.resend.com/emails', { method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { Authorization: `Bearer ${this.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({ from: this.env.RESEND_FROM, to: [message.to], subject: message.subject, html: message.html, text: message.text }) });
        if (Number(response.headers?.get?.('content-length') || 0) > 65536) throw new EmailError('EMAIL_RESPONSE_INVALID', 'Resposta de e-mail inválida.', { retryable: true });
        let raw = '';
        if (response.body?.getReader) {
          const reader = response.body.getReader(); let bytes = 0; const chunks = [];
          while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > 65536) { await reader.cancel(); throw new EmailError('EMAIL_RESPONSE_INVALID', 'Resposta de e-mail inválida.', { retryable: true }); } chunks.push(Buffer.from(part.value)); }
          raw = Buffer.concat(chunks).toString('utf8');
        } else raw = await response.text();
        if (Buffer.byteLength(raw) > 65536) throw new EmailError('EMAIL_RESPONSE_INVALID', 'Resposta de e-mail inválida.', { retryable: true });
        let result; try { result = JSON.parse(raw); } catch { throw new EmailError('EMAIL_RESPONSE_INVALID', 'Resposta de e-mail inválida.', { retryable: true }); }
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500 || (response.status === 409 && result?.name === 'concurrent_idempotent_requests');
          const after = Number(response.headers?.get?.('retry-after'));
          throw new EmailError('EMAIL_PROVIDER_ERROR', 'O provedor não aceitou o e-mail transacional.', { retryable, retryAfterMs: retryable && Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 3600000) : null });
        }
        if (typeof result.id !== 'string' || !/^[a-zA-Z0-9_-]{5,128}$/.test(result.id)) throw new EmailError('EMAIL_RESPONSE_INVALID', 'O provedor não confirmou o identificador do envio.', { retryable: true });
        // API acceptance is not an inbox delivery receipt.
        return { id: result.id, provider: 'resend', accepted: true, delivered: null };
      })(), new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new EmailError('EMAIL_TIMEOUT', 'Tempo de envio excedido; a fila tentará novamente com a mesma chave.', { retryable: true })); }, this.timeoutMs); })]);
    } catch (error) {
      if (error instanceof EmailError) throw error;
      throw new EmailError('EMAIL_NETWORK_ERROR', 'Falha de comunicação com o provedor de e-mail.', { retryable: true });
    } finally { clearTimeout(timer); }
  }
}

function createEmailProvider(options = {}) {
  const env = options.env || process.env;
  return emailReadiness(env).provider === 'development' ? new DevelopmentEmailProvider(options) : new ResendEmailProvider(options);
}

function createEmailDispatcher({ store, provider, env = process.env, now = () => Date.now(), random = Math.random, maxAttempts = 6 } = {}) {
  if (!store || !['enqueue', 'claimDue', 'complete', 'retry', 'fail'].every(key => typeof store[key] === 'function')) throw new TypeError('Store persistente de e-mail obrigatório.');
  const mailer = provider || createEmailProvider({ env });
  return {
    async enqueue(message, tx) {
      if (!message || !TEMPLATES.includes(message.template) || !emailValid(message.to) || !/^[a-zA-Z0-9_:/-]{1,256}$/.test(message.key || '')) throw new EmailError('EMAIL_QUEUE_INVALID', 'Evento de e-mail inválido.');
      return store.enqueue(message, tx);
    },
    async flush({ limit = 5 } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new EmailError('EMAIL_QUEUE_LIMIT_INVALID', 'Limite de processamento inválido.');
      const rows = await store.claimDue({ limit, now: now(), leaseUntil: now() + 300000 });
      const result = { processed: 0, sent: 0, previewed: 0, retried: 0, failed: 0 };
      for (let row of rows) {
        result.processed++;
        const attempts = (row.attempts || 0) + 1;
        try {
          // Provider deduplication expires after 24 h. Ambiguous deliveries older
          // than 23 h require manual reconciliation, never an automatic resend.
          const created = Date.parse(row.createdAt || row.created_at || '');
          if (mailer.name === 'resend' && attempts > 1 && Number.isFinite(created) && now() - created > 23 * 3600000) throw new EmailError('EMAIL_IDEMPOTENCY_WINDOW_EXPIRED', 'Envio antigo exige reconciliação antes de um novo disparo.');
          if(mailer.name==='resend'&&store.isSuppressed&&await store.isSuppressed(row.to))throw new EmailError('EMAIL_SUPPRESSED','O destinatário está suprimido por bounce ou reclamação.');
          if(mailer.name==='resend'&&NON_TRANSACTIONAL.has(row.template)) {
            if(row.template==='wishlist-digest'&&row.attempts===0&&store.prepareDigest){
              const prepared=await store.prepareDigest(row,{now:now()});
              if(!prepared)throw new EmailError('EMAIL_CONSENT_REQUIRED','O resumo não tem cartas com consentimento e disponibilidade ativos.');
              row=prepared;
            }
            if(row.template==='abandoned-cart'||!store.notificationAllowed||!await store.notificationAllowed(row))throw new EmailError('EMAIL_CONSENT_REQUIRED','O alerta não tem consentimento ativo; lembretes de carrinho permanecem desativados.');
          }
          const rendered = renderEmail(row.template, row.data, { env });
          const sent = await mailer.send({ ...rendered, to: row.to, data: row.data }, { idempotencyKey: row.key });
          await store.complete(row.id, { providerId: sent.id, preview: sent.preview || null, accepted:sent.accepted===true, now: now(), claim: row.claim });
          if (sent.accepted) result.sent++; else result.previewed++;
        } catch (error) {
          const errorCode = error instanceof EmailError ? error.code : 'EMAIL_DELIVERY_FAILED';
          if (error instanceof EmailError && error.retryable && attempts < maxAttempts) {
            const delay = Math.max(error.retryAfterMs || 0, Math.min(15 * 60000, 30000 * 2 ** Math.min(attempts - 1, 8)) + Math.floor(Math.max(0, Math.min(1, random())) * 10000));
            await store.retry(row.id, { attempts, nextAttemptAt: now() + delay, errorCode, claim: row.claim }); result.retried++;
          } else { await store.fail(row.id, { errorCode, claim: row.claim }); result.failed++; }
        }
      }
      return result;
    },
  };
}

function verifyResendWebhook({payload,headers={},secret,now=Date.now()}={}) {
  const body=Buffer.isBuffer(payload)?payload:typeof payload==='string'?Buffer.from(payload):null;
  const id=headers['svix-id'],timestamp=headers['svix-timestamp'],signature=headers['svix-signature'];
  if(!body||body.length>1024*1024||typeof secret!=='string'||!/^whsec_[A-Za-z0-9+/=]+$/.test(secret)||typeof id!=='string'||!/^[A-Za-z0-9_-]{5,200}$/.test(id)||typeof timestamp!=='string'||!/^\d{10}$/.test(timestamp)||Math.abs(now/1000-Number(timestamp))>300||typeof signature!=='string'||signature.length>4096)throw new EmailError('EMAIL_WEBHOOK_INVALID','Webhook de e-mail inválido.');
  const key=Buffer.from(secret.slice(6),'base64');
  if(key.length<16)throw new EmailError('EMAIL_WEBHOOK_INVALID','Chave do webhook inválida.');
  const expected=createHmac('sha256',key).update(id+'.'+timestamp+'.').update(body).digest();
  const valid=signature.split(' ').some(part=>{const pieces=part.split(',');if(pieces.length!==2||pieces[0]!=='v1'||!/^[A-Za-z0-9+/=]+$/.test(pieces[1]))return false;const received=Buffer.from(pieces[1],'base64');return received.length===expected.length&&timingSafeEqual(received,expected);});
  if(!valid)throw new EmailError('EMAIL_WEBHOOK_INVALID','Assinatura do webhook de e-mail inválida.');
  let event;try{event=JSON.parse(body);}catch{throw new EmailError('EMAIL_WEBHOOK_INVALID','Conteúdo do webhook inválido.');}
  if(!event||typeof event.type!=='string'||!event.type.startsWith('email.')||typeof event.data?.email_id!=='string'||!/^[-A-Za-z0-9_]{5,128}$/.test(event.data.email_id)||!Number.isFinite(Date.parse(event.created_at)))throw new EmailError('EMAIL_WEBHOOK_INVALID','Evento de e-mail inválido.');
  return {id,event};
}
module.exports = { EmailError, EmailProvider, DevelopmentEmailProvider, ResendEmailProvider, renderEmail, emailReadiness, createEmailProvider, createEmailDispatcher, verifyResendWebhook, TEMPLATES };
