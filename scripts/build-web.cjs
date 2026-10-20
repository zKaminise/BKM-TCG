const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });
for (const name of ['index.html', 'styles.css', 'store.css', 'app.js', 'store.js', 'personal-ui.js']) fs.copyFileSync(path.join(root, name), path.join(out, name));
for (const folder of ['assets', 'vendor']) fs.cpSync(path.join(root, folder), path.join(out, folder), { recursive: true });
fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
console.log('BKM TCG: frontend completo gerado em dist; API separada, arquivos privados excluídos.');
