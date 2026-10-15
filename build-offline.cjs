// Rebuild ABRIR.html from the editable source. Requires the esbuild dev dependency.
const fs=require('node:fs');
const path=require('node:path');
const esbuild=require(process.env.TCG_ESBUILD_PATH||'esbuild');
const root=__dirname;
const mime={'.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};
const assets={};
for(const name of fs.readdirSync(path.join(root,'assets'))){
  const ext=path.extname(name);if(mime[ext])assets['assets/'+name]=`data:${mime[ext]};base64,${fs.readFileSync(path.join(root,'assets',name)).toString('base64')}`;
}
const source=fs.readFileSync(path.join(root,'app.js'),'utf8').replace(/(['"])(\/?assets\/[^'"]+)\1/g,(match,q,p)=>assets[p.replace(/^\//,'')]?JSON.stringify(assets[p.replace(/^\//,'')]):match);
esbuild.build({stdin:{contents:source,resolveDir:root,sourcefile:'app.js'},bundle:true,minify:true,format:'iife',platform:'browser',target:['es2022'],legalComments:'inline',write:false}).then(result=>{
  let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  // Commerce needs a server and a database. This export contains the presentation
  // only, so opening a local file never suggests a working offline checkout.
  html=html.replace(/<link[^>]*data-commerce[^>]*>/g,'').replace(/<script[^>]*data-commerce[^>]*><\/script>/g,'').replace(/<(div|section)[^>]*data-commerce[^>]*><\/\1>/g,'');
  html=html.replace('<link rel="stylesheet" href="/styles.css">',()=>`<style>${fs.readFileSync(path.join(root,'styles.css'),'utf8')}</style>`);
  html=html.replace('<script type="module" src="/app.js"></script>',()=>`<script>${result.outputFiles[0].text.replaceAll('</script','<\\/script')}</script>`);
  html=html.replace(/(src|href)="(\/?assets\/[^\"]+)"/g,(match,attr,p)=>assets[p.replace(/^\//,'')]?`${attr}="${assets[p.replace(/^\//,'')]}"`:match);
  html=html.replaceAll('href="/"','href="#inicio"');
  fs.writeFileSync(path.join(root,'ABRIR.html'),html);
  console.log(`ABRIR.html: ${(Buffer.byteLength(html)/1024/1024).toFixed(2)} MB; código, imagens e estilos incorporados.`);
}).catch(e=>{console.error(e);process.exitCode=1;});
