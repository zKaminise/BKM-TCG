-- Global references are deliberately separate from each user's private valuations.
CREATE TABLE market_quotes(id TEXT PRIMARY KEY,quote_key TEXT NOT NULL UNIQUE,card_id TEXT NOT NULL,set_id TEXT NOT NULL,language TEXT NOT NULL,condition TEXT NOT NULL,variant TEXT NOT NULL,value_cents INTEGER NOT NULL CHECK(value_cents>=0),currency TEXT NOT NULL CHECK(currency='BRL'),source TEXT NOT NULL CHECK(source='admin_manual'),source_label TEXT NOT NULL,source_url TEXT NOT NULL,methodology TEXT NOT NULL CHECK(methodology='manual'),quoted_at TEXT NOT NULL,recorded_at TEXT NOT NULL,publisher_id TEXT NOT NULL REFERENCES users(id),rights_confirmed INTEGER NOT NULL CHECK(rights_confirmed=1));
CREATE INDEX market_quotes_identity ON market_quotes(card_id,set_id,language,condition,variant,quoted_at);
CREATE INDEX market_quotes_history ON market_quotes(recorded_at,id);
CREATE TABLE market_imports(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),token_hash TEXT NOT NULL UNIQUE,rows_json TEXT NOT NULL,errors_json TEXT NOT NULL,expires_at BIGINT NOT NULL,status TEXT NOT NULL CHECK(status IN('PENDING','CONFIRMED')),result_json TEXT,created_at TEXT NOT NULL);
CREATE INDEX market_imports_owner ON market_imports(user_id,expires_at);
-- POSTGRES_RLS
ALTER TABLE market_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_imports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON market_quotes,market_imports FROM PUBLIC;
DO $$ BEGIN
IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON market_quotes,market_imports FROM anon; END IF;
IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON market_quotes,market_imports FROM authenticated; END IF;
END $$;
