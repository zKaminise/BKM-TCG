const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { openDatabase, defaultSettings } = require("./db.cjs");
const { hashPassword, verifyPassword, hashToken, publicUser } = require("./auth.cjs");
const { accountList } = require("./accounts.cjs");
const { paymentReadiness } = require("./payments.cjs");
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
function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = fn();
    db.exec("COMMIT");
    return value;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
async function readJson(req, max = 1024 * 1024) {
  if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")) throw new ApiError(415, "CONTENT_TYPE", "Envie os dados em JSON.");
  if (Number(req.headers["content-length"] || 0) > max) throw new ApiError(413, "BODY_TOO_LARGE", "Arquivo ou formulário acima do limite permitido.");
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > max) throw new ApiError(413, "BODY_TOO_LARGE", "Arquivo ou formulário acima do limite permitido.");
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "JSON inválido.");
  }
}
function createApi(options = {}) {
  const root = options.root || path.resolve(__dirname, "..");
  const db = openDatabase(options.dbPath || process.env.BKM_DB_PATH || path.join(root, "data", "bkm.sqlite"));
  const rateLimits = /* @__PURE__ */ new Map();
  const dummyPassword = "scrypt$32768$8$1$00000000000000000000000000000000$" + "0".repeat(128);
  function audit(actor, action, entity, details = {}) {
    db.prepare("INSERT INTO admin_audit VALUES(?,?,?,?,?,?)").run(uid(), actor, action, entity, JSON.stringify(details), now());
  }
  function settings() {
    const saved = JSON.parse(db.prepare("SELECT value_json FROM settings WHERE id=1").get().value_json);
    return { ...defaultSettings, ...saved, shipping: { ...defaultSettings.shipping, ...saved.shipping } };
  }
  function config() {
    const s = settings();
    const payment = paymentReadiness();
    return { ...s, freeShippingThresholdCents: s.shipping.freeShippingEnabled ? s.shipping.freeShippingThresholdCents : null, paymentConfigured: false, shippingConfigured: s.shipping.enabled, payments: { available: false, provider: payment.provider, reason: payment.reason } };
  }
  function limit(req, scope, max, windowMs = 15 * 60 * 1e3) {
    const key = `${req.socket.remoteAddress}:${scope}`;
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
  function getSession(req) {
    const cookie = (req.headers.cookie || "").split(";").map((x) => x.trim()).find((x) => x.startsWith("bkm_session="));
    const token = cookie?.slice(12);
    if (!token || !/^[-_A-Za-z0-9]{43}$/.test(token)) return null;
    const s = db.prepare("SELECT * FROM sessions WHERE token_hash=? AND expires_at>?").get(hashToken(token), Date.now());
    if (!s) return null;
    s.user = s.user_id ? db.prepare("SELECT * FROM users WHERE id=?").get(s.user_id) : null;
    return s;
  }
  function newSession(res, userId = null, previous = null) {
    if (previous) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(previous.token_hash);
    const token = crypto.randomBytes(32).toString("base64url"), csrfToken = crypto.randomBytes(32).toString("base64url");
    const age = userId ? 7 * 86400 : 86400;
    db.prepare("DELETE FROM sessions WHERE expires_at<?").run(Date.now());
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?,?)").run(hashToken(token), userId, csrfToken, Date.now() + age * 1e3, Date.now());
    res.setHeader("Set-Cookie", `bkm_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${options.secureCookies ? "; Secure" : ""}`);
    return { user: userId ? publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(userId)) : null, csrfToken };
  }
  function auth(session, admin = false) {
    if (!session?.user) throw new ApiError(401, "UNAUTHENTICATED", "Entre na sua conta para continuar.");
    if (admin && session.user.role !== "ADMIN") throw new ApiError(403, "FORBIDDEN", "Acesso exclusivo à administração.");
    return session.user;
  }
  function csrf(req, session) {
    const incoming = req.headers["x-csrf-token"];
    if (!session || typeof incoming !== "string" || incoming !== session.csrf_token) throw new ApiError(403, "CSRF", "Atualize a página antes de enviar este formulário.");
  }
  function origin(req) {
    if (req.headers["sec-fetch-site"] === "cross-site") throw new ApiError(403, "ORIGIN", "Origem da solicitação não permitida.");
    if (req.headers.origin) {
      const expected = `${req.socket.encrypted ? "https" : "http"}://${req.headers.host}`;
      if (req.headers.origin !== expected) throw new ApiError(403, "ORIGIN", "Origem da solicitação não permitida.");
    }
  }
  function product(row, admin = false) {
    if (!row) return null;
    const variants = db.prepare("SELECT * FROM variants WHERE product_id=? AND active=1 ORDER BY rowid").all(row.id).map((v) => ({ id: v.id, language: v.language, condition: v.condition, finish: v.finish, priceCents: v.price_cents, compareAtCents: v.compare_at_cents, stock: v.stock }));
    const metadata = row.card_id ? JSON.parse(db.prepare("SELECT metadata_json FROM card_metadata WHERE id=?").get(row.card_id).metadata_json) : null;
    return { id: row.id, slug: row.slug, kind: row.kind, name: row.name, description: row.description, sku: row.sku, tcg: row.tcg, setId: row.set_id, setName: row.set_name, images: JSON.parse(row.images_json), attributes: JSON.parse(row.attributes_json), card: metadata, featured: !!row.featured, published: !!row.published, createdAt: row.created_at, updatedAt: row.updated_at, variants, ...admin ? { archived: !!row.archived } : {} };
  }
  function facets() {
    const rows = db.prepare("SELECT DISTINCT set_id id,set_name name FROM products WHERE published=1 AND archived=0 AND set_id<>'' ORDER BY set_name").all();
    const vs = db.prepare("SELECT DISTINCT v.language,v.condition,v.finish FROM variants v JOIN products p ON p.id=v.product_id WHERE v.active=1 AND p.published=1 AND p.archived=0").all();
    return { sets: rows, languages: [...new Set(vs.map((x) => x.language))], conditions: [...new Set(vs.map((x) => x.condition))], finishes: [...new Set(vs.map((x) => x.finish))] };
  }
  function listProducts(query, admin = false) {
    const clauses = [admin ? "1=1" : "p.published=1 AND p.archived=0"], params = [];
    if (query.get("kind")) {
      const v = query.get("kind");
      if (!["SEALED", "SINGLE"].includes(v)) fail("VALIDATION", "Tipo de produto inválido.");
      clauses.push("p.kind=?");
      params.push(v);
    }
    if (query.get("set")) {
      clauses.push("p.set_id=?");
      params.push(query.get("set"));
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
    if (query.get("available") === "true" || query.get("available") === "1") filters.push("v.stock>0");
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
    const where = clauses.join(" AND "), total = db.prepare(`SELECT COUNT(*) count FROM products p WHERE ${where}`).get(...params).count;
    const rows = db.prepare(`SELECT p.* FROM products p WHERE ${where} ORDER BY ${order2},p.id LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize);
    return { items: rows.map((x) => product(x, admin)), pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) }, facets: facets() };
  }
  function validateProduct(data, existing) {
    const kind = text(data.kind, "kind", 10, true);
    if (!["SEALED", "SINGLE"].includes(kind)) fail("VALIDATION", "Escolha lacrado ou carta avulsa.");
    const name = text(data.name, "name", 180, true), sku = text(data.sku, "sku", 100, true), slug = text(data.slug || normalized(name).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || sku, "slug", 200, true);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) fail("VALIDATION", "URL do produto inválida.");
    const setId = text(data.setId, "setId", 100), setName = text(data.setName, "setName", 200), tcg = text(data.tcg || "pokemon", "tcg", 50, true);
    const description = text(data.description, "description", 15e3);
    if (!Array.isArray(data.images) || data.images.length > 12) fail("VALIDATION", "Envie até 12 imagens.");
    const images = data.images.map((i) => {
      if (!i || typeof i !== "object" || Array.isArray(i)) fail("VALIDATION", "Imagem inválida.");
      return { url: imageUrl(i.url), kind: i.kind === "actual" ? "actual" : "reference", alt: text(i.alt, "alt", 250) };
    });
    if (!Array.isArray(data.variants) || !data.variants.length || data.variants.length > 50) fail("VALIDATION", "Cadastre entre 1 e 50 variantes.");
    const combinations = /* @__PURE__ */ new Set(), variantIds = /* @__PURE__ */ new Set();
    const variants = data.variants.map((v) => {
      if (!v || typeof v !== "object" || Array.isArray(v)) fail("VALIDATION", "Variante inválida.");
      if (v.id) {
        if (variantIds.has(v.id)) fail("DUPLICATE_VARIANT", "A mesma variante foi enviada mais de uma vez.");
        variantIds.add(v.id);
      }
      const language = text(v.language || "pt", "language", 15, true), condition = text(v.condition || (kind === "SEALED" ? "SEALED" : "NM"), "condition", 30, true), finish = text(v.finish || "NORMAL", "finish", 60, true), key = `${language}|${condition}|${finish}`;
      if (combinations.has(key)) fail("DUPLICATE_VARIANT", "Há variantes com idioma, condição e acabamento iguais.");
      combinations.add(key);
      const priceCents = integer(v.priceCents, "priceCents", 1);
      const compareAtCents = v.compareAtCents == null ? null : integer(v.compareAtCents, "compareAtCents", priceCents);
      return { id: v.id ? text(v.id, "variantId", 100, true) : null, language, condition, finish, priceCents, compareAtCents, stock: integer(v.stock, "stock", 0, 1e6) };
    });
    let card = null;
    if (kind === "SINGLE") {
      if (!data.card || typeof data.card !== "object" || Array.isArray(data.card) || !setId) fail("VALIDATION", "Informe a coleção e os metadados da carta.");
      const c = data.card;
      card = { name: text(c.name || name, "card.name", 200, true), number: text(String(c.number || ""), "card.number", 40, true), total: c.total == null ? null : text(String(c.total), "card.total", 40), rarity: text(c.rarity, "card.rarity", 100), type: text(Array.isArray(c.type) ? c.type.join(", ") : c.type, "card.type", 100), hp: c.hp == null ? null : text(String(c.hp), "card.hp", 20), provider: text(c.provider || "manual", "card.provider", 50, true), providerId: text(c.providerId, "card.providerId", 150), language: text(c.language || variants[0].language, "card.language", 15, true), setId, setName, tcg };
    }
    let attributes = {};
    if (data.attributes && typeof data.attributes === "object" && !Array.isArray(data.attributes)) {
      for (const k of ["category", "manufacturer", "contents", "specifications", "series", "sellerNotes", "weightGrams", "widthCm", "heightCm", "lengthCm"]) if (data.attributes[k] != null) attributes[k] = text(String(data.attributes[k]), k, 3e3);
    }
    return { id: existing?.id || uid(), kind, name, slug, sku, setId, setName, tcg, description, images, variants, card, attributes, featured: data.featured === true, published: data.published === true };
  }
  function saveProduct(data, actor, existing) {
    const p = validateProduct(data, existing);
    transaction(db, () => {
      let cardId = null;
      if (p.card) {
        const c = p.card, key = JSON.stringify([p.tcg, p.setId, normalized(c.number), c.language, c.provider, c.providerId]);
        const prior = db.prepare("SELECT id FROM card_metadata WHERE identity_key=?").get(key);
        cardId = prior?.id || uid();
        if (!prior) db.prepare("INSERT INTO card_metadata VALUES(?,?,?,?,?,?,?,?)").run(cardId, key, p.tcg, p.setId, c.number, c.language, JSON.stringify(c), now());
        else db.prepare("UPDATE card_metadata SET metadata_json=? WHERE id=?").run(JSON.stringify(c), cardId);
      }
      const search = normalized([p.name, p.sku, p.setName, p.setId, p.attributes.category, p.attributes.series, p.card?.name, p.card?.number, p.card ? `${p.card.number}/${p.card.total || ""}` : ""].join(" "));
      if (existing) db.prepare("UPDATE products SET slug=?,kind=?,name=?,description=?,sku=?,tcg=?,set_id=?,set_name=?,card_id=?,images_json=?,attributes_json=?,search_text=?,featured=?,published=?,updated_at=? WHERE id=?").run(p.slug, p.kind, p.name, p.description, p.sku, p.tcg, p.setId, p.setName, cardId, JSON.stringify(p.images), JSON.stringify(p.attributes), search, +p.featured, +p.published, now(), p.id);
      else db.prepare("INSERT INTO products VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run(p.id, p.slug, p.kind, p.name, p.description, p.sku, p.tcg, p.setId, p.setName, cardId, JSON.stringify(p.images), JSON.stringify(p.attributes), search, +p.featured, +p.published, 0, now(), now());
      const old = db.prepare("SELECT * FROM variants WHERE product_id=?").all(p.id);
      db.prepare("UPDATE variants SET active=0 WHERE product_id=?").run(p.id);
      for (const v of p.variants) {
        let prior = v.id ? old.find((x) => x.id === v.id) : old.find((x) => x.language === v.language && x.condition === v.condition && x.finish === v.finish);
        if (v.id && !prior) fail("VALIDATION", "Esta variante não pertence ao produto.");
        const id = prior?.id || uid();
        if (prior) db.prepare("UPDATE variants SET language=?,condition=?,finish=?,price_cents=?,compare_at_cents=?,stock=?,active=1 WHERE id=?").run(v.language, v.condition, v.finish, v.priceCents, v.compareAtCents, v.stock, id);
        else db.prepare("INSERT INTO variants VALUES(?,?,?,?,?,?,?,?,1)").run(id, p.id, v.language, v.condition, v.finish, v.priceCents, v.compareAtCents, v.stock);
        const delta = v.stock - (prior?.stock || 0);
        if (delta) db.prepare("INSERT INTO stock_movements VALUES(?,?,?,?,?,?,?)").run(uid(), id, actor, delta, v.stock, existing ? "Ajuste administrativo" : "Estoque inicial", now());
      }
      audit(actor, existing ? "PRODUCT_UPDATED" : "PRODUCT_CREATED", p.id, { sku: p.sku, published: p.published });
    });
    return product(db.prepare("SELECT * FROM products WHERE id=?").get(p.id), true);
  }
  function quote(data) {
    if (!Array.isArray(data.items) || data.items.length < 1 || data.items.length > 100) fail("EMPTY_CART", "Adicione produtos ao carrinho.");
    const counts = /* @__PURE__ */ new Map();
    for (const item of data.items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) fail("VALIDATION", "Item de carrinho inválido.");
      const id = text(item.variantId, "variantId", 100, true), quantity = integer(item.quantity, "quantity", 1, 1e3);
      counts.set(id, (counts.get(id) || 0) + quantity);
    }
    const items = [];
    let subtotalCents = 0;
    for (const [variantId, quantity] of counts) {
      const v = db.prepare("SELECT v.*,p.name,p.slug,p.sku,p.images_json,p.published,p.archived FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=? AND v.active=1").get(variantId);
      if (!v || !v.published || v.archived) throw new ApiError(409, "PRODUCT_UNAVAILABLE", "Um produto do carrinho não está mais disponível.", { variantId });
      const reserved = db.prepare("SELECT COALESCE(SUM(quantity),0) q FROM inventory_reservations WHERE variant_id=? AND status='ACTIVE' AND expires_at>?").get(variantId, Date.now()).q;
      const available = Math.max(0, v.stock - reserved);
      if (quantity > available) throw new ApiError(409, "INSUFFICIENT_STOCK", `Estoque insuficiente para ${v.name}.`, { variantId, available });
      const totalCents = v.price_cents * quantity;
      subtotalCents += totalCents;
      if (!Number.isSafeInteger(subtotalCents) || subtotalCents > 1e9) fail("CART_LIMIT", "O valor do carrinho excede o limite.");
      items.push({ variantId, productId: v.product_id, name: v.name, slug: v.slug, sku: v.sku, image: JSON.parse(v.images_json)[0] || null, language: v.language, condition: v.condition, finish: v.finish, quantity, priceCents: v.price_cents, unitPriceCents: v.price_cents, totalCents, availableStock: available });
    }
    let discountCents = 0, coupon2 = null;
    if (data.coupon) {
      const code = text(data.coupon, "coupon", 40, true).toUpperCase();
      const c = db.prepare("SELECT * FROM coupons WHERE code=?").get(code);
      const time = now();
      if (!c || !c.active || c.starts_at && c.starts_at > time || c.ends_at && c.ends_at < time || c.max_uses != null && c.used_count >= c.max_uses || subtotalCents < c.minimum_cents) fail("COUPON_INVALID", "Cupom inválido, expirado ou não aplicável a este carrinho.");
      discountCents = Math.min(subtotalCents, c.type === "PERCENT" ? Math.floor(subtotalCents * c.value / 100) : c.value);
      coupon2 = code;
    }
    const s = settings().shipping;
    const cep = String(data.cep || "").replace(/\D/g, "");
    if (cep && cep.length !== 8) fail("INVALID_CEP", "Informe um CEP com oito números.");
    const net = subtotalCents - discountCents;
    const regional = cep && (!s.regions.length || s.regions.some((r) => cep >= r.start && cep <= r.end));
    const eligible = !!(s.enabled && regional);
    const free = !!(eligible && s.freeShippingEnabled && s.freeShippingThresholdCents != null && net >= s.freeShippingThresholdCents);
    const shippingCents = eligible ? free ? 0 : s.flatRateCents : null;
    const reason = !s.enabled ? "Frete ainda não configurado pela loja." : !cep ? "Informe o CEP para calcular a entrega." : !regional ? "Entrega indisponível para este CEP." : null;
    return { items, subtotalCents, discountCents, shippingCents, totalCents: shippingCents == null ? null : net + shippingCents, coupon: coupon2, errors: [], shipping: { available: eligible, reason, cep, free, estimatedDays: eligible ? s.estimatedDays : null, freeShippingThresholdCents: s.freeShippingEnabled ? s.freeShippingThresholdCents : null, remainingForFreeShippingCents: s.enabled && s.freeShippingEnabled ? Math.max(0, s.freeShippingThresholdCents - net) : null }, paymentAvailable: false, reason: reason || "Pagamentos ainda não configurados. Nenhuma cobrança será realizada." };
  }
  function saveSettings(data, user) {
    const current = settings(), result = { ...current };
    for (const key of ["storeName", "contactEmail", "whatsapp", "instagram", "companyName", "cnpj", "address", "heroTitle", "heroSubtitle", "about", "shippingPolicy", "returnsPolicy", "privacyPolicy", "terms"]) if (key in data) result[key] = text(data[key], key, ["about", "shippingPolicy", "returnsPolicy", "privacyPolicy", "terms"].includes(key) ? 2e4 : 400, key === "storeName");
    if (result.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.contactEmail)) fail("VALIDATION", "E-mail de contato inválido.");
    if (data.shipping) {
      const s = { ...current.shipping, ...data.shipping };
      s.enabled = bool(s.enabled, "shipping.enabled");
      s.flatRateCents = integer(s.flatRateCents, "shipping.flatRateCents");
      s.estimatedDays = integer(s.estimatedDays, "shipping.estimatedDays", 0, 365);
      s.freeShippingEnabled = bool(s.freeShippingEnabled, "shipping.freeShippingEnabled");
      s.freeShippingThresholdCents = s.freeShippingThresholdCents == null ? null : integer(s.freeShippingThresholdCents, "shipping.freeShippingThresholdCents", 1);
      if (s.freeShippingEnabled && s.freeShippingThresholdCents == null) fail("VALIDATION", "Informe o valor mínimo de frete grátis.");
      if (!Array.isArray(s.regions) || s.regions.length > 100) fail("VALIDATION", "Regiões de entrega inválidas.");
      s.regions = s.regions.map((r) => {
        const start = text(r.start, "CEP inicial", 8, true).replace(/\D/g, ""), end = text(r.end, "CEP final", 8, true).replace(/\D/g, "");
        if (start.length !== 8 || end.length !== 8 || start > end) fail("VALIDATION", "Faixa de CEP inválida.");
        return { start, end };
      });
      result.shipping = s;
    }
    transaction(db, () => {
      db.prepare("UPDATE settings SET value_json=?,updated_at=? WHERE id=1").run(JSON.stringify(result), now());
      audit(user.id, "SETTINGS_UPDATED", "store", { fields: Object.keys(data) });
    });
    return result;
  }
  function coupon(row) {
    return { id: row.id, code: row.code, type: row.type, value: row.value, minimumCents: row.minimum_cents, startsAt: row.starts_at, endsAt: row.ends_at, maxUses: row.max_uses, usedCount: row.used_count, active: !!row.active, createdAt: row.created_at };
  }
  function saveCoupon(data, user, existing) {
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
    transaction(db, () => {
      if (existing) db.prepare("UPDATE coupons SET code=?,type=?,value=?,minimum_cents=?,starts_at=?,ends_at=?,max_uses=?,active=? WHERE id=?").run(code, type, value, minimum, starts, ends, max, +(data.active !== false), id);
      else db.prepare("INSERT INTO coupons VALUES(?,?,?,?,?,?,?,?,0,?,?)").run(id, code, type, value, minimum, starts, ends, max, +(data.active !== false), now());
      audit(user.id, existing ? "COUPON_UPDATED" : "COUPON_CREATED", id, { code });
    });
    return coupon(db.prepare("SELECT * FROM coupons WHERE id=?").get(id));
  }
  function order(row) {
    return { ...row, subtotalCents: row.subtotal_cents, discountCents: row.discount_cents, shippingCents: row.shipping_cents, totalCents: row.total_cents, paymentStatus: row.payment_status, shippingStatus: row.shipping_status, createdAt: row.created_at, address: JSON.parse(row.address_json), items: db.prepare("SELECT * FROM order_items WHERE order_id=?").all(row.id).map((i) => ({ ...i, unitPriceCents: i.unit_price_cents, totalCents: i.total_cents, variant: JSON.parse(i.variant_json) })) };
  }
  async function handle(req, res, pathname) {
    const respond = (status, data) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      res.end(JSON.stringify(data));
    };
    try {
      origin(req);
      limit(req, "api", 500, 6e4);
      const query = new URL(req.url, "http://localhost").searchParams;
      const method = req.method;
      let session = getSession(req);
      if (method === "GET" && pathname === "/api/session") {
        return respond(200, session ? { user: publicUser(session.user), csrfToken: session.csrf_token } : newSession(res));
      }
      if (method === "GET" && pathname === "/api/config") return respond(200, config());
      if (method === "GET" && pathname === "/api/products") return respond(200, listProducts(query));
      if (method === "GET" && /^\/api\/products\/[^/]+$/.test(pathname)) {
        const slug = pathname.split("/").at(-1), row = db.prepare("SELECT * FROM products WHERE slug=? AND published=1 AND archived=0").get(slug);
        if (!row) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Produto não encontrado.");
        return respond(200, { ...product(row), related: listProducts(new URLSearchParams({ set: row.set_id, pageSize: "5" })).items.filter((p) => p.id !== row.id).slice(0, 4) });
      }
      if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) csrf(req, session);
      if (method === "POST" && ["/api/auth/login", "/api/auth/register"].includes(pathname)) {
        limit(req, "auth", 20);
        const data = await readJson(req);
        const email = text(data.email, "email", 254, true).toLowerCase(), password = typeof data.password === "string" ? data.password : "";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("VALIDATION", "Informe um e-mail válido.");
        if (password.length < 12 || password.length > 128) fail("VALIDATION", "A senha deve ter entre 12 e 128 caracteres.");
        let user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
        if (pathname.endsWith("/register")) {
          if (user) fail("REGISTRATION_UNAVAILABLE", "Não foi possível cadastrar este e-mail. Tente entrar ou contate a loja.");
          const name = text(data.name, "name", 120, true);
          const id = uid();
          db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)").run(id, email, name, await hashPassword(password), "CUSTOMER", now());
          return respond(201, newSession(res, id, session));
        }
        const valid = await verifyPassword(password, user?.password_hash || dummyPassword);
        if (!user || !valid) throw new ApiError(401, "INVALID_CREDENTIALS", "E-mail ou senha incorretos.");
        return respond(200, newSession(res, user.id, session));
      }
      if (method === "POST" && pathname === "/api/auth/logout") {
        if (session) db.prepare("DELETE FROM sessions WHERE token_hash=?").run(session.token_hash);
        return respond(200, newSession(res));
      }
      if (method === "POST" && pathname === "/api/auth/forgot-password") {
        limit(req, "recovery", 5);
        await readJson(req);
        throw new ApiError(503, "RECOVERY_UNAVAILABLE", "Recuperação por e-mail ainda não configurada. Entre em contato com a loja.");
      }
      if (method === "POST" && pathname === "/api/checkout/quote") return respond(200, quote(await readJson(req)));
      if (method === "POST" && pathname === "/api/checkout") {
        auth(session);
        quote(await readJson(req));
        throw new ApiError(503, "PAYMENT_UNAVAILABLE", "Pagamento indisponível. Nenhum pedido ou cobrança foi criado.");
      }
      if (pathname.startsWith("/api/account")) {
        const user = auth(session);
        if (["/api/account/cart", "/api/account/favorites"].includes(pathname) && ["GET", "PUT"].includes(method)) {
          const body = method === "PUT" ? await readJson(req) : null;
          return respond(200, accountList(db, user, pathname, method, body, product));
        }
        if (pathname === "/api/account/profile" && method === "GET") return respond(200, { user: publicUser(user), profile: JSON.parse(user.profile_json) });
        if (pathname === "/api/account/profile" && method === "PUT") {
          const data = await readJson(req);
          const name = text(data.name || user.name, "name", 120, true), profile = { phone: text(data.phone, "phone", 30) };
          db.prepare("UPDATE users SET name=?,profile_json=? WHERE id=?").run(name, JSON.stringify(profile), user.id);
          return respond(200, { user: publicUser({ ...user, name }), profile });
        }
        if (pathname === "/api/account/orders" && method === "GET") return respond(200, { items: db.prepare("SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC LIMIT 100").all(user.id).map(order) });
        if (/^\/api\/account\/orders\/[^/]+$/.test(pathname) && method === "GET") {
          const row = db.prepare("SELECT * FROM orders WHERE id=? AND user_id=?").get(pathname.split("/").at(-1), user.id);
          if (!row) throw new ApiError(404, "ORDER_NOT_FOUND", "Pedido não encontrado.");
          return respond(200, order(row));
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
        if (pathname === "/api/admin/products" && method === "GET") return respond(200, listProducts(query, true));
        if (pathname === "/api/admin/products" && method === "POST") return respond(201, saveProduct(await readJson(req), user.id));
        if (/^\/api\/admin\/products\/[^/]+$/.test(pathname)) {
          const id = pathname.split("/").at(-1), existing = db.prepare("SELECT * FROM products WHERE id=?").get(id);
          if (!existing) throw new ApiError(404, "PRODUCT_NOT_FOUND", "Produto não encontrado.");
          if (method === "GET") return respond(200, product(existing, true));
          if (method === "PUT") return respond(200, saveProduct(await readJson(req), user.id, existing));
          if (method === "DELETE") {
            transaction(db, () => {
              db.prepare("UPDATE products SET archived=1,published=0,updated_at=? WHERE id=?").run(now(), id);
              audit(user.id, "PRODUCT_ARCHIVED", id);
            });
            return respond(200, { archived: true });
          }
        }
        if (pathname === "/api/admin/settings" && method === "GET") return respond(200, settings());
        if (pathname === "/api/admin/settings" && method === "PUT") return respond(200, saveSettings(await readJson(req), user));
        if (pathname === "/api/admin/coupons" && method === "GET") return respond(200, { items: db.prepare("SELECT * FROM coupons ORDER BY created_at DESC").all().map(coupon) });
        if (pathname === "/api/admin/coupons" && method === "POST") return respond(201, saveCoupon(await readJson(req), user));
        if (/^\/api\/admin\/coupons\/[^/]+$/.test(pathname) && method === "PUT") {
          const c = db.prepare("SELECT * FROM coupons WHERE id=?").get(pathname.split("/").at(-1));
          if (!c) throw new ApiError(404, "NOT_FOUND", "Cupom não encontrado.");
          return respond(200, saveCoupon(await readJson(req), user, c));
        }
        if (pathname === "/api/admin/orders" && method === "GET") return respond(200, { items: db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT 200").all().map(order) });
        if (pathname === "/api/admin/summary" && method === "GET") {
          const count = (sql) => db.prepare(sql).get().value;
          return respond(200, { products: count("SELECT COUNT(*) value FROM products WHERE archived=0"), published: count("SELECT COUNT(*) value FROM products WHERE archived=0 AND published=1"), stockUnits: count("SELECT COALESCE(SUM(v.stock),0) value FROM variants v JOIN products p ON p.id=v.product_id WHERE v.active=1 AND p.archived=0"), singles: count("SELECT COUNT(*) value FROM products WHERE archived=0 AND kind='SINGLE'"), sealed: count("SELECT COUNT(*) value FROM products WHERE archived=0 AND kind='SEALED'"), lowStock: count("SELECT COUNT(*) value FROM variants WHERE active=1 AND stock BETWEEN 1 AND 2"), outOfStock: count("SELECT COUNT(*) value FROM variants WHERE active=1 AND stock=0"), orders: count("SELECT COUNT(*) value FROM orders"), pendingOrders: count("SELECT COUNT(*) value FROM orders WHERE payment_status='PENDING'"), paidOrders: count("SELECT COUNT(*) value FROM orders WHERE payment_status='PAID'"), confirmedRevenueCents: count("SELECT COALESCE(SUM(total_cents),0) value FROM orders WHERE payment_status='PAID'") });
        }
        if (pathname === "/api/admin/inventory" && method === "GET") return respond(200, { items: db.prepare("SELECT s.*,p.name FROM stock_movements s JOIN variants v ON v.id=s.variant_id JOIN products p ON p.id=v.product_id ORDER BY s.created_at DESC LIMIT 200").all() });
        if (pathname === "/api/admin/audit" && method === "GET") return respond(200, { items: db.prepare("SELECT * FROM admin_audit ORDER BY created_at DESC LIMIT 200").all() });
        if (pathname === "/api/admin/uploads" && method === "POST") {
          const data = await readJson(req, 12 * 1024 * 1024);
          const match = typeof data.dataUrl === "string" && data.dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/);
          if (!match) fail("INVALID_IMAGE", "Envie uma imagem PNG, JPEG ou WebP.");
          const bytes = Buffer.from(match[2], "base64");
          if (bytes.length < 12 || bytes.length > 8 * 1024 * 1024) fail("INVALID_IMAGE", "A imagem deve ter até 8 MB.");
          const type = match[1], valid = type === "png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : type === "jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
          if (!valid) fail("INVALID_IMAGE", "O conteúdo do arquivo não corresponde ao formato informado.");
          const filename = uid() + "." + (type === "jpeg" ? "jpg" : type);
          await fs.promises.mkdir(path.join(root, "uploads"), { recursive: true });
          await fs.promises.writeFile(path.join(root, "uploads", filename), bytes, { flag: "wx" });
          audit(user.id, "IMAGE_UPLOADED", filename, { size: bytes.length });
          return respond(201, { url: "/uploads/" + filename, kind: "actual" });
        }
      }
      throw new ApiError(404, "NOT_FOUND", "Recurso não encontrado.");
    } catch (error) {
      let status = error.status || 500, code = error.code || "INTERNAL", message = error.message;
      if (String(error.code || "").startsWith("SQLITE_CONSTRAINT") || /UNIQUE constraint failed/.test(error.message)) {
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
  return { handle, close: () => db.close(), db };
}
module.exports = { createApi, ApiError, normalized };
