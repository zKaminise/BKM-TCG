'use strict';

// Reference metadata only. This module never publishes listings or changes stock.
// The caller must require an administrative session before exposing import routes.
const { setTimeout: pause } = require('node:timers/promises');
const API_ROOT = 'https://api.tcgdex.net/v2';
const PROVIDER = 'tcgdex';
const LANGUAGES = new Set(['pt', 'en', 'ja']);
const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,79}$/;

class CatalogError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'CatalogError';
    this.status = status;
    this.statusCode = status;
    this.code = code;
  }
}

function normalizeLanguage(value = 'pt') {
  // The live API's physical Brazilian cards are under /pt. /pt-br currently
  // contains Pocket sets, so the store's explicit pt-br alias resolves to /pt.
  const language = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const result = language === 'pt-br' ? 'pt' : language;
  if (!LANGUAGES.has(result)) throw new CatalogError(400, 'CATALOG_LANGUAGE_INVALID', 'Selecione português (pt), inglês (en) ou japonês (ja).');
  return result;
}

function validateId(value, label = 'coleção') {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new CatalogError(400, 'CATALOG_ID_INVALID', `Identificador de ${label} inválido. Selecione um registro do catálogo.`);
  }
  return value;
}

function normalizedLocalId(value) {
  return String(value).normalize('NFKC').trim().toUpperCase().replace(/\d+/g, digits => digits.replace(/^0+(?=\d)/, ''));
}

function validateNumber(value) {
  if (typeof value !== 'string' || value.length > 40) throw new CatalogError(400, 'CATALOG_NUMBER_INVALID', 'Informe um número de carta válido.');
  const parts = value.normalize('NFKC').trim().toUpperCase().split('/').map(part => part.trim());
  if (parts.length > 2 || parts.some(part => !/^[A-Z]{0,8}\d{1,8}[A-Z]{0,4}$/.test(part))) {
    throw new CatalogError(400, 'CATALOG_NUMBER_INVALID', 'Use o número impresso na carta, como 025, 025/198 ou TG01.');
  }
  return { localId: normalizedLocalId(parts[0]), printedTotal: parts[1] ? normalizedLocalId(parts[1]) : null };
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeText(value, maxLength = 300) {
  return typeof value === 'string' ? value.slice(0, maxLength) : null;
}

function imageUrl(value, kind = 'card') {
  if (typeof value !== 'string' || value.length > 1000) return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.hostname !== 'assets.tcgdex.net' || url.username || url.password || url.port || url.search || url.hash) return null;
  if (!/^\/[a-zA-Z0-9/._+-]+$/.test(url.pathname)) return null;
  if (/\.(?:png|webp|jpg)$/i.test(url.pathname)) return url.href;
  return `${url.href.replace(/\/$/, '')}${kind === 'card' ? '/high.webp' : '.webp'}`;
}

function setSummary(set, language) {
  if (!set || typeof set !== 'object' || !ID_PATTERN.test(set.id || '') || typeof set.name !== 'string') {
    throw new CatalogError(502, 'CATALOG_RESPONSE_INVALID', 'O catálogo externo retornou uma coleção inválida. Use o cadastro manual ou tente mais tarde.');
  }
  return {
    id: set.id, name: safeText(set.name), code: set.id,
    total: nonnegativeInteger(set.cardCount?.official),
    totalWithSecret: nonnegativeInteger(set.cardCount?.total),
    logo: imageUrl(set.logo, 'logo'), symbol: imageUrl(set.symbol, 'symbol'),
    series: set.serie?.id && set.serie?.name ? { id: safeText(set.serie.id, 80), name: safeText(set.serie.name) } : null,
    releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(set.releaseDate || '') ? set.releaseDate : null,
    provider: PROVIDER, providerId: set.id, language,
  };
}

