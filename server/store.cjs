const path = require('node:path');
const fs = require('node:fs');
const { AsyncLocalStorage } = require('node:async_hooks');
const { openDatabase, defaultSettings } = require('./db.cjs');

// Business SQL uses positional '?' parameters on both engines. Quoted literals
// remain untouched; PostgreSQL receives native numbered bind parameters.
function postgresSql(sql) {
  let number = 0, quoted = false;
  return sql.replace(/'(?:''|[^'])*'|\?/g, value => value === '?' ? '$' + (++number) : value)
    .replace(/\s+COLLATE NOCASE/gi, '')
    .replace(/ORDER BY rowid/g, 'ORDER BY id');
}
function openStore(options = {}) {
  const env = options.env || process.env;
  const connectionString = options.databaseUrl === undefined ? env.DATABASE_URL : options.databaseUrl;
  const isPostgres = !!connectionString || !!options.pgClient;
  const context = new AsyncLocalStorage();
  let pool, raw, closing, tail = Promise.resolve();
  if (isPostgres) {
    if (options.pgClient) pool = options.pgClient;
    else {
      const { Pool, types } = require('pg');
      types.setTypeParser(20, value => Number(value));
      const poolSize=env.BKM_DB_POOL_SIZE===undefined || env.BKM_DB_POOL_SIZE==='' ? (env.VERCEL ? 1 : 3) : Number(env.BKM_DB_POOL_SIZE);
      if(!Number.isInteger(poolSize) || poolSize<1 || poolSize>10) throw new Error('BKM_DB_POOL_SIZE deve ser um inteiro entre 1 e 10.');
      pool = new Pool({ connectionString, max:poolSize,
        connectionTimeoutMillis: 10000, idleTimeoutMillis: 20000,
        ssl: env.DATABASE_SSL === 'disable' ? false : { rejectUnauthorized: env.DATABASE_SSL_VERIFY !== 'false', ...(env.DATABASE_CA_CERT ? { ca: env.DATABASE_CA_CERT.replace(/\\n/g, '\n') } : {}) } });
    }
  } else raw = openDatabase(options.dbPath || env.BKM_DB_PATH || path.resolve(__dirname, '../data/bkm.sqlite'));
  const store = {
    engine: isPostgres ? 'postgres' : 'sqlite', raw, lockSuffix: isPostgres ? ' FOR UPDATE' : '',
    prepare(sql) {
      return {
        async all(...args) { await store.ready; return isPostgres ? (await (context.getStore()?.client || pool).query(postgresSql(sql), args)).rows : raw.prepare(sql).all(...args); },
        async get(...args) { return (await this.all(...args))[0]; },
        async run(...args) { await store.ready; if (!isPostgres) return raw.prepare(sql).run(...args); const result = await (context.getStore()?.client || pool).query(postgresSql(sql), args); return { changes: result.rowCount ?? result.affectedRows ?? 0 }; }
      };
    },
    async transaction(fn) {
      await store.ready;
      if (context.getStore()?.inTransaction) return fn();
      if (isPostgres) {
        const client = pool.connect ? await pool.connect() : pool;
        try { await client.query('BEGIN'); const result = await context.run({client,inTransaction:true}, fn); await client.query('COMMIT'); return result; }
        catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release?.(); }
      }
      // Node's synchronous SQLite connection must not interleave async transactions.
      return store.exclusive(async () => {
        raw.exec('BEGIN IMMEDIATE');
        try { const result = await context.run({client:raw,inTransaction:true}, fn); raw.exec('COMMIT'); return result; }
        catch (error) { raw.exec('ROLLBACK'); throw error; }
      });
    },
    async exclusive(fn) {
      if (isPostgres || context.getStore()) return fn();
      const previous = tail; let release; tail = new Promise(resolve => { release = resolve; });
      await previous;
      try { return await context.run({client:raw,inTransaction:false}, fn); } finally { release(); }
    },
    close() { return closing ||= (async()=>{ await store.ready; if (isPostgres) await pool.end?.(); else raw.close(); })(); }
  };
  store.ready = isPostgres ? migratePostgres(pool) : Promise.resolve();
  return store;
}
async function migratePostgres(pool) {
  const client = pool.connect ? await pool.connect() : pool;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(164732091)');
    await client.query('CREATE TABLE IF NOT EXISTS bkm_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)');
    const directory = path.join(__dirname, 'migrations');
    for (const file of fs.readdirSync(directory).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
      const version = Number(file.match(/^\d+/)[0]);
      if ((await client.query('SELECT version FROM bkm_migrations WHERE version=$1', [version])).rows.length) continue;
      await client.query(fs.readFileSync(path.join(directory, file), 'utf8'));
      await client.query('INSERT INTO bkm_migrations VALUES($1,$2)', [version, new Date().toISOString()]);
    }
    await client.query('INSERT INTO settings(id,value_json,updated_at) VALUES(1,$1,$2) ON CONFLICT(id) DO NOTHING', [JSON.stringify(defaultSettings), new Date().toISOString()]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release?.(); }
}
module.exports = { openStore, postgresSql, migratePostgres };
