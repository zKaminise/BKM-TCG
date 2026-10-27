'use strict';
const crypto=require('node:crypto');
const COMMERCE_JOB_PATH='/api/jobs/commerce';
const EMAIL_JOB_PATH='/api/jobs/email';
const SIGNATURE_WINDOW_MS=90000;

function commerceJobSignature(secret,timestamp){
  return crypto.createHmac('sha256',secret).update('bkm-commerce-job:v1\n'+timestamp+'\nGET\n'+COMMERCE_JOB_PATH).digest('hex');
}

function workerAuthorized(headers={},env=process.env,{path=EMAIL_JOB_PATH,method='GET',now=Date.now()}={}){
  const secret=env?.CRON_SECRET;
  if(!headers || typeof headers!=='object' || typeof secret!=='string' || !/^[A-Za-z0-9_-]{32,256}$/.test(secret))return false;
  if(![EMAIL_JOB_PATH,COMMERCE_JOB_PATH].includes(path))return false;
  // Vercel's daily job retains the existing Bearer contract. Supabase's queued
  // HTTP request carries only a short-lived MAC, never this reusable secret.
  const authorization=headers.authorization;
  if(typeof authorization==='string'&&authorization.length<=300){
    const received=crypto.createHash('sha256').update(authorization).digest();
    const expected=crypto.createHash('sha256').update('Bearer '+secret).digest();
    if(crypto.timingSafeEqual(received,expected))return true;
  }
  if(path!==COMMERCE_JOB_PATH || method!=='GET' || !Number.isFinite(now))return false;
  const timestamp=headers['x-bkm-job-timestamp'],signature=headers['x-bkm-job-signature'];
  if(typeof timestamp!=='string'||!/^\d{10}$/.test(timestamp)||typeof signature!=='string'||!/^[a-f0-9]{64}$/.test(signature)||Math.abs(now-Number(timestamp)*1000)>SIGNATURE_WINDOW_MS)return false;
  return crypto.timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(commerceJobSignature(secret,timestamp),'hex'));
}

module.exports={workerAuthorized,commerceJobSignature,SIGNATURE_WINDOW_MS,COMMERCE_JOB_PATH,EMAIL_JOB_PATH};
