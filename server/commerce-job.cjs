'use strict';
const {emailJobAuthorized}=require('./email-job.cjs');
const COMMERCE_JOB_PATH='/api/jobs/commerce';
const COMMERCE_JOB_BUDGET_MS=40000;
const counters=()=>({processed:0,sent:0,previewed:0,retried:0,failed:0});
const commerceJobAuthorized=(headers,env,options={})=>emailJobAuthorized(headers,env,{path:COMMERCE_JOB_PATH,...options});

function createCommerceJob({expireOrders,flushEmails,now=()=>Date.now(),budgetMs=COMMERCE_JOB_BUDGET_MS}={}) {
  if(typeof expireOrders!=='function'||typeof flushEmails!=='function'||!Number.isInteger(budgetMs)||budgetMs<5000||budgetMs>COMMERCE_JOB_BUDGET_MS)throw new TypeError('Consumidores e orçamento válidos são obrigatórios.');
  return async function run(){
    const started=now(),deadlineAt=started+budgetMs;
    // Financial operations share one deadline; no work is detached or left
    // running behind a Promise.race after the response. Keep time for outbox
    // claims and final database writes instead of reserving a large batch.
    const expiryDeadline=Math.min(started+25000,deadlineAt-10000);
    const expiry={expired:0,reconciled:0,cancelled:0,pending:0},outbox=counters(),errors=[];
    let batches=0;
    try {
      while(batches<3 && now()<expiryDeadline-1500){
        const batch=await expireOrders({limit:1,deadlineAt:expiryDeadline});batches++;
        for(const key of Object.keys(expiry))expiry[key]+=Number(batch[key])||0;
        if(!Object.values(batch).some(value=>Number(value)>0))break;
        // An inconclusive provider response must wait for a later execution,
        // rather than spend the entire window retrying the same local row.
        if(batch.pending)break;
      }
    }catch{errors.push({phase:'expiry',code:'COMMERCE_EXPIRY_DEFERRED'});}
    try{
      while(outbox.processed<12 && now()<deadlineAt-2000){
        const batch=await flushEmails({limit:1,deadlineAt:deadlineAt-1500});
        for(const key of Object.keys(outbox))outbox[key]+=Number(batch[key])||0;
        if(!batch.processed)break;
      }
    }catch{errors.push({phase:'outbox',code:'COMMERCE_OUTBOX_DEFERRED'});}
    return {ok:errors.length===0,expiry,outbox,errors,durationMs:Math.max(0,now()-started),budgetMs,bounded:batches>=3||outbox.processed>=12||now()>=deadlineAt-2000};
  };
}
module.exports={COMMERCE_JOB_PATH,COMMERCE_JOB_BUDGET_MS,commerceJobAuthorized,createCommerceJob};
