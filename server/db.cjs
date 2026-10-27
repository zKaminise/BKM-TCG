const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const defaultSettings = {
  storeName: "BKM TCG",
  contactEmail: "",
  whatsapp: "",
  instagram: "",
  companyName: "",
  cnpj: "",
  heroTitle: "A próxima carta da sua coleção.",
  heroSubtitle: "Pokémon TCG. Cada coleção começa com uma descoberta.",
  about: "",
  shippingPolicy: "",
  returnsPolicy: "",
  privacyPolicy: "",
  terms: "",
  shipping: { enabled: false, flatRateCents: 0, estimatedDays: 0, freeShippingEnabled: false, freeShippingThresholdCents: null, regions: [] }
};
function openDatabase(filename) {
  if (filename !== ":memory:") fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version > 9) {
    db.close();
    throw new Error("Banco criado por uma versão mais recente; atualização recusada.");
  }
  if (version < 1) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT NOT NULL COLLATE NOCASE UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN('CUSTOMER','ADMIN')),profile_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL);
      CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),csrf_token TEXT NOT NULL,expires_at INTEGER NOT NULL,created_at INTEGER NOT NULL);
      CREATE INDEX sessions_expiry ON sessions(expires_at);
      CREATE TABLE card_metadata(id TEXT PRIMARY KEY,identity_key TEXT NOT NULL UNIQUE,tcg TEXT NOT NULL,set_id TEXT NOT NULL,number TEXT NOT NULL,language TEXT NOT NULL,metadata_json TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE products(id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,kind TEXT NOT NULL CHECK(kind IN('SEALED','SINGLE')),name TEXT NOT NULL,description TEXT NOT NULL,sku TEXT NOT NULL UNIQUE,tcg TEXT NOT NULL,set_id TEXT NOT NULL,set_name TEXT NOT NULL,card_id TEXT REFERENCES card_metadata(id),images_json TEXT NOT NULL,attributes_json TEXT NOT NULL DEFAULT '{}',search_text TEXT NOT NULL,featured INTEGER NOT NULL DEFAULT 0,published INTEGER NOT NULL DEFAULT 0,archived INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE INDEX product_catalog ON products(published,archived,kind,set_id,created_at);
      CREATE TABLE variants(id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),language TEXT NOT NULL,condition TEXT NOT NULL,finish TEXT NOT NULL,price_cents INTEGER NOT NULL CHECK(price_cents>0),compare_at_cents INTEGER CHECK(compare_at_cents IS NULL OR compare_at_cents>0),stock INTEGER NOT NULL CHECK(stock>=0),active INTEGER NOT NULL DEFAULT 1,UNIQUE(product_id,language,condition,finish));
      CREATE INDEX variants_product ON variants(product_id,active,stock,price_cents);
      CREATE TABLE coupons(id TEXT PRIMARY KEY,code TEXT NOT NULL COLLATE NOCASE UNIQUE,type TEXT NOT NULL CHECK(type IN('PERCENT','FIXED')),value INTEGER NOT NULL CHECK(value>0),minimum_cents INTEGER NOT NULL DEFAULT 0,starts_at TEXT,ends_at TEXT,max_uses INTEGER,used_count INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL);
      CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1),value_json TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE orders(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL,payment_status TEXT NOT NULL,shipping_status TEXT NOT NULL,currency TEXT NOT NULL DEFAULT 'BRL',subtotal_cents INTEGER NOT NULL,discount_cents INTEGER NOT NULL,shipping_cents INTEGER NOT NULL,total_cents INTEGER NOT NULL,coupon_id TEXT REFERENCES coupons(id),address_json TEXT NOT NULL,payment_provider_id TEXT UNIQUE,idempotency_key TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
      CREATE TABLE order_items(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(id),variant_id TEXT NOT NULL REFERENCES variants(id),name TEXT NOT NULL,sku TEXT NOT NULL,variant_json TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0),unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0),total_cents INTEGER NOT NULL CHECK(total_cents>=0));
      CREATE TABLE inventory_reservations(id TEXT PRIMARY KEY,variant_id TEXT NOT NULL REFERENCES variants(id),order_id TEXT NOT NULL REFERENCES orders(id),quantity INTEGER NOT NULL CHECK(quantity>0),status TEXT NOT NULL CHECK(status IN('ACTIVE','RELEASED','COMMITTED')),expires_at INTEGER NOT NULL,created_at TEXT NOT NULL);
      CREATE INDEX reservation_available ON inventory_reservations(variant_id,status,expires_at);
      CREATE TABLE stock_movements(id TEXT PRIMARY KEY,variant_id TEXT NOT NULL REFERENCES variants(id),actor_id TEXT REFERENCES users(id),delta INTEGER NOT NULL,resulting_stock INTEGER NOT NULL CHECK(resulting_stock>=0),reason TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE admin_audit(id TEXT PRIMARY KEY,actor_id TEXT REFERENCES users(id),action TEXT NOT NULL,entity_id TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL);
      PRAGMA user_version=1;
      COMMIT;`);
  }
  if (version < 2) db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE account_lists(user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL CHECK(kind IN('cart','favorites')),items_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,kind));
    PRAGMA user_version=2; COMMIT;`);
  if (version < 3) {
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(fs.readFileSync(path.join(__dirname, 'migrations/002_commerce.sql'), 'utf8')); db.exec('PRAGMA user_version=3; COMMIT;'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  if (version < 4) {
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(fs.readFileSync(path.join(__dirname, 'migrations/004_personal_collection.sql'), 'utf8').split('-- POSTGRES_RLS')[0]); db.exec('PRAGMA user_version=4; COMMIT;'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  if (version < 5) {
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(fs.readFileSync(path.join(__dirname, 'migrations/005_google_auth.sql'), 'utf8').split('ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;')[0]); db.exec('PRAGMA user_version=5; COMMIT;'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  if (version < 6) {
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(fs.readFileSync(path.join(__dirname, 'migrations/006_email_events.sql'), 'utf8').split('-- PostgreSQL access control')[0]); db.exec('PRAGMA user_version=6; COMMIT;'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  if (version < 7) {
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(fs.readFileSync(path.join(__dirname, 'migrations/007_market_prices.sql'), 'utf8').split('-- POSTGRES_RLS')[0]); db.exec('PRAGMA user_version=7; COMMIT;'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  if (version < 8) {
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(fs.readFileSync(path.join(__dirname, 'migrations/008_wishlist_digests.sql'), 'utf8').split('-- POSTGRES_RLS')[0]); db.exec('PRAGMA user_version=8; COMMIT;'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  if (version < 9) {
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(fs.readFileSync(path.join(__dirname, 'migrations/009_personal_inventory.sql'), 'utf8').split('-- POSTGRES_RLS')[0]); db.exec('PRAGMA user_version=9; COMMIT;'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  db.prepare("INSERT OR IGNORE INTO settings(id,value_json,updated_at) VALUES(1,?,?)").run(JSON.stringify(defaultSettings), (/* @__PURE__ */ new Date()).toISOString());
  return db;
}
module.exports = { openDatabase, defaultSettings };
