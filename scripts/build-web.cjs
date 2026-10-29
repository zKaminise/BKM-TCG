const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });
for (const name of ['index.html', 'styles.css', 'store.css', 'collection.css', 'password-ui.css', 'app.js', 'store.js', 'personal-ui.js', 'collection-ui.js', 'collection-domain.js', 'password-ui.js', 'shipping-ui.js', 'seo-client.js', 'hero-media.js', 'hero-admin-ui.js', 'order-ui.js', 'order-ui.css', 'shipping-admin-ui.js', 'shipping-admin.css', 'admin-product-ui.js', 'admin-product.css', 'product-labels.js']) fs.copyFileSync(path.join(root, name), path.join(out, name));
for (const folder of ['assets', 'vendor']) fs.cpSync(path.join(root, folder), path.join(out, folder), { recursive: true });
// HTML is personalized only with public catalogue data by the SEO handler.
// Keep the animation's current shell available inside the serverless bundle.
fs.writeFileSync(path.join(root,'server','seo-template.html'),fs.readFileSync(path.join(root,'index.html'),'utf8'));
// robots.txt and sitemap.xml are served dynamically by api/index.js. They must
// never be static allow-all files on preview/sandbox deployments.
for(const name of ['robots.txt','sitemap.xml'])if(fs.existsSync(path.join(out,name)))fs.unlinkSync(path.join(out,name));
console.log('BKM TCG: frontend completo gerado em dist; API separada, arquivos privados excluídos.');
