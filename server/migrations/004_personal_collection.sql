-- Private collection data is independent of the commercial inventory.
CREATE TABLE IF NOT EXISTS personal_reference_cache(cache_key TEXT PRIMARY KEY,kind TEXT NOT NULL,language TEXT NOT NULL,reference_id TEXT NOT NULL,payload_json TEXT NOT NULL,fetched_at BIGINT NOT NULL,expires_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS personal_collections(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),set_id TEXT NOT NULL,language TEXT NOT NULL,goal_json TEXT NOT NULL,reference_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(user_id,set_id,language));
CREATE INDEX IF NOT EXISTS personal_collections_owner ON personal_collections(user_id,created_at);
CREATE TABLE IF NOT EXISTS personal_lots(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),set_id TEXT NOT NULL,card_id TEXT NOT NULL,language TEXT NOT NULL,condition TEXT NOT NULL,variant TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0 AND quantity<=9999),paid_cents INTEGER CHECK(paid_cents IS NULL OR paid_cents>=0),acquired_at TEXT,notes TEXT NOT NULL DEFAULT '',photo_url TEXT NOT NULL DEFAULT '',metadata_json TEXT NOT NULL,search_text TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS personal_lots_owner ON personal_lots(user_id,set_id,language,card_id);
CREATE INDEX IF NOT EXISTS personal_lots_page ON personal_lots(user_id,updated_at,id);
CREATE TABLE IF NOT EXISTS personal_wishlist(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),set_id TEXT NOT NULL,card_id TEXT NOT NULL,reference_language TEXT NOT NULL,preferences_json TEXT NOT NULL,metadata_json TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(user_id,card_id,reference_language));
CREATE INDEX IF NOT EXISTS personal_wishlist_identity ON personal_wishlist(set_id,card_id,enabled);
CREATE INDEX IF NOT EXISTS personal_wishlist_owner ON personal_wishlist(user_id,created_at,id);
CREATE TABLE IF NOT EXISTS personal_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id),preferences_json TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS personal_prices(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),set_id TEXT NOT NULL,card_id TEXT NOT NULL,language TEXT NOT NULL,condition TEXT NOT NULL,variant TEXT NOT NULL,value_cents INTEGER NOT NULL CHECK(value_cents>=0),currency TEXT NOT NULL CHECK(currency='BRL'),source TEXT NOT NULL,source_label TEXT NOT NULL,source_url TEXT NOT NULL DEFAULT '',methodology TEXT NOT NULL,observations INTEGER,quoted_at TEXT NOT NULL,recorded_at TEXT NOT NULL,coverage TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS personal_prices_identity ON personal_prices(user_id,card_id,language,condition,variant,quoted_at);
CREATE INDEX IF NOT EXISTS personal_prices_history ON personal_prices(user_id,quoted_at,id);
CREATE TABLE IF NOT EXISTS personal_notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),event_key TEXT NOT NULL,kind TEXT NOT NULL,payload_json TEXT NOT NULL,read_at TEXT,created_at TEXT NOT NULL,UNIQUE(user_id,event_key));
CREATE INDEX IF NOT EXISTS personal_notifications_owner ON personal_notifications(user_id,created_at);
CREATE TABLE IF NOT EXISTS personal_imports(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),token_hash TEXT NOT NULL UNIQUE,rows_json TEXT NOT NULL,errors_json TEXT NOT NULL,expires_at BIGINT NOT NULL,status TEXT NOT NULL CHECK(status IN('PENDING','CONFIRMED')),result_json TEXT,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS personal_imports_owner ON personal_imports(user_id,expires_at);
CREATE TABLE IF NOT EXISTS personal_value_snapshots(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),content_hash TEXT NOT NULL,totals_json TEXT NOT NULL,sets_json TEXT NOT NULL,observed_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS personal_value_snapshots_owner ON personal_value_snapshots(user_id,observed_at);

-- POSTGRES_RLS
DO $$
DECLARE item RECORD;
BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN('personal_reference_cache','personal_collections','personal_lots','personal_wishlist','personal_preferences','personal_prices','personal_notifications','personal_imports','personal_value_snapshots')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', item.tablename);
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon',item.tablename); END IF;
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN EXECUTE format('REVOKE ALL ON public.%I FROM authenticated',item.tablename); END IF;
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC',item.tablename);
  END LOOP;
END $$;
