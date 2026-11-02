const test=require('node:test'),assert=require('node:assert/strict');
const modulePromise=import('../home-layout.js');

test('compact home composition separates wrapper, text and touch controls across portrait sizes',async()=>{
 const {homeSceneLayout,compactHomeViewport}=await modulePromise;
 for(const [width,viewportHeight,copyBottom,revealTop]of [[320,568,305,315],[375,667,310,410],[390,844,375,535],[430,932,390,620]]){
  const height=Math.max(600,viewportHeight),footerTop=height-52,layout=homeSceneLayout({width,height,copyBottom,revealTop,footerTop});
  assert.equal(compactHomeViewport(width,viewportHeight),true);assert.equal(layout.landscape,false);
  assert.ok(layout.initial.top>=copyBottom+18);assert.ok(layout.initial.bottom<=footerTop-56);
  assert.ok(layout.final.top>=36);assert.ok(layout.final.bottom<=revealTop-22);
  for(const image of[layout.initial,layout.final]){assert.ok(image.height>0);assert.ok(image.centerX-image.width/2>=0);assert.ok(image.centerX+image.width/2<=width);}
 }
});

test('landscape composition keeps pack and revealed card in their own right column',async()=>{
 const {homeSceneLayout,compactHomeViewport}=await modulePromise,layout=homeSceneLayout({width:844,height:390,headerBottom:96,copyBottom:285,revealTop:100,footerTop:339});
 assert.equal(compactHomeViewport(844,390),true);assert.equal(layout.landscape,true);
 for(const image of[layout.initial,layout.final]){assert.ok(image.centerX-image.width/2>=844*.6);assert.ok(image.centerX+image.width/2<=844*.94);assert.ok(image.bottom<339);}
 assert.equal(compactHomeViewport(1280,800),false);assert.equal(compactHomeViewport(1024,400),false);assert.equal(compactHomeViewport(820,900),false);
 // Taller compact windows use the stacked CSS composition, even if wider
 // than they are tall; a right-column image would overlap the full-width copy.
 assert.equal(homeSceneLayout({width:750,height:600,copyBottom:320,revealTop:350,footerTop:548}).landscape,false);
});
