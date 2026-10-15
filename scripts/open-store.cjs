const [major,minor]=process.versions.node.split('.').map(Number);
if(major<22||(major===22&&minor<13)){console.error('Instale o Node.js 22.13 ou mais recente.');process.exit(1);}
const {createServer}=require('../serve.cjs');
const {spawn}=require('node:child_process');
const port=Number(process.env.PORT||4173);
if(!Number.isInteger(port)||port<1||port>65535){console.error('PORT inválida.');process.exit(1);}
const server=createServer();
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`A porta ${port} está ocupada. Encerre a prévia anterior ou configure outra PORT.`:error.message);server.api.close();process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>{
  const url=`http://127.0.0.1:${port}`;
  console.log(`BKM TCG: ${url}\nMantenha esta janela aberta. Ctrl+C para encerrar.`);
  if(process.platform==='win32'){
    const browser=spawn('explorer.exe',[url],{stdio:'ignore',windowsHide:true});
    browser.on('error',()=>console.log('Abra o endereço acima no navegador.'));
    browser.unref();
  }
});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
