CREATE TABLE email_wishlist_digest_events(
  event_key TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  wishlist_ids_json TEXT NOT NULL,
  item_json TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  due_at BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','QUEUED','DISCARDED')),
  email_id TEXT REFERENCES email_outbox(id),
  processed_at BIGINT
);
CREATE INDEX email_wishlist_digest_due ON email_wishlist_digest_events(status,due_at,user_id);
CREATE INDEX email_wishlist_digest_owner ON email_wishlist_digest_events(user_id,status,created_at);
CREATE INDEX email_wishlist_digest_source ON email_wishlist_digest_events(source_key);
-- POSTGRES_RLS
ALTER TABLE email_wishlist_digest_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON email_wishlist_digest_events FROM PUBLIC;
DO $$ BEGIN
IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON email_wishlist_digest_events FROM anon; END IF;
IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON email_wishlist_digest_events FROM authenticated; END IF;
END $$;
