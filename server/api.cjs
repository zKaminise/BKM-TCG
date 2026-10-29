const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { defaultSettings } = require("./db.cjs");
const { openStore } = require("./store.cjs");
const { hashPassword, verifyPassword, hashToken, publicUser } = require("./auth.cjs");
const {PASSWORD_POLICY,assertPassword,assertPasswordConfirmation}=require('./password-policy.cjs');
const { accountList } = require("./accounts.cjs");
const { PaymentError, paymentReadiness } = require("./payments.cjs");
const { allowedOrigins, safeReturnPath } = require('./domain-policy.cjs');
const { EMAIL_JOB_PATH, emailJobAuthorized, createEmailJob } = require('./email-job.cjs');
const { COMMERCE_JOB_PATH, createCommerceJob } = require('./commerce-job.cjs');
const {shippingSettings,validateShippingSettings,hasConfiguredShipping,createShippingPolicy,publicShippingSettings,operationalShippingReadiness,REGION_STATES}=require('./shipping-policy.cjs');
const {normalizeVariantAttributes,attributesFromRow,variantIdentity}=require('./variant-attributes.cjs');
const uid = () => crypto.randomUUID();
const now = () => (/* @__PURE__ */ new Date()).toISOString();
const normalized = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\b0+(?=\d)/g, "");
class ApiError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    Object.assign(this, { status, code, fields });
  }
}
function fail(code, message, fields, status = 422) {
  throw new ApiError(status, code, message, fields);
}
function text(value, key, max = 200, required = false) {
  if (typeof value !== "string") {
    if (!required && value == null) return "";
    fail("VALIDATION", `Revise o campo ${key}.`, { [key]: "Texto inválido." });
  }
  const v = value.trim();
  if (v.length > max || required && !v) fail("VALIDATION", `Revise o campo ${key}.`, { [key]: `Informe até ${max} caracteres.` });
  return v;
}
function integer(value, key, min = 0, max = 1e8) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail("VALIDATION", `Revise o campo ${key}.`, { [key]: `Use um inteiro entre ${min} e ${max}.` });
  return value;
}
function bool(value, key) {
  if (typeof value !== "boolean") fail("VALIDATION", `Revise o campo ${key}.`);
  return value;
}
function imageUrl(value) {
  const url = text(value, "imagem", 2e3, true);
  if (/^\/(?:assets|uploads)\/[A-Za-z0-9_./%-]+$/.test(url) && !url.includes("..")) return url;
  try {
    const u = new URL(url);
    if (["https:", "http:"].includes(u.protocol) && !u.username && !u.password) return u.href;
  } catch {
  }
  fail("VALIDATION", "Use uma URL de imagem HTTPS ou uma imagem enviada à loja.");
}
async function transaction(db, fn) { return db.transaction(fn); }
async function readJson(req, max = 1024 * 1024) {
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) throw new ApiError(415, "CONTENT_TYPE", "Envie os dados em JSON.");
  if (Number(req.headers["content-length"] || 0) > max) throw new ApiError(413, "BODY_TOO_LARGE", "Arquivo ou formulário acima do limite permitido.");
  function parse(raw) {
    if(Buffer.byteLength(raw)>max) throw new ApiError(413,"BODY_TOO_LARGE","Arquivo ou formulário acima do limite permitido.");
    try {
      const data=JSON.parse(raw);
      if(!data || typeof data!=="object" || Array.isArray(data)) throw new Error();
      return data;
    } catch { throw new ApiError(400,"INVALID_JSON","JSON inválido."); }
  }
  // Vercel may parse JSON before invoking the function, consuming its stream.
  if(req.body!==undefined) {
    let raw;
    if(typeof req.body==='string' || Buffer.isBuffer(req.body)) raw=req.body;
    else {
      try { raw=JSON.stringify(req.body); }
      catch { throw new ApiError(400,'INVALID_JSON','JSON inválido.'); }
    }
    if(typeof raw!=='string' && !Buffer.isBuffer(raw)) throw new ApiError(400,'INVALID_JSON','JSON inválido.');
    return parse(raw);
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > max) throw new ApiError(413, "BODY_TOO_LARGE", "Arquivo ou formulário acima do limite permitido.");
    chunks.push(chunk);
  }
  return parse(Buffer.concat(chunks).toString("utf8"));
}
function createApi(options = {}) {
  const root = options.root || path.resolve(__dirname, "..");
  const env = options.env || process.env;
  const publicUrl = options.publicUrl || env.BKM_PUBLIC_URL;
  const acceptedOrigins = allowedOrigins({publicUrl,additional:options.allowedOrigins || []});
  const effectiveEnv = { ...env, BKM_ENVIRONMENT: env.BKM_ENVIRONMENT || (env.VERCEL ? '' : 'demo'), PAYMENT_PROVIDER: env.PAYMENT_PROVIDER || 'mock' };
  const demo = effectiveEnv.BKM_ENVIRONMENT === 'demo';
  const demoPayments = demo && effectiveEnv.PAYMENT_PROVIDER === 'mock';
  const shippingPolicy=createShippingPolicy({ApiError,fetchImpl:options.shippingFetch,carrierFetch:options.shippingProviderFetch,env:effectiveEnv,production:effectiveEnv.BKM_ENVIRONMENT==='production'});
  const db = openStore({ ...options, env });
  const customerProfile = require('./customer-profile.cjs').createCustomerProfile({db,ApiError,hashPassword,verifyPassword});
  const google = require('./google-auth.cjs').createGoogleAuth({db,env:{...effectiveEnv,BKM_PUBLIC_URL:publicUrl},fetchImpl:options.googleFetch});
  const { createCollections } = require('./collections.cjs');
  const collections = createCollections({db,ApiError,audit,imageUrl});
  const { createEmailStore } = require('./email-store.cjs');
  const emailStore = createEmailStore(db);
  const notifications=require('./email-notifications.cjs').createEmailNotifications({db,emailStore,env:effectiveEnv});
  const market=require('./market-price-provider.cjs').createMarketPriceService({db,ApiError});
  const personal=require('./personal-collection.cjs').createPersonalCollection({db,ApiError,fetchImpl:options.catalogFetch,mypCardsFetch:options.mypCardsFetch,env:effectiveEnv,priceProvider:market.provider});
  const productWorkflow=require('./product-workflow.cjs').createProductWorkflow({db,ApiError,fetchImpl:options.catalogFetch,audit});
  let emailDispatcher;
  async function enqueueEmail(message) { return emailStore.enqueue(message); }
  async function flushEmails({limit=10,deadlineAt}={}) {
    const { createEmailDispatcher, createEmailProvider } = require('./email.cjs');
    if(deadlineAt!==undefined){
      if(!Number.isFinite(deadlineAt)||Date.now()>=deadlineAt-1500)return {processed:0,sent:0,previewed:0,retried:0,failed:0};
      const provider=createEmailProvider({env:effectiveEnv,deadlineAt});
      return createEmailDispatcher({store:emailStore,provider,env:effectiveEnv}).flush({limit});
    }
    emailDispatcher ||= createEmailDispatcher({store:emailStore,provider:createEmailProvider({env:effectiveEnv}),env:effectiveEnv});
    return emailDispatcher.flush({limit});
  }
  const runEmailJob=createEmailJob({notifications,flushEmails});
  async function flushSafely() { try { return await flushEmails(); } catch { return {pending:true}; } }
  async function inventoryNotifications(productId,eventKey) {
    const recipients=await personal.onInventoryChange(productId,eventKey);
    for(const recipient of recipients) await notifications.queueWishlist({userId:recipient.userId,to:recipient.email,name:recipient.name,items:recipient.items,wishlistIds:recipient.wishlistIds,eventKey});
  }
  const rateLimits = /* @__PURE__ */ new Map();
  const dummyPassword = "scrypt$32768$8$1$00000000000000000000000000000000$" + "0".repeat(128);
  async function audit(actor, action, entity, details = {}) {
    (await db.prepare("INSERT INTO admin_audit VALUES(?,?,?,?,?,?)").run(uid(), actor, action, entity, JSON.stringify(details), now()));
  }
  async function settings() {
    const saved = JSON.parse((await db.prepare("SELECT value_json FROM settings WHERE id=1").get()).value_json);
    return { city:'',state:'',...defaultSettings, ...saved, shipping: shippingSettings({ ...defaultSettings.shipping, ...saved.shipping }) };
  }
  async function config() {
    const s = await settings();
    s.google=google.readiness();
    const payment = paymentReadiness(effectiveEnv);
    const available=payment.enabled && (demoPayments || !s.demoDataVersion);
    return { ...s, shipping:publicShippingSettings(s.shipping), passwordPolicy:PASSWORD_POLICY, freeShippingThresholdCents: s.shipping.freeShippingEnabled ? s.shipping.freeShippingThresholdCents : null, environment: effectiveEnv.BKM_ENVIRONMENT || 'unconfigured',demo,paymentConfigured:available, shippingConfigured:hasConfiguredShipping(s.shipping,{production:effectiveEnv.BKM_ENVIRONMENT==='production',env:effectiveEnv}), payments:{available,provider:payment.provider,environment:payment.environment,demo:payment.demo,canCharge:available && payment.canCharge,reason:!demo && s.demoDataVersion?'O banco demonstrativo não aceita cobranças externas.':payment.reason,...(available && payment.provider==='mercadopago'?{publicKey:effectiveEnv.MERCADO_PAGO_PUBLIC_KEY}:{})} };
  }
  function limit(req, scope, max, windowMs = 15 * 60 * 1e3) {
    const key = `${req.socket?.remoteAddress || "serverless"}:${scope}`;
    const stamp = Date.now();
    let entry = rateLimits.get(key);
    if (!entry || entry.reset < stamp) {
      entry = { count: 0, reset: stamp + windowMs };
      rateLimits.set(key, entry);
    }
    if (++entry.count > max) throw new ApiError(429, "RATE_LIMIT", "Muitas tentativas. Aguarde alguns minutos.");
    if (rateLimits.size > 1e4) {
      for (const [k, v] of rateLimits) if (v.reset < stamp) rateLimits.delete(k);
    }
  }
  async function getSession(req) {
    const cookie = (req.headers.cookie || "").split(";").map((x) => x.trim()).find((x) => x.startsWith("bkm_session="));
    const token = cookie?.slice(12);
    if (!token || !/^[-_A-Za-z0-9]{43}$/.test(token)) return null;
    const s = (await db.prepare("SELECT * FROM sessions WHERE token_hash=? AND expires_at>?").get(hashToken(token), Date.now()));
    if (!s) return null;
    s.user = s.user_id ? (await db.prepare("SELECT * FROM users WHERE id=?").get(s.user_id)) : null;
    return s;
  }
  async function newSession(res, userId = null, previous = null) {
    if (previous) (await db.prepare("DELETE FROM sessions WHERE token_hash=?").run(previous.token_hash));
    const token = crypto.randomBytes(32).toString("base64url"), csrfToken = crypto.randomBytes(32).toString("base64url");
    const age = userId ? 7 * 86400 : 86400;
    (await db.prepare("DELETE FROM sessions WHERE expires_at<?").run(Date.now()));
    (await db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?)").run(hashToken(token), userId, csrfToken, Date.now() + age * 1e3, Date.now()));
    res.setHeader("Set-Cookie", `bkm_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${options.secureCookies ? "; Secure" : ""}`);
    return { user: userId ? publicUser((await db.prepare("SELECT * FROM users WHERE id=?").get(userId))) : null, csrfToken };
  }
  function auth(session, admin = false) {
    if (!session?.user) throw new ApiError(401, "UNAUTHENTICATED", "Entre na sua conta para continuar.");
    if (admin && session.user.role !== "ADMIN") throw new ApiError(403, "FORBIDDEN", "Acesso exclusivo à administração.");
    return session.user;
  }
  function csrf(req, session) {
    const incoming = req.headers["x-csrf-token"];
    if (!session || typeof incoming !== "string" || Buffer.byteLength(incoming)!==Buffer.byteLength(session.csrf_token) || !crypto.timingSafeEqual(Buffer.from(incoming),Buffer.from(session.csrf_token))) throw new ApiError(403, "CSRF", "Atualize a página antes de enviar este formulário.");
  }
  function origin(req) {
    if (req.headers["sec-fetch-site"] === "cross-site") throw new ApiError(403, "ORIGIN", "Origem da solicitação não permitida.");
    if (req.headers.origin) {
      const expected = publicUrl ? new URL(publicUrl).origin : `${options.secureCookies || req.socket?.encrypted ? "https" : "http"}://${req.headers.host}`;
      if (req.headers.origin !== expected && !acceptedOrigins.includes(req.headers.origin)) throw new ApiError(403, "ORIGIN", "Origem da solicitação não permitida.");
    }
  }
  async function product(row, admin = false) {
    if (!row) return null;
    const variants = (await db.prepare("SELECT v.*,m.attributes_json,(SELECT COALESCE(SUM(r.quantity),0) FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status='ACTIVE' AND r.expires_at>?) reserved FROM variants v LEFT JOIN variant_metadata m ON m.variant_id=v.id WHERE v.product_id=? AND v.active=1 ORDER BY CASE v.language WHEN 'pt' THEN 0 WHEN 'en' THEN 1 ELSE 2 END,v.id").all(Date.now(),row.id)).map((v) => ({ id: v.id, language: v.language, condition: v.condition, finish: v.finish, attributes:attributesFromRow(v), priceCents: v.price_cents, compareAtCents: v.compare_at_cents, stock: admin ? v.stock : Math.max(0,v.stock-v.reserved), reservedStock:v.reserved }));
    const metadata = row.card_id ? JSON.parse((await db.prepare("SELECT metadata_json FROM card_metadata WHERE id=?").get(row.card_id)).metadata_json) : null;
    return { id: row.id, slug: row.slug, kind: row.kind, name: row.name, description: row.description, sku: row.sku, tcg: row.tcg, setId: row.set_id, setName: row.set_name, images: JSON.parse(row.images_json), attributes: JSON.parse(row.attributes_json), card: metadata, featured: !!row.featured, published: !!row.published, createdAt: row.created_at, updatedAt: row.updated_at, variants, ...admin ? { archived: !!row.archived } : {} };
  }
  async function facets() {
    const rows = (await db.prepare("SELECT DISTINCT set_id id,set_name name FROM products WHERE published=1 AND archived=0 AND set_id<>'' ORDER BY set_name").all());
    const canonicalNames=new Map((await db.prepare('SELECT id,name FROM collections').all()).map(row=>[row.id,row.name]));
    const uniqueSets=new Map();
    for(const row of rows) if(!uniqueSets.has(row.id)) uniqueSets.set(row.id,{id:row.id,name:canonicalNames.get(row.id) || row.name});
    const vs = (await db.prepare("SELECT DISTINCT v.language,v.condition,v.finish FROM variants v JOIN products p ON p.id=v.product_id WHERE v.active=1 AND p.published=1 AND p.archived=0").all());
    return { sets: [...uniqueSets.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')), languages: [...new Set(vs.map((x) => x.language))], conditions: [...new Set(vs.map((x) => x.condition))], finishes: [...new Set(vs.map((x) => x.finish))] };
  }
  async function listProducts(query, admin = false) {
    const archived=query.get('archived');
    if(query.has('archived')&&(query.getAll('archived').length!==1||!['all','only'].includes(archived)))fail('VALIDATION','Escolha todos os produtos ou somente os arquivados.');
    // Archive inspection is an explicit admin capability. Public queries always
    // retain publication/archive visibility even when that parameter is supplied.
    const clauses = [admin ? archived==='all'?'1=1':archived==='only'?'p.archived=1':'p.archived=0' : "p.published=1 AND p.archived=0"], params = [];
    if (query.get("kind")) {
      const v = query.get("kind");
      if (!["SEALED", "SINGLE", "CUSTOM"].includes(v)) fail("VALIDATION", "Tipo de produto inválido.");
      clauses.push("p.kind=?");
      params.push(v);
    }
    if (query.get("set")) {
      clauses.push("p.set_id=?");
      params.push(query.get("set"));
    }
    if (query.get('number')) {
      clauses.push("EXISTS(SELECT 1 FROM card_metadata c WHERE c.id=p.card_id AND lower(ltrim(c.number,'0'))=?)");
      params.push(String(query.get('number')).split('/')[0].trim().toLowerCase().replace(/^0+/,''));
    }
    for (const word of normalized(query.get("q")).split(/\s+/).filter(Boolean).slice(0, 12)) {
      clauses.push("p.search_text LIKE ? ESCAPE '\\'");
      params.push("%" + word.replace(/[\\%_]/g, "\\$&") + "%");
    }
    const filters = [];
    for (const [q, col] of [["language", "language"], ["condition", "condition"], ["finish", "finish"]]) if (query.get(q)) {
      filters.push(`v.${col}=?`);
      params.push(query.get(q));
    }
    if (query.get("available") === "true" || query.get("available") === "1") {
      filters.push("v.stock>(SELECT COALESCE(SUM(r.quantity),0) FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status='ACTIVE' AND r.expires_at>?)");
      params.push(Date.now());
    }
    if (query.get("minPrice")) {
      filters.push("v.price_cents>=?");
      params.push(integer(Number(query.get("minPrice")), "minPrice"));
    }
    if (query.get("maxPrice")) {
      filters.push("v.price_cents<=?");
      params.push(integer(Number(query.get("maxPrice")), "maxPrice"));
    }
    if (filters.length) clauses.push(`EXISTS(SELECT 1 FROM variants v WHERE v.product_id=p.id AND v.active=1 AND ${filters.join(" AND ")})`);
    if (query.get("featured") === "true") clauses.push("p.featured=1");
    const sorts = { newest: "p.created_at DESC", name: "p.name COLLATE NOCASE ASC", price_asc: "(SELECT MIN(price_cents) FROM variants WHERE product_id=p.id AND active=1) ASC", price_desc: "(SELECT MAX(price_cents) FROM variants WHERE product_id=p.id AND active=1) DESC", relevance: "p.featured DESC,p.created_at DESC" };
    const order2 = sorts[query.get("sort")] || sorts.newest;
    const page = integer(Number(query.get("page") || 1), "page", 1, 1e6), pageSize = Math.min(48, Math.max(1, Number(query.get("pageSize") || 24)));
    if (!Number.isInteger(pageSize)) fail("VALIDATION", "Paginação inválida.");
    const where = clauses.join(" AND "), total = (await db.prepare(`SELECT COUNT(*) count FROM products p WHERE ${where}`).get(...params)).count;
    const rows = (await db.prepare(`SELECT p.* FROM products p WHERE ${where} ORDER BY ${order2},p.id LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize));
    return { items: await Promise.all(rows.map((x) => product(x, admin))), pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) }, facets: await facets() };
  }
  function validateProduct(data, existing) {
    const kind = text(data.kind, "kind", 10, true);
    if (!["SEALED", "SINGLE", "CUSTOM"].includes(kind)) fail("VALIDATION", "Escolha carta, selado ou personalizado.");
    const name = text(data.name, "name", 180, true), sku = text(data.sku, "sku", 100)||existing?.sku||'', slug = text(data.slug, "slug", 200)||existing?.slug||'';
    if (slug && !/^[a-z0-9][a-z0-9-]*$/.test(slug)) fail("VALIDATION", "URL do produto inválida.");
    const setId = text(data.setId, "setId", 100), setName = text(data.setName, "setName", 200), tcg = text(data.tcg || "pokemon", "tcg", 50, true);
    const description = text(data.description, "description", 15e3);
    if (!Array.isArray(data.images) || data.images.length > 5) fail("VALIDATION", "Envie até 5 fotos por produto, incluindo a imagem do catálogo quando existir.");
    const images = data.images.map((i) => {
      if (!i || typeof i !== "object" || Array.isArray(i)) fail("VALIDATION", "Imagem inválida.");
      return { url: imageUrl(i.url), kind: i.kind === "actual" ? "actual" : "reference", alt: text(i.alt, "alt", 250) };
    });
    if(data.published===true&&!images.length)fail('VALIDATION','Adicione uma foto real ou imagem de referência antes de publicar o produto.');
    if (!Array.isArray(data.variants) || !data.variants.length || data.variants.length > 50) fail("VALIDATION", "Cadastre entre 1 e 50 variantes.");
    const combinations = /* @__PURE__ */ new Set(), variantIds = /* @__PURE__ */ new Set();
    const variants = data.variants.map((v) => {
      if (!v || typeof v !== "object" || Array.isArray(v)) fail("VALIDATION", "Variante inválida.");
      if (v.id) {
        if (variantIds.has(v.id)) fail("DUPLICATE_VARIANT", "A mesma variante foi enviada mais de uma vez.");
        variantIds.add(v.id);
      }
      const language = text(v.language || "pt", "language", 15, true), condition = text(v.condition || (kind === "SEALED" ? "SEALED" : kind==='CUSTOM'?'CUSTOM':''), "condition", 30, true), finish = text(v.finish || "NORMAL", "finish", 60, true);
      if(!['pt','en','ja','zh-tw','zh-cn','zh','ko','es','fr','de','it','th','id'].includes(language))fail('VALIDATION','Selecione um idioma de produto suportado.');
      const validConditions=kind==='SINGLE'?['M','NM','SP','MP','HP','D','LP','DMG']:kind==='SEALED'?['SEALED','OPENED']:['CUSTOM','M','NM','SP','MP','HP','D','LP','DMG'];
      if(!validConditions.includes(condition))fail('VALIDATION','Selecione a condição correspondente a este tipo de produto.');
      if(!['NORMAL','HOLO','REVERSE','POKE_BALL','MASTER_BALL','OTHER','FOIL','PROMO','FIRST_EDITION'].includes(finish))fail('VALIDATION','Selecione um acabamento válido.');
      let attributes;try{attributes=normalizeVariantAttributes(v.attributes);}catch(error){fail('VALIDATION',error.message);}
      if(kind!=='SINGLE'&&attributes.length)fail('VALIDATION','Atributos de cartas são exclusivos de cartas avulsas.');
      const key=variantIdentity({language,condition,finish,attributes});
      if (combinations.has(key)) fail("DUPLICATE_VARIANT", "Há variantes com idioma, condição, acabamento e atributos iguais.");
      combinations.add(key);
      const priceCents = integer(v.priceCents, "priceCents", 1);
      const compareAtCents = v.compareAtCents == null ? null : integer(v.compareAtCents, "compareAtCents", priceCents);
      return { id: v.id ? text(v.id, "variantId", 100, true) : null, language, condition, finish, attributes, priceCents, compareAtCents, stock: integer(v.stock, "stock", 0, 1e6) };
    });
    let card = null;
    if (kind === "SINGLE") {
      if (!data.card || typeof data.card !== "object" || Array.isArray(data.card) || !setId) fail("VALIDATION", "Informe a coleção e os metadados da carta.");
      const c = data.card;
      card = { name: text(c.name || name, "card.name", 200, true), number: text(String(c.number || ""), "card.number", 40, true), total: c.total == null ? null : text(String(c.total), "card.total", 40), rarity: text(c.rarity, "card.rarity", 100), type: text(Array.isArray(c.type) ? c.type.join(", ") : c.type, "card.type", 100), hp: c.hp == null ? null : text(String(c.hp), "card.hp", 20), provider: text(c.provider || "manual", "card.provider", 50, true), providerId: text(c.providerId, "card.providerId", 150), language: text(c.language || variants[0].language, "card.language", 15, true), referenceLanguage:text(c.referenceLanguage||c.language||variants[0].language,"card.referenceLanguage",15,true),referenceImage:text(c.referenceImage,"card.referenceImage",2000),displayNumber:text(c.displayNumber,"card.displayNumber",100), setId, setName, tcg };
    }
    let attributes = {};
    if (data.attributes && typeof data.attributes === "object" && !Array.isArray(data.attributes)) {
      for (const k of ["category", "itemType", "manufacturer", "contents", "specifications", "series", "sellerNotes", "weightGrams", "widthCm", "heightCm", "lengthCm"]) if (data.attributes[k] != null) attributes[k] = text(String(data.attributes[k]), k, 3e3);
    }
    if(data.attributes?.manualCatalogFallback)attributes.manualCatalogFallback=data.attributes.manualCatalogFallback;
    const demoRecord=data.attributes?.demo===true||existing&&JSON.parse(existing.attributes_json).demo===true||/^DEMO(?:[-_]|$)/i.test(sku)||existing&&/^DEMO(?:[-_]|$)/i.test(existing.sku);
    if(demoRecord)attributes.demo=true;
    if(demoRecord&&data.published===true&&['production','staging'].includes(effectiveEnv.BKM_ENVIRONMENT))fail('DEMO_PRODUCT_PUBLISH_BLOCKED','Produtos de demonstração não podem ser publicados neste ambiente. Cadastre um produto com estoque real.',undefined,409);
    return { id: existing?.id || uid(), kind, name, slug, sku, setId, setName, tcg, description, images, variants, card, attributes, featured: data.featured === true, published: data.published === true };
  }
  async function saveProduct(data, actor, existing, session) {
    if(!existing&&data.sku&&await db.prepare('SELECT id FROM products WHERE sku=?').get(data.sku))fail('CONFLICT','Já existe um produto com este SKU.',undefined,409);
    const resolved=await productWorkflow.resolve(data,existing,actor,session),p=validateProduct(resolved.data, existing);
    await transaction(db, async () => {
      if(existing)await db.prepare('SELECT id FROM products WHERE id=?'+db.lockSuffix).get(existing.id);
      else await productWorkflow.allocate(p);
      await productWorkflow.consume(resolved.fallback,actor,session);
      const previousCardSnapshot=existing?.card_id?JSON.parse((await db.prepare('SELECT metadata_json FROM card_metadata WHERE id=?').get(existing.card_id)).metadata_json):null;
      let cardId = null;
      if (p.card) {
        const c = p.card, key = JSON.stringify([p.tcg, p.setId, normalized(c.number), c.language, c.provider, c.providerId]);
        const prior = (await db.prepare("SELECT id FROM card_metadata WHERE identity_key=?").get(key));
        cardId = prior?.id || uid();
        if (!prior) (await db.prepare("INSERT INTO card_metadata VALUES(?,?,?,?,?,?,?,?)").run(cardId, key, p.tcg, p.setId, c.number, c.language, JSON.stringify(c), now()));
        else (await db.prepare("UPDATE card_metadata SET metadata_json=? WHERE id=?").run(JSON.stringify(c), cardId));
      }
      const search = normalized([p.name, p.sku, p.setName, p.setId, p.attributes.category, p.attributes.series, p.card?.name, p.card?.number, p.card ? `${p.card.number}/${p.card.total || ""}` : ""].join(" "));
      if (existing) (await db.prepare("UPDATE products SET slug=?,kind=?,name=?,description=?,sku=?,tcg=?,set_id=?,set_name=?,card_id=?,images_json=?,attributes_json=?,search_text=?,featured=?,published=?,updated_at=? WHERE id=?").run(p.slug, p.kind, p.name, p.description, p.sku, p.tcg, p.setId, p.setName, cardId, JSON.stringify(p.images), JSON.stringify(p.attributes), search, +p.featured, +p.published, now(), p.id));
      else (await db.prepare("INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(p.id, p.slug, p.kind, p.name, p.description, p.sku, p.tcg, p.setId, p.setName, cardId, JSON.stringify(p.images), JSON.stringify(p.attributes), search, +p.featured, +p.published, 0, now(), now()));
      const old = (await db.prepare("SELECT v.*,m.attributes_json FROM variants v LEFT JOIN variant_metadata m ON m.variant_id=v.id WHERE v.product_id=? ORDER BY v.id"+(db.engine==='postgres'?' FOR UPDATE OF v':'')).all(p.id));
      const previousCard=previousCardSnapshot;
      const cardIdentity=c=>JSON.stringify(c?[String(c.provider||'manual').toLowerCase(),c.providerId||'',c.number,c.language]:null);
      const productIdentityChanged=existing&&(existing.kind!==p.kind||existing.set_id!==p.setId||cardIdentity(previousCard)!==cardIdentity(p.card)||(JSON.parse(existing.attributes_json||'{}').itemType&&JSON.parse(existing.attributes_json||'{}').itemType!==p.attributes.itemType));
      for (const oldVariant of old) {
        const reserved=(await db.prepare("SELECT COALESCE(SUM(quantity),0) quantity FROM inventory_reservations WHERE variant_id=? AND status='ACTIVE' AND expires_at>?").get(oldVariant.id,Date.now())).quantity;
        if(reserved&&productIdentityChanged)throw new ApiError(409,'STOCK_RESERVED_IDENTITY','O produto possui unidades reservadas. Sua carta, coleção ou tipo não podem ser trocados antes de concluir os pedidos pendentes.');
        const retained=p.variants.find(value=>value.id===oldVariant.id || !value.id && variantIdentity(value)===variantIdentity({...oldVariant,attributes:attributesFromRow(oldVariant)}));
        if(reserved&&retained&&variantIdentity(retained)!==variantIdentity({...oldVariant,attributes:attributesFromRow(oldVariant)}))throw new ApiError(409,'STOCK_RESERVED_IDENTITY','Uma variante reservada não pode mudar de idioma, condição, acabamento ou atributos antes de concluir os pedidos pendentes.');
        if(reserved && (!retained || retained.stock<reserved)) throw new ApiError(409,'STOCK_RESERVED','Esta variante possui unidades reservadas em pedidos pendentes. Libere os pedidos antes de reduzir o estoque.');
      }
      (await db.prepare("UPDATE variants SET active=0 WHERE product_id=?").run(p.id));
      await db.prepare("UPDATE variant_metadata SET active=0 WHERE product_id=?").run(p.id);
      for (const v of p.variants) {
        let prior = v.id ? old.find((x) => x.id === v.id) : old.find((x) => variantIdentity({...x,attributes:attributesFromRow(x)})===variantIdentity(v));
        if (v.id && !prior) fail("VALIDATION", "Esta variante não pertence ao produto.");
        const id = prior?.id || uid();
        if (prior) (await db.prepare("UPDATE variants SET language=?,condition=?,finish=?,price_cents=?,compare_at_cents=?,stock=?,active=1 WHERE id=?").run(v.language, v.condition, v.finish, v.priceCents, v.compareAtCents, v.stock, id));
        else (await db.prepare("INSERT INTO variants VALUES(?,?,?,?,?,?,?,?,1)").run(id, p.id, v.language, v.condition, v.finish, v.priceCents, v.compareAtCents, v.stock));
        await db.prepare('INSERT INTO variant_metadata(variant_id,product_id,identity_key,attributes_json,active) VALUES(?,?,?,?,1) ON CONFLICT(variant_id) DO UPDATE SET identity_key=excluded.identity_key,attributes_json=excluded.attributes_json,active=1').run(id,p.id,variantIdentity(v),JSON.stringify(v.attributes));
        const delta = v.stock - (prior?.stock || 0);
        if (delta) (await db.prepare("INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?)").run(uid(), id, actor, delta, v.stock, existing ? "Ajuste administrativo" : "Estoque inicial", now()));
      }
      await audit(actor, existing ? "PRODUCT_UPDATED" : "PRODUCT_CREATED", p.id, { sku: p.sku, published: p.published });
    });
    const saved=await db.prepare('SELECT * FROM products WHERE id=?').get(p.id);
    await inventoryNotifications(p.id,'product:'+p.id+':'+saved.updated_at);
    await flushSafely();
    return await product(saved, true);
  }
  async function quote(data, lock = false) {
    if (!Array.isArray(data.items) || data.items.length < 1 || data.items.length > 100) fail("EMPTY_CART", "Adicione produtos ao carrinho.");
    const counts = /* @__PURE__ */ new Map();
    for (const item of data.items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) fail("VALIDATION", "Item de carrinho inválido.");
      const id = text(item.variantId, "variantId", 100, true), quantity = integer(item.quantity, "quantity", 1, 1e3);
      counts.set(id, (counts.get(id) || 0) + quantity);
    }
    const items = [];
    let subtotalCents = 0;
    for (const [variantId, quantity] of [...counts].sort(([a],[b])=>a.localeCompare(b))) {
      const v = (await db.prepare("SELECT v.*,m.attributes_json,p.kind,p.attributes_json product_attributes_json,p.name,p.slug,p.sku,p.images_json,p.published,p.archived FROM variants v JOIN products p ON p.id=v.product_id LEFT JOIN variant_metadata m ON m.variant_id=v.id WHERE v.id=? AND v.active=1" + (lock && db.engine==='postgres'?' FOR UPDATE OF v':'')).get(variantId));
      if (!v || !v.published || v.archived) throw new ApiError(409, "PRODUCT_UNAVAILABLE", "Um produto do carrinho não está mais disponível.", { variantId });
      const reserved = (await db.prepare("SELECT COALESCE(SUM(quantity),0) q FROM inventory_reservations WHERE variant_id=? AND status='ACTIVE' AND expires_at>?").get(variantId, Date.now())).q;
      const available = Math.max(0, v.stock - reserved);
      if (quantity > available) throw new ApiError(409, "INSUFFICIENT_STOCK", `Estoque insuficiente para ${v.name}.`, { variantId, available });
      const totalCents = v.price_cents * quantity;
      subtotalCents += totalCents;
      if (!Number.isSafeInteger(subtotalCents) || subtotalCents > 1e9) fail("CART_LIMIT", "O valor do carrinho excede o limite.");
      items.push({ variantId, productId: v.product_id, kind:v.kind, productAttributes:JSON.parse(v.product_attributes_json||'{}'), name: v.name, slug: v.slug, sku: v.sku, image: JSON.parse(v.images_json)[0] || null, language: v.language, condition: v.condition, finish: v.finish, attributes:attributesFromRow(v), quantity, priceCents: v.price_cents, unitPriceCents: v.price_cents, totalCents, availableStock: available });
    }
    let discountCents = 0, coupon2 = null;
    if (data.coupon) {
      const code = text(data.coupon, "coupon", 40, true).toUpperCase();
      const c = (await db.prepare("SELECT * FROM coupons WHERE code=?").get(code));
      const time = now();
      if (!c || !c.active || c.starts_at && c.starts_at > time || c.ends_at && c.ends_at < time || c.max_uses != null && c.used_count >= c.max_uses || subtotalCents < c.minimum_cents) fail("COUPON_INVALID", "Cupom inválido, expirado ou não aplicável a este carrinho.");
      discountCents = Math.min(subtotalCents, c.type === "PERCENT" ? Math.floor(subtotalCents * c.value / 100) : c.value);
      coupon2 = code;
    }
    const saved=await settings(),s=saved.shipping;
    const net = subtotalCents - discountCents;
    const shipping=await shippingPolicy.quote({settings:s,netCents:net,items,shippingOptionId:data.shippingOptionId||data.shipping?.optionId||null,cep:data.cep || data.address?.zip || data.address?.postalCode,deliveryMode:data.deliveryMode || data.shippingMethod || data.shipping?.deliveryMode || data.shipping?.method || 'delivery',address:data.address});
    const {shippingCents,reason}=shipping;
    const payment=paymentReadiness(effectiveEnv),paymentAvailable=payment.enabled && (demoPayments || !saved.demoDataVersion);
    return { items, subtotalCents, discountCents, shippingCents, totalCents: shippingCents == null ? null : net + shippingCents, coupon: coupon2, errors: [], shipping: {...shipping,demo:shipping.demo===true || demo || !!saved.demoDataVersion}, paymentAvailable, demo, environment:effectiveEnv.BKM_ENVIRONMENT || 'unconfigured', reason:reason || (paymentAvailable ? payment.reason : 'Pagamentos indisponíveis neste ambiente.') };
  }
  async function saveSettings(data, user) {
    const current = await settings(), result = { ...current };
    if('heroPackImageUrl' in data){try{result.heroPackImageUrl=require('./hero-settings.cjs').heroPackSetting(data.heroPackImageUrl);}catch(error){fail('VALIDATION',error.message);}}
    for (const key of ["storeName", "contactEmail", "whatsapp", "instagram", "companyName", "cnpj", "address", "city", "state", "heroTitle", "heroSubtitle", "about", "shippingPolicy", "returnsPolicy", "privacyPolicy", "terms"]) if (key in data) result[key] = text(data[key], key, ["about", "shippingPolicy", "returnsPolicy", "privacyPolicy", "terms"].includes(key) ? 2e4 : 400, key === "storeName");
    if (result.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.contactEmail)) fail("VALIDATION", "E-mail de contato inválido.");
    if(result.state){result.state=result.state.toUpperCase();if(!Object.values(REGION_STATES).some(states=>states.includes(result.state)))fail('VALIDATION','Informe uma UF brasileira válida.');}
    if(result.city.length>120)fail('VALIDATION','Informe uma cidade de até 120 caracteres.');
    if ('categories' in data) {
      if(!Array.isArray(data.categories) || data.categories.length>30) fail('VALIDATION','Informe até 30 categorias.');
      result.categories=[...new Set(data.categories.map(value=>text(value,'categoria',100,true)))];
    }
    if ('banners' in data) {
      if(!Array.isArray(data.banners) || data.banners.length>10) fail('VALIDATION','Informe até 10 banners.');
      result.banners=data.banners.map(banner=>{
        const url=text(banner.url || '/lacrados','banner.url',2000,true);
        if(!/^\/[a-zA-Z0-9/?=&%_+-]*$/.test(url) && !/^https:\/\//.test(url)) fail('VALIDATION','Link de banner inválido.');
        return {title:text(banner.title,'banner.title',160,true),subtitle:text(banner.subtitle,'banner.subtitle',400),image:banner.image?imageUrl(banner.image):'',url,active:banner.active!==false};
      });
    }
    if (data.shipping) {
      result.shipping = validateShippingSettings(data.shipping,current.shipping,{fail,store:result,env:effectiveEnv});
    }
    else if(['address','city','state','whatsapp'].some(key=>key in data))result.shipping=validateShippingSettings({},current.shipping,{fail,store:result,env:effectiveEnv});
    await transaction(db, async () => {
      (await db.prepare("UPDATE settings SET value_json=?,updated_at=? WHERE id=1").run(JSON.stringify(result), now()));
      await audit(user.id, "SETTINGS_UPDATED", "store", { fields: Object.keys(data) });
    });
    return result;
  }
  function coupon(row) {
    return { id: row.id, code: row.code, type: row.type, value: row.value, minimumCents: row.minimum_cents, startsAt: row.starts_at, endsAt: row.ends_at, maxUses: row.max_uses, usedCount: row.used_count, active: !!row.active, createdAt: row.created_at };
  }
  async function saveCoupon(data, user, existing) {
    const code = text(data.code, "code", 40, true).toUpperCase();
    if (!/^[A-Z0-9_-]+$/.test(code)) fail("VALIDATION", "Use letras, números, hífen e sublinhado no cupom.");
    const type = text(data.type, "type", 20, true);
    if (!["PERCENT", "FIXED"].includes(type)) fail("VALIDATION", "Tipo de cupom inválido.");
    const value = integer(data.value, "value", 1, type === "PERCENT" ? 100 : 1e8);
    const date = (v) => {
      if (!v) return null;
      if (!Number.isFinite(Date.parse(v))) fail("VALIDATION", "Data do cupom inválida.");
      return new Date(v).toISOString();
    };
    const starts = date(data.startsAt), ends = date(data.endsAt);
    if (starts && ends && ends <= starts) fail("VALIDATION", "A validade final deve ser posterior ao início.");
    const id = existing?.id || uid(), minimum = integer(data.minimumCents || 0, "minimumCents"), max = data.maxUses == null ? null : integer(data.maxUses, "maxUses", 1, 1e6);
    await transaction(db, async () => {
      if (existing) (await db.prepare("UPDATE coupons SET code=?,type=?,value=?,minimum_cents=?,starts_at=?,ends_at=?,max_uses=?,active=? WHERE id=?").run(code, type, value, minimum, starts, ends, max, +(data.active !== false), id));
      else (await db.prepare("INSERT INTO coupons VALUES(?,?,?,?,?,?,?,?,0,?,?)").run(id, code, type, value, minimum, starts, ends, max, +(data.active !== false), now()));
      await audit(user.id, existing ? "COUPON_UPDATED" : "COUPON_CREATED", id, { code });
    });
    return coupon((await db.prepare("SELECT * FROM coupons WHERE id=?").get(id)));
  }
  async function legacyOrder(row) {
    return { ...row, subtotalCents: row.subtotal_cents, discountCents: row.discount_cents, shippingCents: row.shipping_cents, totalCents: row.total_cents, paymentStatus: row.payment_status, shippingStatus: row.shipping_status, createdAt: row.created_at, address: JSON.parse(row.address_json), items: (await db.prepare("SELECT * FROM order_items WHERE order_id=?").all(row.id)).map((i) => ({ ...i, unitPriceCents: i.unit_price_cents, totalCents: i.total_cents, variant: JSON.parse(i.variant_json) })) };
  }
  const { createOrders } = require('./orders.cjs');
  const orders = createOrders({db,quote,env:effectiveEnv,audit,ApiError,enqueueEmail,paymentProvider:options.paymentProvider});
  const runCommerceJob=createCommerceJob({expireOrders:options=>orders.expireDue(options),flushEmails});
  const order = orders.serialize;
  async function dispatch(req, res, pathname) {
    const respond = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(data));
    };
    try {
      if(pathname===EMAIL_JOB_PATH || pathname===COMMERCE_JOB_PATH) {
        if(!emailJobAuthorized(req.headers,effectiveEnv,{path:pathname,method:req.method}))return respond(401,{error:{code:'JOB_UNAUTHORIZED',message:'Acesso não autorizado.'}});
        if(req.method!=='GET') {res.setHeader('Allow','GET');return respond(405,{error:{code:'METHOD_NOT_ALLOWED',message:'Método não permitido.'}});}
        await db.ready;
        return respond(200,await (pathname===COMMERCE_JOB_PATH?runCommerceJob():runEmailJob()));
      }
      await db.ready;
      if(req.method==='POST' && pathname==='/api/email/webhook/resend') {
        limit(req,'email-webhook',120,60000);
        const chunks=[];let length=0;
        if(req.body!==undefined) {
          if(typeof req.body!=='string' && !Buffer.isBuffer(req.body)) throw new ApiError(400,'EMAIL_RAW_BODY_REQUIRED','A assinatura exige o corpo original.');
          chunks.push(Buffer.from(req.body));length=chunks[0].length;
        } else for await(const chunk of req) {length+=chunk.length;if(length>131072)throw new ApiError(413,'BODY_TOO_LARGE','Notificação acima do limite.');chunks.push(Buffer.from(chunk));}
        if(length>131072)throw new ApiError(413,'BODY_TOO_LARGE','Notificação acima do limite.');
        const verified=require('./email.cjs').verifyResendWebhook({payload:Buffer.concat(chunks),headers:req.headers,secret:effectiveEnv.RESEND_WEBHOOK_SECRET});
        return respond(200,await emailStore.applyProviderEvent(verified));
      }
      // Only the OAuth callback accepts a cross-site top-level GET. Its one-use
      // state is bound to the existing HttpOnly BKM session before token exchange.
      if(req.method==='GET' && pathname==='/api/auth/google/callback') {
        limit(req,'oauth-callback',30);
        const query=new URL(req.url,'https://localhost').searchParams;
        const oauthSession=await getSession(req);
        let target='/entrar?google=failed';
        try {
          const result=await google.finish({session:oauthSession,state:query.get('state'),code:query.get('code'),error:query.get('error')});
          await newSession(res,result.user.id,oauthSession);
          if(result.created) {await enqueueEmail({key:'welcome:'+result.user.id,template:'welcome',to:result.user.email,data:{name:result.user.name}});await flushSafely();}
          target=safeReturnPath(result.returnTo);
        } catch(error) {
          const reasons={GOOGLE_ACCOUNT_LINK_REQUIRED:'link-required',GOOGLE_CANCELLED:'cancelled',GOOGLE_ADMIN_LINK_FORBIDDEN:'admin-password'};
          target='/entrar?google='+(reasons[error.code] || 'failed');
        }
        res.writeHead(303,{'Location':target,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
        return res.end();
      }
      origin(req);
      limit(req, "api", 500, 6e4);
      const query = new URL(req.url, "http://localhost").searchParams;
      const method = req.method;
      if(method==='POST' && pathname==='/api/payments/webhook/mercadopago') {
        limit(req,'payment-webhook',120,6e4);
        await readJson(req,65536);
        if(query.getAll('data.id').length!==1) throw new ApiError(400,'PAYMENT_ID_INVALID','Informe um único identificador do recurso assinado.');
        try {
          await orders.webhook({signature:req.headers['x-signature'],requestId:req.headers['x-request-id'],dataId:query.get('data.id')});
        } catch(error) {
          const reason=error instanceof PaymentError?error.diagnosticCode:null;
          if(error instanceof PaymentError && error.status===401 && error.code==='PAYMENT_WEBHOOK_INVALID' && ['HEADER_FORMAT','SIGNATURE_FORMAT','TIMESTAMP_WINDOW','HMAC_MISMATCH'].includes(reason)) console.warn('BKM_MP_WEBHOOK_REJECTED',{reason});
          throw error;
        }
        return respond(200,{received:true});
      }
      let session = await getSession(req);
      if (method === "GET" && pathname === "/api/session") {
        return respond(200, session ? { user: publicUser(session.user), csrfToken: session.csrf_token } : await newSession(res));
      }
      if (method === "GET" && pathname === "/api/config") return respond(200, await config());
      if(method==='GET'&&pathname==='/api/shipping/address'){
        limit(req,'shipping-address',60,60000);
        const cep=query.get('cep');
        if(query.getAll('cep').length!==1||!/^\d{8}$/.test(cep||'')||cep==='00000000')throw new ApiError(422,'INVALID_CEP','Informe um CEP com oito números.');
        return respond(200,{address:await shippingPolicy.destination(cep)});
      }
      if (method === 'GET' && pathname === '/api/collections') return respond(200,await collections.list(query));
      if (method === "GET" && pathname === "/api/products") return respond(200, await listProducts(query));
      if (method === "GET" && /^\/api\/products\/[^/]+$/.test(pathname)) {
        const slug = pathname.split("/").at(-1), row = (await db.prepare("SELECT * FROM products WHERE slug=? AND published=1 AND archived=0").get(slug));
        if (!row) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Produto não encontrado.");
        return respond(200, { ...await product(row), related: (await listProducts(new URLSearchParams({ set: row.set_id, pageSize: "5" }))).items.filter((p) => p.id !== row.id).slice(0, 4) });
      }
      if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) csrf(req, session);
      if(method==='POST' && pathname==='/api/auth/google/start') {
        limit(req,'oauth-start',15);
        const data=await readJson(req);
        if(data.intent==='link') auth(session);
        const result=await google.start({session,mode:data.intent || 'login',returnTo:safeReturnPath(data.next)});
        return respond(200,{url:result.authorizationUrl});
      }
      if (method === "POST" && ["/api/auth/login", "/api/auth/register"].includes(pathname)) {
        limit(req, "auth", 20);
        const data = await readJson(req);
        const email = text(data.email, "email", 254, true).toLowerCase(), password = typeof data.password === "string" ? data.password : "";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("VALIDATION", "Informe um e-mail válido.");
        const registering = pathname.endsWith('/register');
        if (registering) {assertPassword(password,message=>fail('VALIDATION',message));assertPasswordConfirmation(password,data.confirmPassword,message=>fail('VALIDATION',message));}
        if (!registering && (!password.length || password.length > 128)) throw new ApiError(401, "INVALID_CREDENTIALS", "E-mail ou senha incorretos.");
        let user = (await db.prepare("SELECT * FROM users WHERE email=?").get(email));
        if (registering) {
          if (user) fail("REGISTRATION_UNAVAILABLE", "Não foi possível cadastrar este e-mail. Tente entrar ou contate a loja.");
          const name = text(data.name, "name", 120, true);
          const id = uid();
          (await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)").run(id, email, name, await hashPassword(password), "CUSTOMER", now()));
          await enqueueEmail({key:'welcome:'+id,template:'welcome',to:email,data:{name}});
          await flushSafely();
          return respond(201, await newSession(res, id, session));
        }
        const valid = await verifyPassword(password, user?.password_hash || dummyPassword);
        if (!user || !valid) throw new ApiError(401, "INVALID_CREDENTIALS", "E-mail ou senha incorretos.");
        return respond(200, await newSession(res, user.id, session));
      }
      if (method === "POST" && pathname === "/api/auth/logout") {
        if (session) (await db.prepare("DELETE FROM sessions WHERE token_hash=?").run(session.token_hash));
        return respond(200, await newSession(res));
      }
      if (method === "POST" && pathname === "/api/auth/forgot-password") {
        limit(req, "recovery", 5);
        const data=await readJson(req),email=text(data.email,'email',254,true).toLowerCase();
        const user=await db.prepare('SELECT * FROM users WHERE email=?').get(email);
        if(user && !user.password_hash.startsWith('oauth$')) {
          const token=crypto.randomBytes(32).toString('base64url');
          const base=env.BKM_PUBLIC_URL || publicUrl || env.PUBLIC_URL || `http://${req.headers.host}`;
          await db.transaction(async()=>{
            await db.prepare('DELETE FROM password_resets WHERE user_id=? OR expires_at<?').run(user.id,Date.now());
            await db.prepare('INSERT INTO password_resets VALUES(?,?,?,NULL,?)').run(hashToken(token),user.id,Date.now()+30*60000,now());
            await enqueueEmail({key:'password-reset:'+uid(),template:'password-reset',to:user.email,data:{name:user.name,resetUrl:base.replace(/\/$/,'')+'/recuperar-senha?token='+token}});
          });
        }
        await flushSafely();
        return respond(202,{message:'Se existir uma conta com este e-mail, enviaremos as instruções pelo canal disponível. Contas criadas com Google devem continuar com Google.'});
      }
      if(method==='POST' && pathname==='/api/auth/reset-password') {
        limit(req,'reset',10);
        const data=await readJson(req),token=text(data.token,'token',100,true),password=typeof data.password==='string'?data.password:'';
        assertPassword(password,message=>fail('VALIDATION',message));
        assertPasswordConfirmation(password,data.confirmPassword,message=>fail('VALIDATION',message));
        const passwordHash=await hashPassword(password);
        await db.transaction(async()=>{
          const row=await db.prepare('SELECT * FROM password_resets WHERE token_hash=?'+db.lockSuffix).get(hashToken(token));
          if(!row || row.used_at || row.expires_at<=Date.now()) throw new ApiError(422,'RESET_INVALID','Link inválido ou expirado. Solicite uma nova recuperação.');
          await db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash,row.user_id);
          await db.prepare('UPDATE password_resets SET used_at=? WHERE token_hash=?').run(now(),row.token_hash);
          await db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.user_id);
        });
        return respond(200,{message:'Senha atualizada. Entre novamente com sua nova senha.'});
      }
      if (method === "POST" && pathname === "/api/checkout/quote") { limit(req,'shipping-quote',60,60000);if(orders.expireDue)await orders.expireDue();return respond(200, await quote(await readJson(req))); }
      if (method === "POST" && pathname === "/api/checkout") {
        const user=auth(session),created=await orders.create(await readJson(req),user);
        await notifications.markCartConverted(user.id);await flushSafely();
        return respond(201,{order:created});
      }
      if (pathname.startsWith("/api/account")) {
        const user = auth(session);
        if(pathname.startsWith('/api/account/collection/')) {
          const collectionDelete = method==='DELETE' && /^\/api\/account\/collection\/inventory\/[^/]+$/.test(pathname);
          const body=['POST','PUT','PATCH'].includes(method)||collectionDelete?await readJson(req,2*1024*1024):{};
          const preferencesRoute=pathname==='/api/account/collection/preferences';
          const perform=async()=>{
            const result=await personal.handle({method,path:pathname,query,user,body});
            if(result && preferencesRoute) {
              if(method==='PUT') {
                const mapping={notifyEmail:'wishlistEnabled',marketing:'newsEnabled',abandonedCart:'cartEnabled',priceAlerts:'priceEnabled'};
                const explicit=Object.fromEntries(Object.entries(mapping).filter(([key])=>Object.hasOwn(body,key)).map(([key,mapped])=>[mapped,body[key]]));
                if(Object.hasOwn(body,'digest')) {explicit.digestEnabled=body.digest!=='immediate';explicit.frequencyHours=body.digest==='weekly'?168:24;}
                if(Object.keys(explicit).length)await notifications.setPreferences(user.id,explicit);
              }
              result.data.email=await notifications.getPreferences(user.id);
            }
            return result;
          };
          const result=preferencesRoute && method==='PUT'?await db.transaction(perform):await perform();
          if(result)return respond(result.status,result.data);
        }
        if(pathname==='/api/account/security' && method==='GET') {
          const identity=await db.prepare("SELECT email FROM oauth_identities WHERE user_id=? AND provider='google'").get(user.id);
          const sessions=await db.prepare('SELECT COUNT(*) count FROM sessions WHERE user_id=? AND expires_at>?').get(user.id,Date.now());
          return respond(200,{passwordEnabled:!user.password_hash.startsWith('oauth$'),google:{enabled:google.readiness().enabled,linked:!!identity,...(identity?{email:identity.email}:{})},sessions:{active:sessions.count}});
        }
        if (["/api/account/cart", "/api/account/favorites"].includes(pathname) && ["GET", "PUT"].includes(method)) {
          const body = method === "PUT" ? await readJson(req) : null;
          const result=await accountList(db,user,pathname,method,body,product);
          if(method==='PUT' && pathname.endsWith('/cart'))await notifications.trackCart({userId:user.id,items:body.items});
          return respond(200,result);
        }
        if (pathname === "/api/account/profile" && method === "GET") return respond(200, { user: publicUser(user), profile: JSON.parse(user.profile_json) });
        if (pathname === "/api/account/profile" && method === "PUT") {
          const data = await readJson(req);
          const name = text(data.name || user.name, "name", 120, true);
          const profile = await db.transaction(async()=>{
            const fresh=await db.prepare('SELECT profile_json FROM users WHERE id=?'+db.lockSuffix).get(user.id);
            const next={...JSON.parse(fresh.profile_json),phone:text(data.phone,'phone',30)};
            await db.prepare('UPDATE users SET name=?,profile_json=? WHERE id=?').run(name,JSON.stringify(next),user.id);
            return next;
          });
          return respond(200, { user: publicUser({ ...user, name }), profile });
        }
        if (pathname.startsWith('/api/account/addresses') || pathname==='/api/account/security/password') {
          if(pathname.endsWith('/password')) limit(req,'password-change',5);
          const result=await customerProfile.handle({user,method,path:pathname,body:['POST','PUT'].includes(method)?await readJson(req):{}});
          if(result) {
            if(pathname.endsWith('/password')) return respond(200,{...result,...await newSession(res,user.id)});
            return respond(method==='POST' && pathname.endsWith('/addresses')?201:200,result);
          }
        }
        if (/^\/api\/account\/orders\/[^/]+\/simulate$/.test(pathname) && method === 'POST') return respond(200,{order:await orders.simulate(pathname.split('/')[4],await readJson(req),user)});
        if (/^\/api\/account\/orders\/[^/]+\/payment$/.test(pathname) && method === 'POST') return respond(200,{order:await orders.payment(pathname.split('/')[4],await readJson(req),user)});
        if (/^\/api\/account\/orders\/[^/]+\/reconcile$/.test(pathname) && method === 'POST') return respond(200,{order:await orders.reconcile(pathname.split('/')[4],user)});
        if (pathname === "/api/account/orders" && method === "GET") return respond(200, { items: await orders.serializeMany(await db.prepare("SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100").all(user.id)) });
        if (/^\/api\/account\/orders\/[^/]+$/.test(pathname) && method === "GET") {
          const row = (await db.prepare("SELECT * FROM orders WHERE id=? AND user_id=?").get(pathname.split("/").at(-1), user.id));
          if (!row) throw new ApiError(404, "ORDER_NOT_FOUND", "Pedido não encontrado.");
          return respond(200, await order(row));
        }
      }
      if (pathname.startsWith("/api/catalog/")) {
        auth(session, true);
        if (method !== "GET") throw new ApiError(405, "METHOD", "Método não permitido.");
        let provider;
        try {
          provider = require("./catalog.cjs");
        } catch {
          throw new ApiError(503, "CATALOG_UNAVAILABLE", "Catálogo externo indisponível. O cadastro manual continua disponível.");
        }
        if (pathname === "/api/catalog/sets") return respond(200, await provider.listSets({ language: query.get("language") || "pt" }));
        if (pathname === "/api/catalog/search") return respond(200, await provider.searchCards({ language: query.get("language") || "pt", set: query.get("set"), number: query.get("number"), name: query.get("name") }));
      }
      if (pathname.startsWith("/api/admin")) {
        const user = auth(session, true);
        if(pathname.startsWith('/api/admin/catalog/')) {
          limit(req,'admin-product-catalog',180,60000);
          if(pathname==='/api/admin/catalog/sets'&&method==='GET')return respond(200,await productWorkflow.sets(query.get('language')||'pt'));
          if(pathname==='/api/admin/catalog/card'&&method==='GET')return respond(200,await productWorkflow.catalog.card(query.get('id'),query.get('setId'),query.get('language')||'pt'));
          if(pathname==='/api/admin/catalog/search'&&method==='GET')return respond(200,await productWorkflow.search(query,user,session));
          if(pathname==='/api/admin/catalog/manual-fallback'&&method==='POST')return respond(200,await productWorkflow.manualFallback(await readJson(req),user,session));
        }
        if(pathname.startsWith('/api/admin/market-prices')) {
          const result=await market.handleAdmin({user,method,path:pathname,query,body:method==='POST'?await readJson(req,2*1024*1024):{}});
          if(result)return respond(result.status,result.data);
        }
        if(pathname==='/api/admin/integrations' && method==='GET') {
          const counts=await db.prepare("SELECT COUNT(*) count FROM personal_wishlist WHERE enabled=1").get();
          const storeSettings=await settings(),configured=hasConfiguredShipping(storeSettings.shipping,{production:effectiveEnv.BKM_ENVIRONMENT==='production',env:effectiveEnv});
          return respond(200,{google:google.readiness(),email:require('./email.cjs').emailReadiness(effectiveEnv),payments:paymentReadiness(effectiveEnv),publicUrl,prices:{provider:'admin_manual',automatic:false,automaticBrazilian:false,automaticInternational:true,international:{provider:'tcgdex',currencies:['EUR','USD'],conditionAdjusted:false},reason:'TCGdex automático em EUR/USD, sem ajuste por conservação ou idioma de mercado. Referências em BRL continuam manuais; integração brasileira automática pendente de fonte autorizada.'},wishlist:{subscriptions:counts.count},abandonedCart:{enabled:false},shipping:{provider:storeSettings.shipping.rateMode==='melhorenvio'?'melhorenvio':'store_validated_manual',environment:effectiveEnv.BKM_ENVIRONMENT,configured,enabled:configured,mode:storeSettings.shipping.rateMode,national:operationalShippingReadiness(storeSettings.shipping),reason:storeSettings.shipping.enabled?'Envio nacional habilitado conforme a configuração operacional; etiquetas e postagem são gerenciadas pela loja.':configured?'Envio nacional desligado. Retirada ou entrega local disponíveis conforme a configuração.':'Configure o frete, retirada ou entrega local antes de aceitar pedidos.',carrierIntegration:require('./shipping-provider.cjs').shippingReadiness({...effectiveEnv,MELHOR_ENVIO_ORIGIN_ZIP:storeSettings.shipping.origin.zip})}});
        }
        if(pathname==='/api/admin/collections' && method==='GET') return respond(200,await collections.list(query));
        if(pathname==='/api/admin/collections' && method==='POST') return respond(201,await collections.save(await readJson(req),user));
        if(/^\/api\/admin\/collections\/[^/]+$/.test(pathname) && method==='PUT') return respond(200,await collections.save(await readJson(req),user,pathname.split('/').at(-1)));
        if(pathname==='/api/admin/emails' && method==='GET') {
          await flushEmails();
          const rows=await db.prepare('SELECT id,payload_json,status,created_at,preview_json,last_error,attempts,delivery_status,last_event_at FROM email_outbox ORDER BY created_at DESC LIMIT 100').all();
          return respond(200,{integration:require("./email.cjs").emailReadiness(effectiveEnv),items:rows.map(row=>{
            const payload=JSON.parse(row.payload_json),preview=JSON.parse(row.preview_json || 'null');
            return {id:row.id,to:preview?.toMasked || String(payload.to).replace(/^(.{1,2})[^@]*(@.*)$/,'$1***$2'),subject:preview?.subject || payload.template,template:payload.template,status:row.status,createdAt:row.created_at,text:preview?.text || 'Mensagem na fila de envio.',demo,attempts:row.attempts,errorCode:row.last_error,deliveryStatus:row.delivery_status,lastEventAt:row.last_event_at};
          })});
        }
        if(/^\/api\/admin\/emails\/[^/]+\/retry$/.test(pathname) && method==='POST') {
          const id=pathname.split('/')[4],entry=await db.prepare('SELECT * FROM email_outbox WHERE id=?').get(id);
          if(!entry) throw new ApiError(404,'NOT_FOUND','E-mail não encontrado.');
          if(entry.status==='SENT') throw new ApiError(409,'EMAIL_ALREADY_PROCESSED','Este e-mail já foi processado.');
          if(entry.status==='PROCESSING' && entry.locked_until>Date.now()) throw new ApiError(409,'EMAIL_PROCESSING','Este e-mail já está sendo processado.');
          await db.prepare("UPDATE email_outbox SET status='PENDING',next_attempt_at=?,locked_until=NULL WHERE id=?").run(Date.now(),id);
          await flushEmails();
          return respond(200,{queued:true,demo});
        }
        if (pathname === "/api/admin/products" && method === "GET") return respond(200, await listProducts(query, true));
        if (pathname === "/api/admin/products" && method === "POST") return respond(201, await saveProduct(await readJson(req), user.id,undefined,session));
        if (/^\/api\/admin\/products\/[^/]+$/.test(pathname)) {
          const id = pathname.split("/").at(-1), existing = (await db.prepare("SELECT * FROM products WHERE id=?").get(id));
          if (!existing) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Produto não encontrado.");
          if (method === "GET") return respond(200, await product(existing, true));
          if (method === "PUT") return respond(200, await saveProduct(await readJson(req), user.id, existing,session));
          if (method === "DELETE") {
            await transaction(db, async () => {
              (await db.prepare("UPDATE products SET archived=1,published=0,updated_at=? WHERE id=?").run(now(), id));
              await audit(user.id, "PRODUCT_ARCHIVED", id);
            });
            return respond(200, { archived: true });
          }
        }
        if (pathname === "/api/admin/settings" && method === "GET") return respond(200, await settings());
        if (pathname === "/api/admin/settings" && method === "PUT") return respond(200, await saveSettings(await readJson(req), user));
        if (pathname === "/api/admin/coupons" && method === "GET") return respond(200, { items: (await db.prepare("SELECT * FROM coupons ORDER BY created_at DESC").all()).map(coupon) });
        if (pathname === "/api/admin/coupons" && method === "POST") return respond(201, await saveCoupon(await readJson(req), user));
        if (/^\/api\/admin\/coupons\/[^/]+$/.test(pathname) && method === "PUT") {
          const c = (await db.prepare("SELECT * FROM coupons WHERE id=?").get(pathname.split("/").at(-1)));
          if (!c) throw new ApiError(404, "NOT_FOUND", "Cupom não encontrado.");
          return respond(200, await saveCoupon(await readJson(req), user, c));
        }
        if (/^\/api\/admin\/orders\/[^/]+\/simulate$/.test(pathname) && method === 'POST') return respond(200,{order:await orders.simulate(pathname.split('/')[4],await readJson(req),user,true)});
        if (/^\/api\/admin\/orders\/[^/]+\/reconcile$/.test(pathname) && method === 'POST') return respond(200,{order:await orders.reconcile(pathname.split('/')[4],user,true)});
        if (/^\/api\/admin\/orders\/[^/]+\/shipping$/.test(pathname) && ['PATCH','PUT'].includes(method)) return respond(200,{order:await orders.shipping(pathname.split('/')[4],await readJson(req),user)});
        if (/^\/api\/admin\/orders\/[^/]+$/.test(pathname) && method === 'GET') {
          const row = await db.prepare('SELECT * FROM orders WHERE id=?').get(pathname.split('/').at(-1));
          if(!row) throw new ApiError(404,'ORDER_NOT_FOUND','Pedido não encontrado.');
          return respond(200,await order(row));
        }
        if (pathname === "/api/admin/orders" && method === "GET") return respond(200, { items: await orders.serializeMany(await db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 200").all()) });
        if (pathname === "/api/admin/summary" && method === "GET") {
          const count = async (sql) => (await db.prepare(sql).get()).value;
          return respond(200, { products: await count("SELECT COUNT(*) value FROM products WHERE archived=0"), published: await count("SELECT COUNT(*) value FROM products WHERE archived=0 AND published=1"), stockUnits: await count("SELECT COALESCE(SUM(v.stock),0) value FROM variants v JOIN products p ON p.id=v.product_id WHERE v.active=1 AND p.archived=0"), singles: await count("SELECT COUNT(*) value FROM products WHERE archived=0 AND kind='SINGLE'"), sealed: await count("SELECT COUNT(*) value FROM products WHERE archived=0 AND kind='SEALED'"), lowStock: await count("SELECT COUNT(*) value FROM variants WHERE active=1 AND stock BETWEEN 1 AND 2"), outOfStock: await count("SELECT COUNT(*) value FROM variants WHERE active=1 AND stock=0"), orders: await count("SELECT COUNT(*) value FROM orders"), pendingOrders: await count("SELECT COUNT(*) value FROM orders WHERE payment_status='PENDING'"), paidOrders: await count("SELECT COUNT(*) value FROM orders WHERE payment_status IN('PAID','APPROVED')"), confirmedRevenueCents: await count("SELECT COALESCE(SUM(total_cents),0) value FROM orders WHERE payment_status IN('PAID','APPROVED')") });
        }
        if (pathname === "/api/admin/inventory" && method === "GET") return respond(200, { items: (await db.prepare("SELECT s.*,p.name FROM stock_movements s JOIN variants v ON v.id=s.variant_id JOIN products p ON p.id=v.product_id ORDER BY s.created_at DESC LIMIT 200").all()) });
        if (pathname === "/api/admin/audit" && method === "GET") return respond(200, { items: (await db.prepare("SELECT * FROM admin_audit ORDER BY created_at DESC LIMIT 200").all()) });
        if (pathname === "/api/admin/uploads" && method === "POST") {
          const data = await readJson(req, 12 * 1024 * 1024);
          const match = typeof data.dataUrl === "string" && data.dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
          if (!match) fail("INVALID_IMAGE", "Envie uma imagem PNG, JPEG ou WebP.");
          const bytes = Buffer.from(match[2], "base64");
          if (bytes.length < 12 || bytes.length > 8 * 1024 * 1024) fail("INVALID_IMAGE", "A imagem deve ter até 8 MB.");
          const format=require('./image-format.cjs').detectImageFormat(bytes);
          if (!format) fail("INVALID_IMAGE", "O arquivo não contém uma imagem PNG, JPEG ou WebP válida. Escolha outra imagem.");
          const filename = uid() + "." + format.extension;
          const {createStorage}=require('./storage.cjs');
          const uploaded=await createStorage({root,env}).upload({buffer:bytes,mime:format.mime,filename});
          await audit(user.id, "IMAGE_UPLOADED", filename, { size: bytes.length });
          return respond(201, uploaded);
        }
      }
      throw new ApiError(404, "NOT_FOUND", "Recurso não encontrado.");
    } catch (error) {
      let status = error.status || 500, code = error.code || "INTERNAL", message = error.message;
      if (["23505","23514","23503"].includes(error.code) || String(error.code || "").startsWith("SQLITE_CONSTRAINT") || /UNIQUE constraint failed/.test(error.message)) {
        status = 409;
        code = "CONFLICT";
        message = "Já existe um registro com este SKU, URL ou combinação de variante.";
      }
      if (status >= 500 && !(error instanceof ApiError) && !String(error.code || "").startsWith("CATALOG")) {
        message = "Não foi possível concluir a solicitação. Tente novamente.";
        code = "INTERNAL";
      }
      respond(status, { error: { code, message, ...error.fields ? { fields: error.fields } : {} } });
    }
  }
  const handle = (req,res,pathname) => db.exclusive(() => dispatch(req,res,pathname));
  return { handle, ready: db.ready, close: () => db.close(), db: db.raw || db, asyncStore: db };
}
module.exports = { createApi, ApiError, normalized, readJson };
