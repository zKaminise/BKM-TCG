-- Evolve the existing private inventory; no commercial stock is changed.
ALTER TABLE personal_lots ADD COLUMN kind TEXT NOT NULL DEFAULT 'CARD' CHECK(kind IN('CARD','SEALED','CUSTOM'));
ALTER TABLE personal_lots ADD COLUMN item_type TEXT NOT NULL DEFAULT 'SINGLE' CHECK(item_type IN('SINGLE','BOOSTER','BLISTER','DECK','ETB','BOX','TIN','ACCESSORY','CUSTOM'));
ALTER TABLE personal_lots ADD COLUMN status TEXT NOT NULL DEFAULT 'IN_COLLECTION' CHECK(status IN('IN_COLLECTION','FOR_SALE','SOLD','ARCHIVED'));
ALTER TABLE personal_lots ADD COLUMN reference_language TEXT NOT NULL DEFAULT '';
ALTER TABLE personal_lots ADD COLUMN attributes_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE personal_lots ADD COLUMN manual_value_cents INTEGER CHECK(manual_value_cents IS NULL OR manual_value_cents>=0);
ALTER TABLE personal_lots ADD COLUMN manual_quoted_at TEXT;
ALTER TABLE personal_lots ADD COLUMN manual_identity TEXT NOT NULL DEFAULT '';
ALTER TABLE personal_lots ADD COLUMN sale_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE personal_lots ADD COLUMN archived_at TEXT;
ALTER TABLE personal_lots ADD COLUMN sold_at TEXT;
ALTER TABLE personal_lots ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE personal_lots ADD COLUMN title TEXT NOT NULL DEFAULT '';
ALTER TABLE personal_lots ADD COLUMN set_name TEXT NOT NULL DEFAULT '';
ALTER TABLE personal_lots ADD COLUMN rarity TEXT NOT NULL DEFAULT '';
ALTER TABLE personal_lots ADD COLUMN illustrator TEXT NOT NULL DEFAULT '';
ALTER TABLE personal_lots ADD COLUMN dex_number INTEGER;
ALTER TABLE personal_lots ADD COLUMN number_sort INTEGER;
CREATE INDEX personal_inventory_status ON personal_lots(user_id,status,kind,created_at,id);
CREATE INDEX personal_inventory_filters ON personal_lots(user_id,set_id,language,condition,variant);
CREATE INDEX personal_inventory_cost ON personal_lots(user_id,status,paid_cents,id);
CREATE TABLE personal_inventory_operations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),request_key TEXT NOT NULL,action TEXT NOT NULL,fingerprint TEXT NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,result_json TEXT NOT NULL,undone_at TEXT,created_at TEXT NOT NULL,UNIQUE(user_id,request_key));
CREATE INDEX personal_inventory_operations_owner ON personal_inventory_operations(user_id,created_at,id);
CREATE TABLE personal_item_events(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),lot_id TEXT NOT NULL,operation_id TEXT NOT NULL REFERENCES personal_inventory_operations(id),kind TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX personal_item_events_owner ON personal_item_events(user_id,lot_id,created_at,id);
-- POSTGRES_RLS
ALTER TABLE personal_inventory_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_item_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_lots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON personal_inventory_operations,personal_item_events,personal_lots FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON personal_inventory_operations,personal_item_events,personal_lots FROM anon; END IF;
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON personal_inventory_operations,personal_item_events,personal_lots FROM authenticated; END IF;
END $$;
