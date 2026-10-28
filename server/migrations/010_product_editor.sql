-- Product editor: durable identities and fallback grants. No stock is created.
CREATE TABLE product_sequences(id INTEGER PRIMARY KEY CHECK(id=1),next_number INTEGER NOT NULL CHECK(next_number>0));
CREATE TABLE variant_metadata(variant_id TEXT PRIMARY KEY REFERENCES variants(id),product_id TEXT NOT NULL REFERENCES products(id),identity_key TEXT NOT NULL,attributes_json TEXT NOT NULL DEFAULT '[]',active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)));
CREATE UNIQUE INDEX variant_active_identity ON variant_metadata(product_id,identity_key) WHERE active=1;
INSERT INTO variant_metadata(variant_id,product_id,identity_key,attributes_json,active) SELECT id,product_id,language||'|'||condition||'|'||finish||'|[]','[]',active FROM variants;
CREATE TABLE admin_catalog_fallbacks(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),session_hash TEXT NOT NULL,query TEXT NOT NULL,language TEXT NOT NULL,set_id TEXT NOT NULL DEFAULT '',reason TEXT NOT NULL CHECK(reason IN('not_found','unavailable')),expires_at BIGINT NOT NULL,used_at TEXT,created_at TEXT NOT NULL);
CREATE INDEX admin_catalog_fallback_owner ON admin_catalog_fallbacks(user_id,expires_at);
-- POSTGRES_ONLY
ALTER TABLE products DROP CONSTRAINT products_kind_check;
ALTER TABLE products ADD CONSTRAINT products_kind_check CHECK(kind IN('SEALED','SINGLE','CUSTOM'));
ALTER TABLE variants DROP CONSTRAINT variants_product_id_language_condition_finish_key;
ALTER TABLE product_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE variant_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_catalog_fallbacks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON product_sequences,variant_metadata,admin_catalog_fallbacks FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON product_sequences,variant_metadata,admin_catalog_fallbacks FROM anon; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON product_sequences,variant_metadata,admin_catalog_fallbacks FROM authenticated; END IF;
END $$;
