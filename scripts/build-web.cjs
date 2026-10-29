const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });
for (const name of ['index.html', 'styles.css', 'store.css', 'collection.css', 'password-ui.css', 'app.js', 'store.js', 'personal-ui.js', 'collection-ui.js', 'collection-domain.js', 'password-ui.js', 'shipping-ui.js', 'shipping-admin-ui.js', 'shipping-admin.css', 'admin-product-ui.js', 'admin-product.css', 'product-labels.js']) fs.copyFileSync(path.join(root, name), path.join(out, name));
for (const folder of ['assets', 'vendor']) fs.cpSync(path.join(root, folder), path.join(out, folder), { recursive: true });
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
console.log('BKM TCG: frontend completo gerado em dist; API separada, arquivos privados excluídos.');
