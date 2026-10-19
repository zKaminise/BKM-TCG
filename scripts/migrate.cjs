const fs=require('node:fs');
const path=require('node:path');
const envFile=path.resolve(__dirname,'../.env');
require('../server/env.cjs').loadProjectEnvFile(envFile);
const {openStore}=require('../server/store.cjs');
(async()=>{
  const store=openStore();
  try { await store.ready;console.log(`Migrations concluídas no motor ${store.engine}. Nenhum produto, usuário ou credencial foi criado.`); }
  finally {await store.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
