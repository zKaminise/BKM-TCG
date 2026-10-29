const test=require('node:test'),assert=require('node:assert/strict');
const modulePromise=import('../hero-admin-ui.js'),tick=()=>new Promise(resolve=>setImmediate(resolve));
class Element{
 constructor(tag,props={},children=[]){this.tag=tag;this.children=[];this.listeners=new Map();this.value='';this.disabled=false;for(const[key,value]of Object.entries(props)){if(/^on[A-Z]/.test(key))this.addEventListener(key.slice(2).toLowerCase(),value);else this[key]=value;}this.append(...children);}
 append(...children){for(const child of children.flat(Infinity)){this.children.push(child instanceof Element?child:String(child));if(child instanceof Element)child.parentNode=this;}}
 replaceChildren(...children){this.children=[];this.append(...children);}
 get textContent(){return this.children.map(child=>child instanceof Element?child.textContent:child).join(' ');}set textContent(value){this.children=[String(value)];}
 all(){return this.children.flatMap(child=>child instanceof Element?[child,...child.all()]:[]);}
 querySelector(selector){return this.all().find(node=>node.tag===selector)||null;}
 addEventListener(type,handler){if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(handler);}
 async fire(type){for(const handler of this.listeners.get(type)||[])await handler({target:this,currentTarget:this,preventDefault(){}});}
 async click(){if(!this.disabled)await this.fire('click');}
}
const el=(tag,props={},...children)=>new Element(tag,props,children.flat(Infinity).filter(value=>value!==null&&value!==undefined&&value!==false));
async function fixture({imageUrl='',prepareImageUpload=async file=>({name:file.name,dataUrl:'data:image/png;base64,fixture'}),api=async()=>({url:'/uploads/new-pack.webp'})}={}){
 const calls=[],prepared=[],{createHeroMediaEditor}=await modulePromise;
 const ctx={el,field:(label,name,type,value,extra={})=>el('label',{},label,el('input',{name,type,value,...extra})),button:(label,onClick,cls)=>el('button',{type:'button',class:cls,onClick},label),image:(src,alt)=>el('img',{src,alt}),message:(text,kind)=>el('p',{role:kind==='error'?'alert':'status'},text),prepareImageUpload:async file=>{prepared.push(file);return await prepareImageUpload(file);},api:async(route,options)=>{calls.push({route,...options});return await api(route,options);}};
 const editor=createHeroMediaEditor(ctx,{imageUrl}),screen=editor.element,input=screen.all().find(node=>node.tag==='input'&&node.name==='heroPackImageUrl'),upload=screen.all().find(node=>node.tag==='input'&&node.type==='file'),restore=screen.all().find(node=>node.tag==='button'),preview=()=>screen.all().find(node=>node.tag==='img');
 return {...editor,screen,input,upload,restore,preview,calls,prepared};
}
test('hero editor previews links and defaults, preserves empty-default setting and rejects unsafe paths before saving',async()=>{
 const {validateHeroPackImageUrl}=await modulePromise,{DEFAULT_HERO_PACK_IMAGE}=await import('../hero-media.js'),f=await fixture();
 assert.equal(f.read(),'');assert.equal(f.preview().src,DEFAULT_HERO_PACK_IMAGE);assert.equal(f.calls.length,0);
 f.input.value=' HTTPS://Images.Example.test/pack.webp?v=2 ';await f.input.fire('change');assert.equal(f.read(),'https://images.example.test/pack.webp?v=2');assert.equal(f.preview().src,f.read());
 for(const value of['javascript:alert(1)','data:image/png;base64,anything','http://example.test/a.png','https:example.test/a.png','https:///example.test/a.png','https://user:password@example.test/a.png','/uploads/%2e%2e/private.png','https://example.test/%2e%2e/private.png','https://example.test/a%5cb.png','https://example.test/a%00.png','https://example.test/a.png#fragment','/uploads/a%20b.png'])assert.throws(()=>validateHeroPackImageUrl(value),/imagem enviada|endereço/);
 f.input.value='/uploads/%2e%2e/private.png';await f.input.fire('change');assert.throws(()=>f.read(),/imagem enviada/);assert.equal(f.preview().src,'https://images.example.test/pack.webp?v=2');assert.equal(f.screen.all().some(node=>node.role==='alert'),true);
 await f.restore.click();assert.equal(f.read(),DEFAULT_HERO_PACK_IMAGE);assert.equal(f.preview().src,DEFAULT_HERO_PACK_IMAGE);assert.match(f.screen.textContent,/Salve as configurações/);assert.equal(f.calls.length,0);f.destroy();
});
test('hero upload blocks saving throughout image preparation and transport, then adopts only the saved image URL',async()=>{
 let releasePrepared,releaseUpload;const original='/uploads/current-pack.png',f=await fixture({imageUrl:original,prepareImageUpload:async()=>await new Promise(resolve=>releasePrepared=resolve),api:async()=>await new Promise(resolve=>releaseUpload=resolve)});
 f.upload.files=[{name:'pacote.png',type:'image/png',size:2500}];const sending=f.upload.fire('change');await tick();
 assert.throws(()=>f.read(),/Aguarde o envio/);assert.equal(f.input.disabled,true);assert.equal(f.upload.disabled,true);assert.equal(f.restore.disabled,true);assert.equal(f.preview().src,original);assert.equal(f.calls.length,0);
 const payload={name:'pacote.webp',dataUrl:'data:image/webp;base64,fixture'};releasePrepared(payload);await tick();assert.equal(f.calls[0].route,'/admin/uploads');assert.equal(f.calls[0].method,'POST');assert.deepEqual(f.calls[0].body,payload);assert.throws(()=>f.read(),/Aguarde o envio/);
 releaseUpload({url:'/uploads/pack-saved.webp'});await sending;assert.equal(f.read(),'/uploads/pack-saved.webp');assert.equal(f.preview().src,'/uploads/pack-saved.webp');assert.equal(f.input.disabled,false);assert.equal(f.restore.disabled,false);assert.equal(f.upload.disabled,false);assert.equal(f.upload.value,'');assert.match(f.screen.textContent,/Imagem enviada. Salve/);assert.equal(f.calls.length,1,'only uploads an asset; settings require their own explicit save');f.destroy();
});
test('hero upload rejects unsupported/oversized files and preserves existing image after storage or validation failure',async()=>{
 for(const file of[{name:'unsafe.svg',type:'image/svg+xml',size:100},{name:'large.png',type:'image/png',size:8*1024*1024+1}]){const f=await fixture({imageUrl:'/uploads/current.webp'});f.upload.files=[file];await f.upload.fire('change');assert.equal(f.prepared.length,0);assert.equal(f.calls.length,0);assert.equal(f.read(),'/uploads/current.webp');assert.equal(f.preview().src,'/uploads/current.webp');assert.equal(f.screen.all().some(node=>node.role==='alert'),true);f.destroy();}
 for(const api of[async()=>{throw Error('Armazenamento temporariamente indisponível');},async()=>({url:'javascript:alert(1)'})]){const f=await fixture({imageUrl:'/uploads/current.webp',api});f.upload.files=[{name:'pack.webp',type:'image/webp',size:900}];await f.upload.fire('change');assert.equal(f.read(),'/uploads/current.webp');assert.equal(f.preview().src,'/uploads/current.webp');assert.equal(f.upload.disabled,false);assert.equal(f.input.disabled,false);assert.equal(f.screen.all().some(node=>node.role==='alert'),true);f.destroy();}
});
test('leaving the settings page aborts the upload and ignores late storage responses',async()=>{
 let release;const f=await fixture({imageUrl:'/uploads/original.webp',api:async()=>await new Promise(resolve=>release=resolve)});f.upload.files=[{name:'pack.jpg',type:'image/jpeg',size:1000}];const sending=f.upload.fire('change');await tick();assert.equal(f.calls.length,1);f.destroy();assert.equal(f.calls[0].signal.aborted,true);release({url:'/uploads/late.webp'});await sending;assert.equal(f.preview().src,'/uploads/original.webp');assert.equal(f.input.value,'/uploads/original.webp');assert.doesNotMatch(f.screen.textContent,/Imagem enviada\./);
});
