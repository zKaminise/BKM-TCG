'use strict';
const crypto=require('node:crypto');
const JOB_NAME='bkm-commerce-worker-minute';
const COMMAND='SELECT bkm_ops.invoke_commerce_worker();';
const SECRET_NAME='bkm_commerce_cron_secret';
const URL_NAME='bkm_commerce_worker_url';
const FUNCTION_SQL=`CREATE OR REPLACE FUNCTION bkm_ops.invoke_commerce_worker() RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $bkm_worker$
DECLARE endpoint text; signing_key text; timestamp text; signature text; canonical text; request_id bigint;
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(884271363) THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM bkm_ops.commerce_worker_requests WHERE created_at > pg_catalog.now()-interval '50 seconds') THEN RETURN NULL; END IF;
  SELECT decrypted_secret INTO endpoint FROM vault.decrypted_secrets WHERE name='bkm_commerce_worker_url';
  SELECT decrypted_secret INTO signing_key FROM vault.decrypted_secrets WHERE name='bkm_commerce_cron_secret';
  IF endpoint IS NULL OR endpoint !~ '^https://[a-z0-9.-]+/api/jobs/commerce$' OR signing_key IS NULL OR pg_catalog.length(signing_key) NOT BETWEEN 32 AND 256 OR signing_key !~ '^[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'Commerce worker configuration unavailable';
  END IF;
  timestamp := pg_catalog.floor(extract(epoch FROM pg_catalog.clock_timestamp()))::bigint::text;
  canonical := 'bkm-commerce-job:v1' || E'\\n' || timestamp || E'\\nGET\\n/api/jobs/commerce';
  signature := pg_catalog.encode(extensions.hmac(canonical,signing_key,'sha256'),'hex');
  request_id := net.http_get(url := endpoint, headers := pg_catalog.jsonb_build_object('x-bkm-job-timestamp',timestamp,'x-bkm-job-signature',signature), timeout_milliseconds := 45000);
  INSERT INTO bkm_ops.commerce_worker_requests(request_id) VALUES(request_id);
  DELETE FROM bkm_ops.commerce_worker_requests WHERE created_at < pg_catalog.now()-interval '2 days';
  RETURN request_id;
END;
$bkm_worker$`;

