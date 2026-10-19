const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
require('../server/env.cjs').loadProjectEnvFile(path.join(root, '.env'));
const { createStorage } = require('../server/storage.cjs');
createStorage({root}).ensureBucket().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