function cardSummary(card, set, language) {
  if (!card || typeof card !== 'object' || !ID_PATTERN.test(card.id || '') || !card.localId || typeof card.name !== 'string' || card.set?.id !== set.id) {
    throw new CatalogError(502, 'CATALOG_RESPONSE_INVALID', 'O catálogo externo retornou uma carta incompatível com a coleção. Confira os dados ou use o cadastro manual.');
  }
  return {
    id: `${PROVIDER}:${language}:${card.id}`,
    setId: set.id, setName: set.name, name: safeText(card.name),
    number: safeText(card.localId, 30), total: nonnegativeInteger(card.set?.cardCount?.official) ?? set.total,
    rarity: safeText(card.rarity),
    type: Array.isArray(card.types) ? card.types.filter(type => typeof type === 'string').slice(0, 5).join(', ') || null : null,
    hp: nonnegativeInteger(card.hp), image: imageUrl(card.image),
    series: set.series, category: safeText(card.category, 80),
    variants: card.variants && typeof card.variants === 'object'
      ? Object.fromEntries(Object.entries(card.variants).filter(([key, value]) => /^[a-zA-Z]{1,40}$/.test(key) && typeof value === 'boolean')) : {},
    provider: PROVIDER, providerId: card.id, language,
    imageKind: 'reference',
  };
}

