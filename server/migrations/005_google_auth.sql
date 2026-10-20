CREATE TABLE oauth_states(state_hash TEXT PRIMARY KEY,session_hash TEXT NOT NULL,user_id TEXT REFERENCES users(id),mode TEXT NOT NULL CHECK(mode IN('login','link')),nonce_hash TEXT NOT NULL,code_verifier TEXT NOT NULL,return_to TEXT NOT NULL,expires_at BIGINT NOT NULL,used_at TEXT,created_at TEXT NOT NULL);
CREATE INDEX oauth_states_expiry ON oauth_states(expires_at);
CREATE TABLE oauth_identities(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),provider TEXT NOT NULL CHECK(provider='google'),subject TEXT NOT NULL,email TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(provider,subject),UNIQUE(user_id,provider));
ALTER TABLE oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_identities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON oauth_states,oauth_identities FROM PUBLIC;
DO $$ BEGIN
IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON oauth_states,oauth_identities FROM anon; END IF;
IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON oauth_states,oauth_identities FROM authenticated; END IF;
END $$;
