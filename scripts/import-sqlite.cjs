const fs=require('node:fs');
const path=require('node:path');
const envFile=path.resolve(__dirname,'../.env');
if (require.main === module) require('../server/env.cjs').loadProjectEnvFile(envFile);
const {DatabaseSync}=require('node:sqlite');
const {openStore}=require('../server/store.cjs');
const tables=['users','card_metadata','collections','products','variants','coupons','settings','orders','order_items','inventory_reservations','stock_movements','admin_audit','account_lists','addresses','shipments','payments','payment_events','order_history','email_outbox'];
async function importSqlite({filename,store}={}) {
  if(!filename || !fs.existsSync(filename)) throw new Error('Informe o arquivo SQLite existente: npm run db:import -- "caminho/bkm.sqlite".');
  if(!store && !process.env.DATABASE_URL) throw new Error('Configure DATABASE_URL do projeto PostgreSQL dedicado antes de importar.');
  const target=store || openStore();
  if(target.engine!=='postgres') throw new Error('O destino da migração deve ser PostgreSQL.');
  const source=new DatabaseSync(path.resolve(filename),{readOnly:true});
  try {
    await target.ready;
    const sourceTables=new Set(source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
    return await target.transaction(async()=>{
      for(const table of ['users','products','orders']) if((await target.prepare(`SELECT COUNT(*) count FROM ${table}`).get()).count>0) throw new Error('O destino já contém dados. A importação é permitida somente em banco dedicado vazio, sem sobrescrever registros.');
      const counts={};
      for(const table of tables) {
        if(!sourceTables.has(table)) continue;
        const allowed=new Set((await target.prepare("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=?").all(table)).map(row=>row.column_name));
        const columns=source.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name).filter(name=>allowed.has(name));
        if(!columns.length) continue;
        const rows=source.prepare(`SELECT ${columns.join(',')} FROM ${table}`).all();
        for(const row of rows) {
          if(table==='settings') await target.prepare('UPDATE settings SET value_json=?,updated_at=? WHERE id=1').run(row.value_json,row.updated_at);
          else await target.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(name=>row[name]));
        }
        counts[table]=rows.length;
      }
      return {imported:counts,sessionsInvalidated:true};
    });
  } finally {source.close();if(!store)await target.close();}
}
if(require.main===module) importSqlite({filename:process.argv[2]}).then(result=>console.log(JSON.stringify(result,null,2))).catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={importSqlite};
