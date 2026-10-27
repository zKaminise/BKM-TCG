'use strict';
const fs=require('node:fs');
const path=require('node:path');
function proCronConfig(current){
  if(!current||typeof current!=='object'||Array.isArray(current))throw new Error('Configuração Vercel inválida.');
  return {...current,crons:[...(Array.isArray(current.crons)?current.crons:[]).filter(item=>item.path!=='/api/jobs/commerce'),{path:'/api/jobs/commerce',schedule:'* * * * *'}]};
}
function main(args=process.argv.slice(2),root=path.resolve(__dirname,'..')){
  if(!args.includes('--confirm-pro-plan'))throw new Error('Primeiro confirme o plano Pro no painel. Depois use --confirm-pro-plan --output vercel.pro.generated.json. Nenhum arquivo foi alterado.');
  const index=args.indexOf('--output');
  if(index<0||!args[index+1]||args[index+1].startsWith('--'))throw new Error('Informe --output para gerar uma configuração separada e revisável.');
  const source=path.join(root,'vercel.json'),output=path.resolve(root,args[index+1]);
  if(output.toLowerCase()===source.toLowerCase())throw new Error('A configuração ativa não pode ser sobrescrita por este comando. Gere um arquivo separado.');
  const current=JSON.parse(fs.readFileSync(source,'utf8'));
  fs.writeFileSync(output,JSON.stringify(proCronConfig(current),null,2)+'\n',{flag:'wx'});
  return output;
}
if(require.main===module){try{console.log('Configuração Pro gerada para revisão: '+main());console.log('Não houve alteração do vercel.json ativo nem deployment.');}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={proCronConfig,main};
