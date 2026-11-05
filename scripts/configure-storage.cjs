const path = require('node:path');
const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
require('../server/env.cjs').loadProjectEnvFile(path.resolve(root, args.find(arg=>arg!=='--collection') || '.env'));
const { createStorage } = require('../server/storage.cjs');
const { createCollectionPhotos } = require('../server/collection-photos.cjs');
const collection = createCollectionPhotos({env:process.env}).ensureBucket();
Promise.all(args.includes('--collection') ? [collection] : [createStorage({root}).ensureBucket(),collection])
  .then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