function validateConfiguration(env,{needSecret=false}={}){
  const source=env.DATABASE_URL;
  let database,project,publicUrl;
  try{database=new URL(source);project=new URL(env.SUPABASE_URL);}catch{throw new Error('Configure DATABASE_URL e SUPABASE_URL do projeto pretendido no ambiente privado.');}
  const ref=project.hostname.match(/^([a-z]{20})\.supabase\.co$/)?.[1];
  const user=decodeURIComponent(database.username);
  if(!ref||!['postgres:','postgresql:'].includes(database.protocol)||!database.password||!(database.hostname===`db.${ref}.supabase.co`||database.hostname.endsWith('.pooler.supabase.com')&&user===`postgres.${ref}`))throw new Error('A conexão não corresponde ao projeto Supabase informado.');
  if(needSecret){
    if(!/^[A-Za-z0-9_-]{32,256}$/.test(env.CRON_SECRET||''))throw new Error('Configure CRON_SECRET privado com 32–256 caracteres base64url.');
    try{publicUrl=new URL(env.BKM_PUBLIC_URL);}catch{throw new Error('Configure a URL canônica HTTPS da loja.');}
    if(publicUrl.protocol!=='https:'||publicUrl.port||publicUrl.username||publicUrl.password||publicUrl.search||publicUrl.hash||publicUrl.pathname!=='/'||!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(publicUrl.hostname)||publicUrl.hostname.endsWith('.vercel.app'))throw new Error('Use o domínio canônico HTTPS, sem porta, caminho, usuário ou parâmetros.');
  }
  return {connectionString:source,endpoint:publicUrl?publicUrl.origin+'/api/jobs/commerce':null};
}
async function inspect(client){
  await client.query('BEGIN READ ONLY');
  try{
    const extensions=(await client.query("SELECT a.name,a.default_version,a.installed_version,n.nspname schema FROM pg_available_extensions a LEFT JOIN pg_extension e ON e.extname=a.name LEFT JOIN pg_namespace n ON n.oid=e.extnamespace WHERE a.name IN('pg_cron','pg_net','supabase_vault','pgcrypto') ORDER BY a.name")).rows;
    const capability=(await client.query("SELECT has_database_privilege(current_user,current_database(),'CREATE') create_extension, to_regnamespace('cron') IS NOT NULL cron_schema, to_regnamespace('net') IS NOT NULL net_schema, to_regnamespace('vault') IS NOT NULL vault_schema, to_regclass('bkm_ops.commerce_worker_requests') IS NOT NULL worker_log" )).rows[0];
    const functions=(await client.query("SELECT n.nspname schema,p.proname name,p.oid::regprocedure::text signature,has_function_privilege(current_user,p.oid,'EXECUTE') allowed FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='cron' AND p.proname IN('schedule','unschedule')) OR (n.nspname='net' AND p.proname='http_get') OR (n.nspname='vault' AND p.proname IN('create_secret','update_secret')) OR (n.nspname='extensions' AND p.proname='hmac') ORDER BY n.nspname,p.proname")).rows;
    let jobs=[],runs=[],requests=[],queueAccess=[];
    if(capability.cron_schema){jobs=(await client.query('SELECT jobid,jobname,schedule,active FROM cron.job WHERE jobname=$1',[JOB_NAME])).rows;runs=(await client.query('SELECT d.status,d.start_time,d.end_time FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid WHERE j.jobname=$1 ORDER BY d.start_time DESC LIMIT 10',[JOB_NAME])).rows;}
    if(capability.net_schema){queueAccess=(await client.query("SELECT r.rolname role,r.rolcanlogin can_login,has_schema_privilege(r.rolname,'net','USAGE') schema_usage,CASE WHEN to_regclass('net.http_request_queue') IS NOT NULL THEN has_table_privilege(r.rolname,'net.http_request_queue','SELECT') ELSE false END queue_read FROM pg_roles r WHERE r.rolname IN('anon','authenticated','service_role','postgres') ORDER BY r.rolname")).rows;}
    const vaultAccess=capability.vault_schema?(await client.query("SELECT r.rolname role,has_schema_privilege(r.rolname,'vault','USAGE') schema_usage,CASE WHEN to_regclass('vault.decrypted_secrets') IS NOT NULL THEN has_table_privilege(r.rolname,'vault.decrypted_secrets','SELECT') ELSE false END secrets_read FROM pg_roles r WHERE r.rolname IN('anon','authenticated') ORDER BY r.rolname")).rows:[];
    if(capability.worker_log&&capability.net_schema)requests=(await client.query('SELECT r.created_at,h.status_code,COALESCE(h.timed_out,false) timed_out,(h.error_msg IS NOT NULL) has_error FROM bkm_ops.commerce_worker_requests r LEFT JOIN net._http_response h ON h.id=r.request_id ORDER BY r.created_at DESC LIMIT 10')).rows;
    return {readOnly:true,projectVerified:true,extensions,capability,functions,jobs,runs,requests,queueAccess,vaultAccess};
  }finally{await client.query('ROLLBACK');}
}
function review(){return {jobName:JOB_NAME,schedule:'* * * * *',command:COMMAND,functionSqlSha256:crypto.createHash('sha256').update(FUNCTION_SQL).digest('hex'),secretSources:['CRON_SECRET','BKM_PUBLIC_URL'],secretStorage:'Supabase Vault; parameterized bindings only; key never sent over pg_net',authentication:'HMAC-SHA256 route-bound GET; epoch seconds; 90-second freshness',changes:['enable pg_cron/pg_net if explicitly requested; Vault/pgcrypto extensions.hmac must already exist','upsert the two dedicated Vault entries','create postgres-only SECURITY DEFINER function and bounded request log','schedule one minute HTTP GET with 45 second transport timeout'],noDeployment:true,noPaymentRequest:true,requiresReviewedSignatureDeployment:true};}
async function apply(client,env,{approved=false,signatureDeploymentVerified=false,enableExtensions=false}={}){
  if(!approved||!signatureDeploymentVerified)throw new Error('Revisão explícita e confirmação de deployment HMAC validado são obrigatórios.');
  const configuration=validateConfiguration(env,{needSecret:true});
  await client.query('BEGIN');
  try{
    await client.query('SELECT pg_advisory_xact_lock(884271364)');
    if((await client.query('SELECT current_user name')).rows[0]?.name!=='postgres')throw new Error('A instalação exige o proprietário postgres do projeto.');
    const cryptography=(await client.query("SELECT n.nspname schema,to_regprocedure('extensions.hmac(text,text,text)') IS NOT NULL available FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pgcrypto'")).rows[0];
    if(!cryptography?.available||cryptography.schema!=='extensions')throw new Error('Revise pgcrypto e a função extensions.hmac(text,text,text) antes de instalar.');
    let extensions=(await client.query("SELECT extname FROM pg_extension WHERE extname IN('pg_cron','pg_net','supabase_vault')")).rows.map(row=>row.extname);
    if(!extensions.includes('supabase_vault'))throw new Error('Ative e revise o Supabase Vault antes de instalar o scheduler.');
    for(const name of ['pg_cron','pg_net'])if(!extensions.includes(name)){if(!enableExtensions)throw new Error('Extensões ausentes; revise a inspeção antes de permitir sua ativação.');await client.query(name==='pg_cron'?'CREATE EXTENSION IF NOT EXISTS pg_cron':'CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions');}
    const vaultAccess=(await client.query("SELECT r.rolname role,has_schema_privilege(r.rolname,'vault','USAGE') schema_usage,CASE WHEN to_regclass('vault.decrypted_secrets') IS NOT NULL THEN has_table_privilege(r.rolname,'vault.decrypted_secrets','SELECT') ELSE false END secrets_read FROM pg_roles r WHERE r.rolname IN('anon','authenticated') ORDER BY r.rolname")).rows;
    if(vaultAccess.some(role=>role.schema_usage&&role.secrets_read))throw new Error('Revise os privilégios públicos existentes no Vault antes de armazenar a chave do worker.');
    const existingSchema=(await client.query("SELECT pg_get_userbyid(nspowner) owner FROM pg_namespace WHERE nspname='bkm_ops'")).rows;
    const existingTable=(await client.query("SELECT pg_get_userbyid(c.relowner) owner,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='bkm_ops' AND c.relname='commerce_worker_requests'")).rows;
    const existingFunction=(await client.query("SELECT pg_get_userbyid(proowner) owner FROM pg_proc WHERE oid=to_regprocedure('bkm_ops.invoke_commerce_worker()')")).rows;
    if(existingSchema.some(row=>row.owner!=='postgres')||existingTable.some(row=>row.owner!=='postgres'||row.relkind!=='r')||existingFunction.some(row=>row.owner!=='postgres'))throw new Error('Os objetos operacionais existentes exigem revisão de propriedade. Nenhum objeto será substituído.');
    const previous=(await client.query('SELECT command,username FROM cron.job WHERE jobname=$1',[JOB_NAME])).rows;
    if(previous.length>1||previous.some(job=>job.command!==COMMAND||job.username!=='postgres'))throw new Error('O nome do job já pertence a uma configuração diferente. Nenhum job será substituído.');
    for(const [name,value]of [[SECRET_NAME,env.CRON_SECRET],[URL_NAME,configuration.endpoint]]){const existing=(await client.query('SELECT id FROM vault.secrets WHERE name=$1',[name])).rows;if(existing.length>1)throw new Error('Há entradas Vault duplicadas; revise manualmente.');if(existing.length)await client.query('SELECT vault.update_secret($1,$2,$3,$4)',[existing[0].id,value,name,'BKM operational worker configuration']);else await client.query('SELECT vault.create_secret($1,$2,$3)',[value,name,'BKM operational worker configuration']);}
    await client.query('CREATE SCHEMA IF NOT EXISTS bkm_ops');
    await client.query('REVOKE ALL ON SCHEMA bkm_ops FROM PUBLIC,anon,authenticated,service_role');
    await client.query('CREATE TABLE IF NOT EXISTS bkm_ops.commerce_worker_requests(request_id bigint PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now())');
    await client.query('ALTER TABLE bkm_ops.commerce_worker_requests ENABLE ROW LEVEL SECURITY');
    await client.query('REVOKE ALL ON TABLE bkm_ops.commerce_worker_requests FROM PUBLIC,anon,authenticated,service_role');
    await client.query(FUNCTION_SQL);
    await client.query('ALTER FUNCTION bkm_ops.invoke_commerce_worker() OWNER TO postgres');
    await client.query('REVOKE ALL ON FUNCTION bkm_ops.invoke_commerce_worker() FROM PUBLIC,anon,authenticated,service_role');
    await client.query('GRANT EXECUTE ON FUNCTION bkm_ops.invoke_commerce_worker() TO postgres');
    const scheduled=(await client.query('SELECT cron.schedule($1,$2,$3) job_id',[JOB_NAME,'* * * * *',COMMAND])).rows[0];
    await client.query('COMMIT');
    return {scheduled:true,jobId:scheduled.job_id,jobName:JOB_NAME,firstRequest:'next scheduled minute',secretsPrinted:false};
  }catch(error){await client.query('ROLLBACK');throw error;}
}
async function main(args=process.argv.slice(2),env=process.env){
  if(args.includes('--review')){console.log(JSON.stringify(review(),null,2));return;}
  if(!args.includes('--inspect')&&!args.includes('--apply'))throw new Error('Use --review, --inspect ou --apply com confirmação explícita.');
  if(args.includes('--inspect')&&args.includes('--apply'))throw new Error('Inspeção e instalação devem ser executadas separadamente.');
  const configuration=validateConfiguration(env,{needSecret:args.includes('--apply')});
  if(args.includes('--apply')&&(!args.includes('--confirm-reviewed-scheduler')||!args.includes('--confirm-signature-deployment')))throw new Error('Revise primeiro e valide o endpoint HMAC publicado antes de instalar.');
  const {Client}=require('pg');const client=new Client({connectionString:configuration.connectionString,connectionTimeoutMillis:10000,query_timeout:10000,statement_timeout:10000,application_name:'bkm-commerce-cron-review',ssl:env.DATABASE_SSL==='disable'?false:{rejectUnauthorized:env.DATABASE_SSL_VERIFY!=='false',...(env.DATABASE_CA_CERT?{ca:env.DATABASE_CA_CERT.replace(/\\n/g,'\n')}:{})}});
  try{await client.connect();console.log(JSON.stringify(args.includes('--inspect')?await inspect(client):await apply(client,env,{approved:true,signatureDeploymentVerified:true,enableExtensions:args.includes('--enable-extensions')}),null,2));}finally{await client.end();}
}
if(require.main===module)main().catch(()=>{console.error('Não foi possível concluir a inspeção/configuração. Nenhum detalhe de conexão ou segredo foi exibido.');process.exitCode=1;});
module.exports={validateConfiguration,inspect,review,apply,main,FUNCTION_SQL,JOB_NAME,COMMAND};
