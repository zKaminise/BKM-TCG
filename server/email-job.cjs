const {workerAuthorized,commerceJobSignature,EMAIL_JOB_PATH}=require('./worker-auth.cjs');
const emailJobAuthorized=workerAuthorized;

function createEmailJob({notifications, flushEmails, now = () => Date.now()} = {}) {
  return async function run() {
    const started = now();
    const digests = await notifications.processDigests({limit:5});
    const outbox = {processed:0,sent:0,previewed:0,retried:0,failed:0};
    // Claim one message at a time: a slow provider must not strand a whole batch
    // beyond the function duration. Individual claims/retries remain durable.
    while (outbox.processed < 20 && now() - started < 40000) {
      const batch = await flushEmails({limit:1});
      for (const key of Object.keys(outbox)) outbox[key] += batch[key] || 0;
      if (!batch.processed) break;
    }
    return {ok:true,digests,outbox,bounded:outbox.processed >= 20 || now() - started >= 40000};
  };
}

module.exports = {EMAIL_JOB_PATH,emailJobAuthorized,createEmailJob,commerceJobSignature};
