ALTER TABLE email_outbox ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE email_outbox ADD COLUMN last_event_at TEXT;
CREATE TABLE email_events(id TEXT PRIMARY KEY,provider_id TEXT NOT NULL,outbox_id TEXT REFERENCES email_outbox(id),event_type TEXT NOT NULL,payload_json TEXT NOT NULL,occurred_at TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX email_events_provider ON email_events(provider_id,occurred_at);
CREATE TABLE email_suppressions(recipient_hash TEXT PRIMARY KEY,reason TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE email_preferences(user_id TEXT PRIMARY KEY REFERENCES users(id),wishlist_enabled INTEGER NOT NULL DEFAULT 0,digest_enabled INTEGER NOT NULL DEFAULT 0,cart_enabled INTEGER NOT NULL DEFAULT 0,news_enabled INTEGER NOT NULL DEFAULT 0,collection_enabled INTEGER NOT NULL DEFAULT 0,price_enabled INTEGER NOT NULL DEFAULT 0,frequency_hours INTEGER NOT NULL DEFAULT 24,consented_at TEXT,source TEXT NOT NULL DEFAULT 'account',updated_at TEXT NOT NULL);
CREATE TABLE email_notification_events(event_key TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),category TEXT NOT NULL,email_id TEXT REFERENCES email_outbox(id),created_at TEXT NOT NULL);
CREATE INDEX email_notification_frequency ON email_notification_events(user_id,category,created_at);
CREATE TABLE email_cart_tracking(user_id TEXT PRIMARY KEY REFERENCES users(id),items_json TEXT NOT NULL,updated_at TEXT NOT NULL,converted_at TEXT);
-- PostgreSQL access control
ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_suppressions ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_notification_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_cart_tracking ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON email_events,email_suppressions,email_preferences,email_notification_events,email_cart_tracking FROM PUBLIC;
DO $$ BEGIN
IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON email_events,email_suppressions,email_preferences,email_notification_events,email_cart_tracking FROM anon; END IF;
IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON email_events,email_suppressions,email_preferences,email_notification_events,email_cart_tracking FROM authenticated; END IF;
END $$;