function createCatalogProvider(options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('O catálogo exige Node.js 22 ou superior com fetch.');
  const timeoutMs = Math.max(1, Math.min(15000, Number(options.timeoutMs) || 6500));
  const ttlMs = Math.max(1, Math.min(3600000, Number(options.ttlMs) || 1800000));
  const maxEntries = Math.max(1, Math.min(256, Number(options.maxEntries) || 128));
  const maxBytes = 2 * 1024 * 1024;
  const now = options.now || Date.now;
  const delay = options.delay || pause;
  const cache = new Map();
  const inFlight = new Map();

  async function readBody(response) {
    if (Number(response.headers.get('content-length')) > maxBytes) {
      throw new CatalogError(502, 'CATALOG_RESPONSE_INVALID', 'A resposta do catálogo externo excedeu o limite de segurança.');
    }
    if (!response.body) throw new CatalogError(502, 'CATALOG_RESPONSE_INVALID', 'O catálogo externo retornou uma resposta vazia.');
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          await reader.cancel();
          throw new CatalogError(502, 'CATALOG_RESPONSE_INVALID', 'A resposta do catálogo externo excedeu o limite de segurança.');
        }
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
    } catch (error) {
      if (error instanceof CatalogError || error.name === 'AbortError' || error.name === 'TimeoutError') throw error;
      throw new CatalogError(502, 'CATALOG_RESPONSE_INVALID', 'O catálogo externo retornou dados inválidos. Use o cadastro manual ou tente mais tarde.');
    } finally { reader.releaseLock(); }
  }

  async function fetchJson(key) {
    const hit = cache.get(key);
    if (hit && hit.expires > now()) {
      cache.delete(key); cache.set(key, hit);
      return structuredClone(hit.value);
    }
    cache.delete(key);
    if (inFlight.has(key)) return structuredClone(await inFlight.get(key));
    if (inFlight.size >= 32) throw new CatalogError(429, 'CATALOG_BUSY', 'Há muitas consultas ao catálogo. Aguarde um instante.');
    const work = (async () => {
      let lastError;
      for (let attempt = 0; attempt < 2; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchImpl(`${API_ROOT}/${key}`, {
            method: 'GET', redirect: 'error', signal: controller.signal,
            headers: { Accept: 'application/json', 'User-Agent': 'BKM-TCG-Catalog/1.0' },
          });
          if (response.status === 404) {
            await response.body?.cancel();
            throw new CatalogError(404, 'CATALOG_NOT_FOUND', 'A coleção ou carta não foi encontrada neste idioma. Confira a seleção ou use o cadastro manual.');
          }
          if (!response.ok) {
            await response.body?.cancel();
            const error = new CatalogError(502, 'CATALOG_UNAVAILABLE', 'O catálogo externo está indisponível. Use o cadastro manual ou tente mais tarde.');
            error.retryable = response.status === 429 || response.status >= 500;
            throw error;
          }
          const result = await readBody(response);
          if (!result || typeof result !== 'object' || result.error) throw new CatalogError(502, 'CATALOG_RESPONSE_INVALID', 'O catálogo externo retornou dados inválidos.');
          cache.set(key, { value: result, expires: now() + ttlMs });
          while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
          return result;
        } catch (error) {
          if (error instanceof CatalogError) {
            if (!error.retryable || attempt === 1) throw error;
            lastError = error;
          } else {
            const timedOut = controller.signal.aborted || error.name === 'AbortError' || error.name === 'TimeoutError';
            lastError = new CatalogError(timedOut ? 504 : 502, timedOut ? 'CATALOG_TIMEOUT' : 'CATALOG_UNAVAILABLE', timedOut
              ? 'O catálogo externo demorou a responder. Use o cadastro manual ou tente mais tarde.'
              : 'Não foi possível consultar o catálogo externo. Use o cadastro manual ou tente mais tarde.');
            if (attempt === 1) throw lastError;
          }
        } finally { clearTimeout(timer); }
        await delay(200);
      }
      throw lastError;
    })();
    inFlight.set(key, work);
    try { return structuredClone(await work); } finally { inFlight.delete(key); }
  }

  async function listSets({ language = 'pt' } = {}) {
    language = normalizeLanguage(language);
    const data = await fetchJson(`${language}/sets`);
    if (!Array.isArray(data) || data.length > 5000) throw new CatalogError(502, 'CATALOG_RESPONSE_INVALID', 'O catálogo externo retornou uma lista de coleções inválida.');
    const items = data.map(set => setSummary(set, language));
    items.sort((a, b) => a.name.localeCompare(b.name, language));
    return { items, total: items.length, provider: PROVIDER, language };
  }

  async function searchCards({ set, number, language = 'pt' } = {}) {
    language = normalizeLanguage(language);
    validateId(set);
    const query = validateNumber(number);
    const detail = await fetchJson(`${language}/sets/${encodeURIComponent(set)}`);
    if (detail.id !== set || !Array.isArray(detail.cards) || detail.cards.length > 5000) throw new CatalogError(502, 'CATALOG_RESPONSE_INVALID', 'O catálogo externo retornou uma coleção incompatível com a seleção.');
    const summary = setSummary(detail, language);
    // Resolve localId against this genuine set. Never fabricate a provider ID by
    // concatenating a user number, and never search the whole world catalogue.
    const matches = detail.cards.filter(card => normalizedLocalId(card.localId) === query.localId);
    if (matches.length > 10) throw new CatalogError(502, 'CATALOG_RESPONSE_INVALID', 'O catálogo externo retornou correspondências demais. Confirme o número ou use o cadastro manual.');
    const items = await Promise.all(matches.map(async brief => {
      const id = validateId(brief.id, 'carta');
      const card = await fetchJson(`${language}/cards/${encodeURIComponent(id)}`);
      if (card.id !== id || normalizedLocalId(card.localId) !== query.localId) throw new CatalogError(502, 'CATALOG_RESPONSE_INVALID', 'A carta retornada não corresponde ao número selecionado.');
      return cardSummary(card, summary, language);
    }));
    const warnings = [];
    if (!items.length) warnings.push('Nenhuma carta com esse número está disponível nesta coleção e idioma do provedor. O cadastro manual continua disponível.');
    if (items.some(card => !card.image)) warnings.push('O provedor não possui imagem para uma ou mais correspondências. Adicione uma imagem própria, identificada corretamente.');
    if (query.printedTotal && summary.total !== null && query.printedTotal !== normalizedLocalId(summary.total)) {
      warnings.push('O total digitado difere do total oficial informado pelo provedor. Confirme a coleção e a carta antes de importar.');
    }
    return { items, total: items.length, provider: PROVIDER, language, set: summary, warnings };
  }

  return { listSets, searchCards, clearCache() { cache.clear(); }, cacheInfo() { return { entries: cache.size, pending: inFlight.size, maxEntries, ttlMs, timeoutMs }; } };
}

const provider = createCatalogProvider();
module.exports = {
  CatalogError, createCatalogProvider, normalizeLanguage, normalizedLocalId,
  listSets: provider.listSets, searchCards: provider.searchCards,
};
