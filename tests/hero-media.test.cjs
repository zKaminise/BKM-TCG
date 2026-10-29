const test=require('node:test'),assert=require('node:assert/strict');
const media=import('../hero-media.js');
test('hero settings allow public raster locations and reject executable, credentialed and ambiguous paths',async()=>{
  const {DEFAULT_HERO_PACK_IMAGE,resolveHeroPackImage}=await media;
  assert.equal(resolveHeroPackImage(''),DEFAULT_HERO_PACK_IMAGE);
  assert.equal(resolveHeroPackImage('/uploads/booster.webp'),'/uploads/booster.webp');
  assert.equal(resolveHeroPackImage('https://images.example.test/pack.png?v=2'),'https://images.example.test/pack.png?v=2');
  for(const value of['javascript:alert(1)','data:image/png;base64,aaa','http://images.example.test/pack.png','https://login:secret@images.example.test/pack.png','//images.example.test/pack.png','/uploads/../private.png','/uploads/%2e%2e/private.png','/uploads/x%5c.png','/uploads/%00.png','/assets/image.png\nother','https://images.example.test/pack.png#fragment'])assert.equal(resolveHeroPackImage(value),DEFAULT_HERO_PACK_IMAGE,value);
});
test('the original supplied photograph is framed only in rendering, with a vertical packet aspect',async()=>{
  const {DEFAULT_HERO_PACK_IMAGE,heroPackImageFrame}=await media,frame=heroPackImageFrame(DEFAULT_HERO_PACK_IMAGE),ratio=(1536*frame.height)/(1024*frame.width);
  assert.equal(frame.contour,true);assert.ok(ratio>1.7&&ratio<1.9);
  assert.ok(frame.left>0&&frame.bottom>0&&frame.left+frame.width<1&&frame.bottom+frame.height<1);
  assert.deepEqual(heroPackImageFrame('/uploads/transparent-pack.webp'),{left:0,bottom:0,width:1,height:1,contour:false});
});
test('a late pack image cannot replace the latest edit and stale texture resources are released',async()=>{
  const {createHeroPackImageController}=await media,pending=new Map(),applied=[],disposed=[];
  const controller=createHeroPackImageController({load:url=>new Promise(resolve=>pending.set(url,()=>resolve({dispose:()=>disposed.push(url)}))),apply:(_,url)=>applied.push(url)});
  const first=controller.update('/uploads/first.png'),second=controller.update('/uploads/latest.png');pending.get('/uploads/latest.png')();assert.equal(await second,true);pending.get('/uploads/first.png')();assert.equal(await first,false);assert.deepEqual(applied,['/uploads/latest.png']);assert.deepEqual(disposed,['/uploads/first.png']);
});
test('failed edits retain the working image, returning to it cancels pending edits, and disposal prevents late application',async()=>{
  const {createHeroPackImageController}=await media,applied=[],errors=[],disposed=[];let complete;
  const controller=createHeroPackImageController({initialUrl:'/uploads/working.png',load:async url=>{if(url==='/uploads/broken.png')throw Error('Unavailable');return await new Promise(resolve=>complete=()=>resolve({dispose:()=>disposed.push(url)}));},apply:(_,url)=>applied.push(url),onError:(_,url)=>errors.push(url)});
  assert.equal(await controller.update('/uploads/broken.png'),false);assert.equal(controller.currentUrl,'/uploads/working.png');assert.deepEqual(errors,['/uploads/broken.png']);
  const stale=controller.update('/uploads/other.png');assert.equal(await controller.update('/uploads/working.png'),false);complete();assert.equal(await stale,false);assert.deepEqual(applied,[]);
  const late=controller.update('/uploads/late.png');controller.destroy();complete();assert.equal(await late,false);assert.deepEqual(disposed,['/uploads/other.png','/uploads/late.png']);
});
