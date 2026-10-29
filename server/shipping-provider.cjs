// Read-only Melhor Envio quote/tracking adapter. Environment and credentials are explicit.
// No cart, checkout, label purchase, payment or cancellation API is exposed.
const API_ORIGINS={sandbox:'https://sandbox.melhorenvio.com.br',production:'https://melhorenvio.com.br'};
const MAX_RESPONSE_BYTES = 1024 * 1024;
class ShippingError extends Error {
  constructor(code, message, status = 502) { super(message); this.name = 'ShippingError'; this.code = code; this.status = status; }
}
function invalid(message) { throw new ShippingError('SHIPPING_INVALID_INPUT', message, 400); }
function responseInvalid() { throw new ShippingError('SHIPPING_INVALID_RESPONSE', 'Resposta de logística inválida ou incompleta.'); }
function postalCode(value) {
  if (typeof value !== 'string' || !/^\d{5}-?\d{3}$/.test(value.trim())) invalid('Informe um CEP brasileiro com 8 dígitos.');
  const normalized = value.trim().replace('-', '');
  if (normalized === '00000000') invalid('O CEP não pode ser composto somente por zeros.');
  return normalized;
}
function integer(value, min, max, label) { if (!Number.isSafeInteger(value) || value < min || value > max) invalid(`Informe ${label} dentro do intervalo permitido.`); return value; }
function decimal(value, min, max, label) { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) invalid(`Informe ${label} positivo e válido.`); return value; }
function brlToCents(value) {
  const source = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  if (typeof source !== 'string' || !/^(0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(source)) responseInvalid();
  const [whole, fraction = ''] = source.split('.'), result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result > 100000000) responseInvalid();
  return result;
}
function shippingReadiness(env = process.env) {
  const missing = [];
  if (env.SHIPPING_PROVIDER !== 'melhorenvio') missing.push('SHIPPING_PROVIDER');
  if (env.MELHOR_ENVIO_ENABLED !== 'true') missing.push('MELHOR_ENVIO_ENABLED');
  if (!Object.hasOwn(API_ORIGINS,env.MELHOR_ENVIO_ENVIRONMENT||'')) missing.push('MELHOR_ENVIO_ENVIRONMENT');
  if(env.MELHOR_ENVIO_ENVIRONMENT==='production'&&(env.BKM_ENVIRONMENT!=='production'||env.HOSTING_DEMO_ONLY==='true'))missing.push('BKM_ENVIRONMENT');
  const token = String(env.MELHOR_ENVIO_TOKEN || '');
  if (!/^[\x21-\x7e]{20,8192}$/.test(token)) missing.push('MELHOR_ENVIO_TOKEN');
  const userAgent = String(env.MELHOR_ENVIO_USER_AGENT || '');
  if (userAgent.length < 8 || userAgent.length > 250 || /[\r\n\x00-\x1f]/.test(userAgent) || !/[^\s<>@()]+@[^\s<>@()]+\.[a-z]{2,}/i.test(userAgent)) missing.push('MELHOR_ENVIO_USER_AGENT');
  try { postalCode(env.MELHOR_ENVIO_ORIGIN_ZIP); } catch { missing.push('MELHOR_ENVIO_ORIGIN_ZIP'); }
  const environment=Object.hasOwn(API_ORIGINS,env.MELHOR_ENVIO_ENVIRONMENT||'')?env.MELHOR_ENVIO_ENVIRONMENT:'unconfigured';
  return {provider:'melhorenvio',environment,enabled:missing.length===0,productionSupported:true,checkoutIntegrated:true,purchasesEnabled:false,mode:'quote_and_tracking_only',missing,reason:missing.length?'Cotação desativada: faltam ambiente explícito, credencial autorizada, contato técnico ou origem.':`Cotação e consulta de rastreio no ambiente ${environment}; compra de etiquetas permanece desativada.`};
}
function createShippingProvider({env = process.env, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 8000} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl deve ser uma função.');
  integer(timeoutMs, 100, 15000, 'timeout entre 100 e 15000 ms');
  const config = {...env};
  function ready() { const result = shippingReadiness(config); if (!result.enabled) throw new ShippingError('SHIPPING_NOT_CONFIGURED', result.reason, 503); return result; }
  async function request(path, payload) {
    ready();
    if (!['/api/v2/me/shipment/calculate','/api/v2/me/shipment/tracking'].includes(path)) throw new ShippingError('SHIPPING_OPERATION_DISABLED', 'Operação de contratação de frete indisponível.', 403);
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), timeoutMs);
    const aborted = new Promise((_,reject) => controller.signal.addEventListener('abort', () => reject(new ShippingError('SHIPPING_TIMEOUT', 'A consulta de logística excedeu o tempo limite.', 504)), {once:true}));
    const bounded = promise => Promise.race([promise,aborted]);
    try {
      const response = await bounded(fetchImpl(API_ORIGINS[config.MELHOR_ENVIO_ENVIRONMENT] + path, {method:'POST', redirect:'manual', signal:controller.signal, headers:{Authorization:`Bearer ${config.MELHOR_ENVIO_TOKEN}`, 'User-Agent':config.MELHOR_ENVIO_USER_AGENT, Accept:'application/json', 'Content-Type':'application/json'}, body:JSON.stringify(payload)}));
      if (!response.ok) {
        const status = response.status;
        if (status >= 300 && status < 400) throw new ShippingError('SHIPPING_REDIRECT_REJECTED', 'Redirecionamento inesperado do provedor de logística.');
        if (status === 401 || status === 403) throw new ShippingError('SHIPPING_AUTH_FAILED', 'A credencial de logística não foi autorizada pelo provedor.', 503);
        if (status === 429) throw new ShippingError('SHIPPING_RATE_LIMIT', 'Limite de consultas de logística atingido. Tente novamente mais tarde.', 503);
        if (status === 422 || status === 400) throw new ShippingError('SHIPPING_PROVIDER_REJECTED', 'O provedor não aceitou os dados desta consulta.', 422);
        throw new ShippingError('SHIPPING_PROVIDER_UNAVAILABLE', 'O provedor de logística está indisponível.', 503);
      }
      if (!/application\/(?:[\w.-]+\+)?json\b/i.test(response.headers.get('content-type') || '')) responseInvalid();
      if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) responseInvalid();
      const reader = response.body?.getReader();
      if (!reader) responseInvalid();
      const chunks = []; let size = 0;
      while (true) { const part = await bounded(reader.read()); if (part.done) break; size += part.value.byteLength; if (size > MAX_RESPONSE_BYTES) { reader.cancel().catch(()=>{}); responseInvalid(); } chunks.push(part.value); }
      let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { responseInvalid(); }
      return data;
    } catch (error) {
      if (error instanceof ShippingError) throw error;
      if (controller.signal.aborted) throw new ShippingError('SHIPPING_TIMEOUT', 'A consulta de logística excedeu o tempo limite.', 504);
      throw new ShippingError('SHIPPING_NETWORK_ERROR', 'Não foi possível consultar o provedor de logística.', 503);
    } finally { clearTimeout(timeout); }
  }
  async function quote({zip, items, volumes, services = []} = {}) {
    ready();
    const destination = postalCode(zip), origin = postalCode(config.MELHOR_ENVIO_ORIGIN_ZIP);
    if (items!==undefined && volumes!==undefined) invalid('Escolha cotação por produtos ou por volumes reais, sem misturar os dois formatos.');
    if (volumes!==undefined ? !Array.isArray(volumes)||volumes.length<1||volumes.length>20 : !Array.isArray(items)||items.length<1||items.length>100) invalid('Envie entre 1 e 100 itens ou entre 1 e 20 volumes reais para cotação.');
    if (!Array.isArray(services) || services.length > 30) invalid('Seleção de serviços inválida.');
    const serviceIds = [...new Set(services.map(id => integer(id, 1, 9999, 'ID do serviço')))];
    const ids = new Set();
    const products = items?.map(item => {
      if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(item.id) || ids.has(item.id)) invalid('Cada item precisa de um identificador único e válido.'); ids.add(item.id);
      return {id:item.id, width:decimal(item.widthCm, .1, 300, 'largura em centímetros'), height:decimal(item.heightCm, .1, 300, 'altura em centímetros'), length:decimal(item.lengthCm, .1, 300, 'comprimento em centímetros'), weight:integer(item.weightGrams, 1, 30000, 'peso em gramas') / 1000, insurance_value:integer(item.priceCents, 0, 100000000, 'preço unitário em centavos') / 100, quantity:integer(item.quantity, 1, 9999, 'quantidade')};
    });
    const packedVolumes=volumes?.map(volume=>{
      if(!volume||typeof volume!=='object'||Array.isArray(volume)||Object.keys(volume).some(key=>!['widthCm','heightCm','lengthCm','weightGrams','insuranceValueCents'].includes(key)))invalid('Volume de postagem inválido.');
      return {width:decimal(volume.widthCm,.1,300,'largura em centímetros'),height:decimal(volume.heightCm,.1,300,'altura em centímetros'),length:decimal(volume.lengthCm,.1,300,'comprimento em centímetros'),weight:integer(volume.weightGrams,1,30000,'peso embalado em gramas')/1000,insurance:integer(volume.insuranceValueCents,0,100000000,'valor segurado do volume em centavos')/100};
    });
    const payload = {from:{postal_code:origin}, to:{postal_code:destination}, ...(products?{products}:{volumes:packedVolumes}), options:{receipt:false, own_hand:false}};
    if (serviceIds.length) payload.services = serviceIds.join(',');
    const data = await request('/api/v2/me/shipment/calculate', payload);
    if (!Array.isArray(data) || data.length > 100) responseInvalid();
    const quotes = [], unavailable = [], seen = new Set(), quotedAt = new Date(now()).toISOString();
    for (const row of data) {
      if (!row || !Number.isSafeInteger(row.id) || row.id < 1 || seen.has(row.id) || serviceIds.length && !serviceIds.includes(row.id)) responseInvalid(); seen.add(row.id);
      if (row.error) { unavailable.push({serviceId:row.id, reason:'Serviço indisponível para os dados consultados.'}); continue; }
      // The provider may consolidate volumes. Its package count need not equal
      // the requested count, but explicit package errors cannot become offers.
      if(row.packages!==undefined){
        if(!Array.isArray(row.packages)||row.packages.length>100||row.packages.some(pack=>!pack||typeof pack!=='object'||Array.isArray(pack)))responseInvalid();
        if(!row.packages.length||row.packages.some(pack=>pack.error)){unavailable.push({serviceId:row.id,reason:'Serviço indisponível para todos os volumes consultados.'});continue;}
        for(const pack of row.packages)if(pack.price!==undefined)brlToCents(pack.price);
      }
      if (!['R$','BRL'].includes(row.currency) || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 120 || !Number.isSafeInteger(row.custom_delivery_time) || row.custom_delivery_time < 0 || row.custom_delivery_time > 365 || row.company && (typeof row.company.name !== 'string' || row.company.name.length > 120)) responseInvalid();
      let range = null;
      if (row.custom_delivery_range != null) { const {min,max} = row.custom_delivery_range; if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max < min || max > 365) responseInvalid(); range = {min,max}; }
      quotes.push({serviceId:row.id, name:row.name, company:row.company?.name || null, amountCents:brlToCents(row.custom_price), currency:'BRL', estimatedDays:row.custom_delivery_time, deliveryRange:range,packageCount:row.packages?.length??null, quotedAt, sandbox:config.MELHOR_ENVIO_ENVIRONMENT==='sandbox', contracted:false});
    }
    return {provider:'melhorenvio', environment:config.MELHOR_ENVIO_ENVIRONMENT, originZip:origin, destinationZip:destination, quotes, unavailable, quotedAt, purchasesEnabled:false};
  }
  async function tracking({orderIds} = {}) {
    ready();
    if (!Array.isArray(orderIds) || orderIds.length < 1 || orderIds.length > 20 || orderIds.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) invalid('Consulte entre 1 e 20 IDs UUID de etiquetas existentes.');
    const ids = [...new Set(orderIds)], data = await request('/api/v2/me/shipment/tracking', {orders:ids});
    if (!data || typeof data !== 'object') responseInvalid();
    const rows = Array.isArray(data) ? data.map(row => [row?.id,row]) : Object.entries(data);
    if (rows.length > ids.length) responseInvalid();
    const parsed = new Map();
    for (const [id,row] of rows) {
      if (!ids.includes(id) || parsed.has(id) || !row || typeof row !== 'object' || Array.isArray(row) || row.id && row.id !== id) responseInvalid();
      if (typeof row.status !== 'string' || !/^[a-z_]{1,60}$/i.test(row.status)) responseInvalid();
      for (const field of ['tracking','protocol']) if (row[field] != null && (typeof row[field] !== 'string' || !/^[a-zA-Z0-9._/-]{1,100}$/.test(row[field]))) responseInvalid();
      const dates = {};
      for (const field of ['created_at','paid_at','generated_at','posted_at','delivered_at','canceled_at']) if (row[field] != null) { if (typeof row[field] !== 'string' || !Number.isFinite(Date.parse(row[field]))) responseInvalid(); dates[field] = new Date(row[field]).toISOString(); }
      parsed.set(id,{id,found:true,providerStatus:row.status,trackingCode:row.tracking || null,protocol:row.protocol || null,dates,sandbox:config.MELHOR_ENVIO_ENVIRONMENT==='sandbox'});
    }
    return {provider:'melhorenvio', environment:config.MELHOR_ENVIO_ENVIRONMENT, checkedAt:new Date(now()).toISOString(), items:ids.map(id=>parsed.get(id)||{id,found:false,providerStatus:null,trackingCode:null,sandbox:config.MELHOR_ENVIO_ENVIRONMENT==='sandbox'})};
  }
  return {readiness:()=>shippingReadiness(config), quote, tracking};
}
module.exports = {createShippingProvider, shippingReadiness, ShippingError, brlToCents};
