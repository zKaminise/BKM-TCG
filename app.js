import * as THREE from './vendor/three.module.js';
import {DEFAULT_HERO_PACK_IMAGE,normalizeHeroPackImage,heroPackImageFrame,createHeroPackImageController} from './hero-media.js';

const $ = s => document.querySelector(s);
const clamp = (x, a=0, b=1) => Math.min(b, Math.max(a, x));
const mix = (a,b,t) => a+(b-a)*t;
const smooth = (a,b,x) => { const t=clamp((x-a)/(b-a)); return t*t*(3-2*t); };
const experience=$('.experience'), stage=$('.stage'), host=$('#scene');
const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
let mobile=innerWidth<=760, progress=0, target=0, distance=1, sceneHeight=1;
let lastTime=0, pointer={x:0,y:0}, tilt={x:0,y:0}, auto=null, travel=null, pendingFocus=null;
let renderer, scene, camera, pack, body, cap, card, foil, dust, dustData;
let routeActive=location.pathname==='/'||location.pathname.endsWith('/ABRIR.html');
let initStarted=false;
let isReady=false, failed=false, chapter=-1, isHidden=document.hidden, uiProgress=-1;
let desiredPackImage=DEFAULT_HERO_PACK_IMAGE,packImageController=null,packTexture=null,packNormal=null,packRoughness=null,packContour=false;
const hero=$('.hero-copy'), reveal=$('.reveal-copy'), caption=$('.chapter-caption');
const packLabel=$('.pack-label'), sideLabel=$('.card-side-label'), loader=$('#loading');
const autoButton=$('#auto-play'), rail=[...document.querySelectorAll('[data-step]')];
const text=['Toda descoberta tem um começo.','Um instante. Infinitas possibilidades.','A sua próxima carta favorita.'];
const cardUniforms={uTime:{value:0},uHolo:{value:0},uTilt:{value:new THREE.Vector2()},uTexture:{value:null}};
// One shared clipping plane hides the portion still inside the wrapper, including
// its reverse and thin edge. Keeping the plane count fixed avoids shader rebuilds.
const cardClipPlane=new THREE.Plane(new THREE.Vector3(0,1,0),1000);
const mouthLocalPlane=new THREE.Plane();
const mouthNormalMatrix=new THREE.Matrix3();
const cardClipping=[cardClipPlane];
const CARD_W=1.37;
let cardHeight=1.915;
reveal.inert=true; reveal.setAttribute('aria-hidden','true');

function metrics(){
  if(experience.hidden)return;
  mobile=innerWidth<=760;
  uiProgress=-1;
  distance=Math.max(1,experience.offsetHeight-stage.offsetHeight);
  sceneHeight=stage.clientHeight;
  if(renderer){
    renderer.setSize(stage.clientWidth,sceneHeight,false);
    camera.aspect=stage.clientWidth/sceneHeight;
    camera.position.z=mobile?12.15:8.8;
    camera.updateProjectionMatrix();
  }
  readScroll();
}
function readScroll(){target=clamp((scrollY-experience.offsetTop)/distance);}
function stopAuto(){
  auto=null; travel=null;pendingFocus=null;
  autoButton.setAttribute('aria-label','Reproduzir a animação automaticamente');
  autoButton.querySelector('span').textContent='Assistir';
  autoButton.querySelector('path').setAttribute('d','m5 3 8 5-8 5z');
}
function goTo(p, duration=1100,focus=null){
  stopAuto();
  travel={from:scrollY,to:experience.offsetTop+distance*clamp(p),start:performance.now(),duration:reduced.matches?0:duration,focus};
}
function play(){
  if(reduced.matches){goTo(.98,0);return;}
  if(auto){stopAuto();return;}
  travel=null;
  const start=target>.96?0:target;
  if(target>.96){window.scrollTo(0,experience.offsetTop);target=0;progress=0;uiProgress=-1;}
  auto={from:start,start:performance.now(),duration:Math.max(2200,(1-start)*12500)};
  autoButton.setAttribute('aria-label','Pausar animação automática');
  autoButton.querySelector('span').textContent='Pausar';
  autoButton.querySelector('path').setAttribute('d','M4 3h3v10H4zM9 3h3v10H9z');
}
$('#open-pack').addEventListener('click',play);
autoButton.addEventListener('click',play);
$('#skip').addEventListener('click',()=>goTo(.98,1100,$('#inspect')));
$('.skip-link').addEventListener('click',e=>{e.preventDefault();if(!routeActive){$('#storefront')?.focus();return;}goTo(.98,1100,$('#inspect'));});
$('#scroll-cue').addEventListener('click',()=>target>.9?goTo(0):goTo(Math.min(.98,target+.22)));
for(const b of rail)b.addEventListener('click',()=>goTo(Number(b.dataset.step)));
for(const id of ['#replay','#footer-replay'])$(id).addEventListener('click',()=>{stopAuto();window.scrollTo(0,experience.offsetTop);target=0;progress=0;play();});
for(const a of document.querySelectorAll('a[href="#inicio"]'))a.addEventListener('click',e=>{e.preventDefault();goTo(0);});
addEventListener('scroll',readScroll,{passive:true});
addEventListener('resize',metrics,{passive:true});
addEventListener('bkm:route',e=>{routeActive=e.detail.home;stopAuto();lastTime=performance.now();if(routeActive){requestAnimationFrame(metrics);ensureScene();}});
addEventListener('bkm:hero-config',event=>{
  desiredPackImage=normalizeHeroPackImage(event.detail?.packImageUrl);
  $('#fallback-pack').src=desiredPackImage;
  if(isReady&&!failed)void packImageController?.update(desiredPackImage);
});
queueMicrotask(()=>dispatchEvent(new CustomEvent('bkm:hero-ready')));
window.visualViewport?.addEventListener('resize',metrics,{passive:true});
for(const name of ['wheel','touchstart'])addEventListener(name,()=>{if(auto||travel)stopAuto();},{passive:true});
addEventListener('keydown',e=>{if(e.key===' '&&e.target.closest('button,a,input,textarea,select'))return;if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(e.key)){if(auto||travel)stopAuto();}});
stage.addEventListener('pointermove',e=>{pointer.x=(e.clientX/innerWidth-.5)*2;pointer.y=(e.clientY/sceneHeight-.5)*2;},{passive:true});
stage.addEventListener('pointerleave',()=>{pointer.x=0;pointer.y=0;});
document.addEventListener('visibilitychange',()=>{isHidden=document.hidden;lastTime=performance.now();if(isHidden)stopAuto();});

const dialog=$('#card-dialog');
$('#inspect').addEventListener('click',()=>{stopAuto();dialog.showModal();});
$('.dialog-close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
const inspectImage=$('.inspect-image img');
$('.inspect-image').addEventListener('pointermove',e=>{
  if(reduced.matches)return;
  const r=e.currentTarget.getBoundingClientRect();
  inspectImage.style.transform=`rotateX(${-(e.clientY-r.top-r.height/2)/r.height*10}deg) rotateY(${(e.clientX-r.left-r.width/2)/r.width*12}deg)`;
});
$('.inspect-image').addEventListener('pointerleave',()=>inspectImage.style.transform='');

function studioEnvironment(){
  const cv=document.createElement('canvas');cv.width=1024;cv.height=512;
  const c=cv.getContext('2d');c.fillStyle='#707875';c.fillRect(0,0,1024,512);
  const add=(x,y,w,h,color)=>{c.fillStyle=color;c.fillRect(x,y,w,h);};
  add(60,70,80,360,'#eaf5ff');add(500,20,150,450,'#fffde6');add(850,90,38,290,'#b7faff');
  const grad=c.createLinearGradient(0,0,0,512);grad.addColorStop(0,'#ffffff55');grad.addColorStop(.45,'#00000000');grad.addColorStop(1,'#000000bb');c.fillStyle=grad;c.fillRect(0,0,1024,512);
  const texture=new THREE.CanvasTexture(cv);texture.mapping=THREE.EquirectangularReflectionMapping;texture.colorSpace=THREE.SRGBColorSpace;
  const pmrem=new THREE.PMREMGenerator(renderer);const env=pmrem.fromEquirectangular(texture).texture;texture.dispose();pmrem.dispose();return env;
}

// A rounded, physically thin card; the front and reverse have independent artwork.
function roundedCard(w,h,r){
  const s=new THREE.Shape(), x=-w/2,y=-h/2;
  s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);
  const g=new THREE.ShapeGeometry(s,12), pos=g.attributes.position, uv=g.attributes.uv;
  for(let i=0;i<pos.count;i++)uv.setXY(i,(pos.getX(i)+w/2)/w,(pos.getY(i)+h/2)/h);
  return {shape:s,geometry:g};
}

function makeCard(front,back){
  const group=new THREE.Group(), w=CARD_W,h=cardHeight;
  const {shape,geometry}=roundedCard(w,h,.063);
  const edgeGeometry=new THREE.ExtrudeGeometry(shape,{depth:.012,bevelEnabled:true,bevelSegments:2,steps:1,bevelSize:.002,bevelThickness:.002,curveSegments:12});edgeGeometry.translate(0,0,-.006);
  const edge=new THREE.Mesh(edgeGeometry,new THREE.MeshStandardMaterial({color:0xb9b9aa,metalness:.15,roughness:.65,clippingPlanes:cardClipping}));group.add(edge);
  const frontMaterial=new THREE.MeshBasicMaterial({map:front,toneMapped:false,alphaTest:.08,clippingPlanes:cardClipping});
  const face=new THREE.Mesh(geometry,frontMaterial);face.position.z=.009;group.add(face);
  const reverse=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({map:back,toneMapped:false,clippingPlanes:cardClipping}));reverse.rotation.y=Math.PI;reverse.position.z=-.009;group.add(reverse);
  cardUniforms.uTexture.value=front;
  const holoMaterial=new THREE.ShaderMaterial({
    uniforms:cardUniforms,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,clipping:true,clippingPlanes:cardClipping,
    vertexShader:`
      #include <clipping_planes_pars_vertex>
      varying vec2 vUv;varying vec3 vNormal;varying vec3 vView;
      void main(){vUv=uv;vec4 mvPosition=modelViewMatrix*vec4(position,1.);vView=normalize(-mvPosition.xyz);vNormal=normalize(normalMatrix*normal);gl_Position=projectionMatrix*mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader:`precision highp float;
      #include <clipping_planes_pars_fragment>
      varying vec2 vUv;varying vec3 vNormal;varying vec3 vView;uniform sampler2D uTexture;uniform float uTime;uniform float uHolo;uniform vec2 uTilt;
      vec3 spectrum(float t){return .54+.46*cos(6.28318*(vec3(0.,.33,.67)+t));}
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      void main(){
        #include <clipping_planes_fragment>
        float facing=dot(vNormal,vView);float wave=vUv.x*.7+vUv.y*.9+facing*.35+uTilt.x*.14-uTilt.y*.1;vec3 rgb=spectrum(wave+sin(uTime*.24)*.08);float grain=pow(hash(floor(vUv*vec2(650.,920.))),18.);float stripes=pow(.5+.5*sin((vUv.x-vUv.y*.8)*1100.),16.);float sweep=pow(max(0.,1.-abs(vUv.x*.65+vUv.y-(.1+1.7*fract(uTime*.065)))*2.8),6.);float artLuma=dot(texture2D(uTexture,vUv).rgb,vec3(.2,.6,.2));float rim=smoothstep(.91,1.,max(abs(vUv.x-.5)*2.,abs(vUv.y-.5)*2.));float alpha=(.035+grain*.24+stripes*.028+sweep*.18)*(uHolo)*(.5+artLuma*.5);alpha+=rim*.05*uHolo;gl_FragColor=vec4(rgb,alpha);}`
  });
  foil=new THREE.Mesh(geometry,holoMaterial);foil.position.z=.010;group.add(foil);
  return group;
}

const PW=1.55;
let PH=2.832,CUT=1.15,capPivot=1.283;
function seam(x){return .008*Math.sin(x*78)+.004*Math.sin(x*141);}
function packetGeometry(yMin,yMax,side=1,isCap=false){
  const cols=48,rows=isCap?8:64,positions=[],uvs=[],indices=[];
  for(let iy=0;iy<=rows;iy++){
    const v=iy/rows, sy=mix(yMin,yMax,v);
    for(let ix=0;ix<=cols;ix++){
      const u=ix/cols,globalY=(sy+PH/2)/PH,contour=packContour?1-.046*Math.sin(clamp(globalY)*Math.PI):1,mappedU=.5+(u-.5)*contour,x=(mappedU-.5)*PW;
      let y=sy;
      if(!isCap)y+=seam(x)*Math.pow(v,12);else y+=seam(x)*Math.pow(1-v,5);
      const globalV=(y+PH/2)/PH;
      const pillow=Math.pow(Math.sin(u*Math.PI),.55)*Math.sin(clamp(globalV)*Math.PI)*.11;
      const wrinkles=(Math.sin(x*32+y*5)*.004+Math.sin(x*55-y*9)*.002)*Math.sin(u*Math.PI);
      const crimp=(globalV<.055||globalV>.947)?Math.sin(x*225)*.003:0;
      const z=side*(.022+pillow+wrinkles+crimp);
      positions.push(x,y-(isCap?capPivot:0),z);uvs.push(side===1?mappedU:1-mappedU,globalV);
      if(iy<rows&&ix<cols){const a=iy*(cols+1)+ix,b=a+cols+1;if(side===1)indices.push(a,a+1,b,a+1,b+1,b);else indices.push(a,b,a+1,a+1,b,b+1);}
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();return g;
}
function makePack(texture,normal,roughness){
  const group=new THREE.Group();body=new THREE.Group();cap=new THREE.Group();cap.position.y=capPivot;
  // Printed artwork already contains the supplied photograph's highlights.
  // Preserve its sRGB colors instead of lighting and tone-mapping them a second time.
  const front=new THREE.MeshBasicMaterial({map:texture,toneMapped:false,side:THREE.DoubleSide,alphaTest:.08});
  const back=new THREE.MeshStandardMaterial({color:0x202328,metalness:.65,roughness:.44,normalMap:normal,normalScale:new THREE.Vector2(.15,.15),side:THREE.DoubleSide});
  for(const side of [1,-1]){
    body.add(new THREE.Mesh(packetGeometry(-PH/2,CUT,side),side===1?front:back));
    cap.add(new THREE.Mesh(packetGeometry(CUT,PH/2,side,true),side===1?front:back));
  }
  // Silver inner lip becomes visible when the seal lifts.
  const lip=new THREE.Mesh(new THREE.PlaneGeometry(PW-.02,.054),new THREE.MeshStandardMaterial({color:0xb8bfb3,metalness:.9,roughness:.25,side:THREE.DoubleSide}));lip.position.set(0,CUT-.015,.01);lip.rotation.x=-Math.PI/2;body.add(lip);
  const sideMaterial=new THREE.MeshStandardMaterial({color:0x303841,metalness:.6,roughness:.4,side:THREE.DoubleSide});
  for(const x of [-PW/2,PW/2]){const m=new THREE.Mesh(new THREE.PlaneGeometry(.045,CUT+PH/2),sideMaterial);m.position.set(x,(CUT-PH/2)/2,0);m.rotation.y=Math.PI/2;body.add(m);}
  // Back seam gives the wrapper thickness during its departure.
  const fold=new THREE.Mesh(new THREE.PlaneGeometry(.08,CUT+PH/2-.1),back);fold.position.set(.1,(CUT-PH/2)/2,-.14);fold.rotation.y=.25;body.add(fold);
  group.add(body,cap);return group;
}

function setPackDimensions(texture,url){
  const width=texture.image?.width,height=texture.image?.height;
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1)throw new Error('Imagem do pacote inválida.');
  const framing=heroPackImageFrame(url),ratio=height*framing.height/(width*framing.width);
  if(ratio<1.2||ratio>2.8)throw new Error('Use uma imagem vertical do pacote, sem margens largas.');
  packContour=framing.contour;texture.offset.set(framing.left,framing.bottom);texture.repeat.set(framing.width,framing.height);
  PH=PW*ratio;CUT=PH*(framing.contour ? .442 : 1.15/2.832);capPivot=(CUT+PH/2)/2;
  mouthLocalPlane.set(new THREE.Vector3(0,1,0),-(CUT+.015));
}
async function loadPackTexture(loader,url){
  const texture=await loader.loadAsync(url),ratio=texture.image?.height/texture.image?.width;
  if(!Number.isFinite(ratio)||ratio<1.2||ratio>2.8){texture.dispose();throw new Error('A imagem precisa mostrar o pacote na vertical.');}
  return texture;
}
function replacePackImage(texture,url){
  setPackDimensions(texture,url);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  const previous=pack,oldTexture=packTexture;
  previous.remove(card);scene.remove(previous);
  pack=makePack(texture,packNormal,packRoughness);pack.add(card);scene.add(pack);packTexture=texture;
  const geometries=new Set(),materials=new Set();
  previous.traverse(node=>{if(node.geometry)geometries.add(node.geometry);for(const material of Array.isArray(node.material)?node.material:[node.material])if(material)materials.add(material);});
  geometries.forEach(geometry=>geometry.dispose());materials.forEach(material=>material.dispose());oldTexture?.dispose();
  $('#fallback-pack').src=url;
  uiProgress=-1;
}

function makeDust(){
  const count=55,positions=new Float32Array(count*3);dustData=[];
  for(let i=0;i<count;i++){
    const x=(Math.sin(i*184.32)*.5+.5)*7-3.5, y=(Math.sin(i*21.3)*.5+.5)*6-3;
    positions.set([x,y,-1.4-Math.abs(Math.sin(i*13))*2],i*3);dustData.push({x,y,speed:.035+(i%5)*.014});
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const c=document.createElement('canvas');c.width=c.height=32;const ct=c.getContext('2d'),gr=ct.createRadialGradient(16,16,0,16,16,16);gr.addColorStop(0,'#c8faff');gr.addColorStop(.15,'#c8faffaa');gr.addColorStop(1,'#c8faff00');ct.fillStyle=gr;ct.fillRect(0,0,32,32);
  dust=new THREE.Points(g,new THREE.PointsMaterial({color:0xb5f5fa,size:.035,map:new THREE.CanvasTexture(c),transparent:true,opacity:.0,depthWrite:false,blending:THREE.AdditiveBlending}));scene.add(dust);
}

async function init(){
  try{
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
    renderer.localClippingEnabled=true;
    renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.94;renderer.setClearColor(0x000000,0);
    host.appendChild(renderer.domElement);
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(34,1,.1,60);camera.position.set(0,0,8.8);scene.environment=studioEnvironment();
    scene.add(new THREE.AmbientLight(0xffffff,1.25));
    const key=new THREE.DirectionalLight(0xf7f9ff,2.0);key.position.set(-3,4,6);scene.add(key);
    const fill=new THREE.DirectionalLight(0xffffff,.9);fill.position.set(4,0,5);scene.add(fill);
    const rim=new THREE.DirectionalLight(0xaeeff5,2.5);rim.position.set(1,4,-4);scene.add(rim);
    const textureLoader=new THREE.TextureLoader();
    let initialPackImage=desiredPackImage;
    const firstPack=(async()=>{let lastError;for(const url of [...new Set([desiredPackImage,DEFAULT_HERO_PACK_IMAGE,'/assets/pack.webp'])]){try{const texture=await loadPackTexture(textureLoader,url);initialPackImage=url;return texture;}catch(error){lastError=error;}}throw lastError;})();
    const textures=await Promise.all([firstPack,...['/assets/pikachu.webp','/assets/pokemon-back.webp','/assets/pack-normal.png','/assets/pack-roughness.png'].map(url=>textureLoader.loadAsync(url))]);
    textures.forEach((t,i)=>{if(i<3)t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());});
    setPackDimensions(textures[0],initialPackImage);
    cardHeight=CARD_W*textures[1].image.height/textures[1].image.width;
    packTexture=textures[0];packNormal=textures[3];packRoughness=textures[4];
    pack=makePack(packTexture,packNormal,packRoughness);card=makeCard(textures[1],textures[2]);pack.add(card);scene.add(pack);makeDust();
    packImageController=createHeroPackImageController({initialUrl:initialPackImage,load:url=>loadPackTexture(textureLoader,url),apply:replacePackImage,onError:()=>console.warn('A nova imagem do pacote não pôde ser carregada. A imagem anterior foi preservada.')});
    $('#fallback-pack').src=initialPackImage;
    metrics();await renderer.compileAsync(scene,camera);
    renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();showFallback();});
    isReady=true;loader.classList.add('is-loaded');
    if(desiredPackImage!==initialPackImage)void packImageController.update(desiredPackImage);
  }catch(err){console.error('A cena 3D não pôde ser iniciada.',err);showFallback();}
}
function showFallback(){failed=true;$('#fallback').hidden=false;host.style.display='none';loader.classList.add('is-loaded');metrics();}

function setVisible(el,visible){if(el.inert!==!visible){el.inert=!visible;el.setAttribute('aria-hidden',String(!visible));}}
function updateUI(p){
  const exit=smooth(.015,.13,p),final=smooth(.77,.91,p);
  hero.style.opacity=1-exit;hero.style.transform=mobile?`translateY(${-exit*28}px)`:`translateY(calc(-47% - ${exit*25}px))`;setVisible(hero,exit<.98);
  packLabel.style.opacity=1-smooth(.015,.09,p);
  reveal.style.opacity=final;reveal.style.transform=mobile?`translateY(${(1-final)*20}px)`:`translateY(calc(-47% + ${(1-final)*20}px))`;setVisible(reveal,final>.92);
  reveal.style.pointerEvents=final>.92?'auto':'none';
  const capOpacity=smooth(.12,.2,p)*(1-smooth(.71,.79,p));caption.style.opacity=capOpacity;
  sideLabel.style.opacity=final;
  $('.scroll-progress i').style.transform=`scaleX(${p})`;
  const next=p<.23?0:p<.73?1:2;
  if(chapter!==next){chapter=next;$('#chapter-text').textContent=text[next];$('.caption-number').textContent=`0${next+1} / 03`;
    rail.forEach((b,i)=>{b.classList.toggle('is-active',i===next);if(i===next)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});
    if(next===2){$('#announcement').textContent='Carta revelada: Pikachu ex, 276 de 217. Use Ver de perto para explorar a imagem.';host.setAttribute('aria-label','Carta Pikachu ex revelada, com reflexo holográfico.');}else host.setAttribute('aria-label',next===0?'Pacote Pokémon Heróis Excelsos fechado.':'Pacote aberto. Carta saindo de costas e girando até a frente.');
  }
  $('#scroll-label').textContent=p>.9?'Voltar ao início':'Role para revelar';
  if(failed){
    $('#fallback-pack').hidden=p>.34;$('#fallback-card').hidden=p<=.34;
    const f=$('#fallback');f.style.top=mobile?(p>.34?'13%':'43%'):'18%';f.style.height=mobile?(p>.34?'36%':'36%'):'57%';
  }
}

function pose(p,t){
  const visibleH=2*Math.tan(THREE.MathUtils.degToRad(17))*camera.position.z, visibleW=visibleH*camera.aspect;
  const opening=smooth(.095,.245,p),emerging=smooth(.205,.44,p),fall=smooth(.455,.66,p),flip=smooth(.48,.69,p),settle=smooth(.445,.73,p),final=smooth(.75,.92,p);
  const centered=smooth(.045,.18,p),initialX=mobile?0:visibleW*.22;
  const hover=reduced.matches?0:Math.sin(t*.9)*.025;
  // The card and wrapper share a single coordinate system throughout the pull.
  // Lowering the whole rig keeps the fully extracted card inside the viewport.
  const baseY=mix(mobile?-visibleH*.135:.24,.05,centered);
  const rigY=mix(baseY-.95*emerging,.05,settle);
  pack.position.set(mix(mix(initialX,0,centered),initialX,final),mix(rigY,mobile?visibleH*.18:.15,final)+hover*(1-emerging+final),0);
  pack.scale.setScalar(mix(mobile?mix(.94,1.03,centered):1.02,1,settle));
  pack.rotation.set(mix(mix(-.025,.045,opening),0,settle),mix(.08+Math.sin(p*8)*.1,0,settle),mix(-.065+opening*.2,0,settle));
  body.position.set(fall*.22,-fall*5.8,0);body.rotation.set(fall*.26,fall*.4,-fall*.26);
  body.visible=p<.72;
  const capFly=smooth(.18,.37,p);
  cap.position.set(-opening*.55-capFly*2,capPivot+opening*.52+capFly*3.2,opening*.12);cap.rotation.set(opening*.27,opening*.5+capFly,opening*.36+capFly*.6);cap.visible=p<.4;

  // No local yaw, extra scale or sideways tilt until the bottom edge has cleared
  // the mouth. These poses are derived from p so reverse scrolling is identical.
  const fullyOutY=CUT+cardHeight/2+.08;
  const localCardY=mix(mix(-.18,fullyOutY,emerging),.44,settle);
  card.position.set(0,mix(localCardY,0,final),0);
  const cardScale=mobile?mix(mix(1,1.14,settle),sceneHeight<730?1.28:1.42,final):mix(1,1.66,final);
  card.scale.setScalar(cardScale);
  card.rotation.y=mix(Math.PI,0,flip)+tilt.x*.12*final;
  card.rotation.x=tilt.y*.09*final+Math.sin(t*.42)*.016*final;
  card.rotation.z=-.055*settle+tilt.x*.018*final;
  card.visible=p>.19;
  if(reduced.matches){pack.rotation.set(0,0,0);card.rotation.set(0,0,0);card.visible=p>.35;body.visible=p<=.35;cap.visible=p<=.35;}
  pack.updateMatrixWorld(true);
  if(p<.455&&!reduced.matches)cardClipPlane.copy(mouthLocalPlane).applyMatrix4(body.matrixWorld,mouthNormalMatrix.getNormalMatrix(body.matrixWorld));
  else cardClipPlane.set(new THREE.Vector3(0,1,0),1000);
  cardUniforms.uTime.value=reduced.matches?0:t;cardUniforms.uHolo.value=smooth(.56,.73,p)*.65;cardUniforms.uTilt.value.set(reduced.matches?0:tilt.x,reduced.matches?0:tilt.y);
  dust.material.opacity=reduced.matches?0:smooth(.48,.68,p)*.26;
  if(!reduced.matches){const pos=dust.geometry.attributes.position;for(let i=0;i<dustData.length;i++){const d=dustData[i];pos.setY(i,((d.y+t*d.speed+3)%6)-3);}pos.needsUpdate=true;}
}

function frame(now){
  requestAnimationFrame(frame);
  if(isHidden||!routeActive)return;
  const dt=Math.min((now-(lastTime||now))/1000,.05);lastTime=now;
  if(travel){const u=travel.duration===0?1:clamp((now-travel.start)/travel.duration),e=u<.5?4*u*u*u:1-Math.pow(-2*u+2,3)/2;window.scrollTo(0,mix(travel.from,travel.to,e));readScroll();if(u===1){pendingFocus=travel.focus;travel=null;}}
  if(auto){const u=clamp((now-auto.start)/auto.duration);window.scrollTo(0,experience.offsetTop+distance*mix(auto.from,1,u));readScroll();if(u===1)stopAuto();}
  progress=reduced.matches?target:mix(progress,target,1-Math.exp(-11*dt));if(Math.abs(progress-target)<.000015)progress=target;
  tilt.x=mix(tilt.x,pointer.x,1-Math.exp(-5*dt));tilt.y=mix(tilt.y,pointer.y,1-Math.exp(-5*dt));
  if(Math.abs(uiProgress-progress)>.00001){updateUI(progress);uiProgress=progress;}
  if(pendingFocus&&!reveal.inert){pendingFocus.focus({preventScroll:true});pendingFocus=null;}
  if(isReady&&!failed){pose(progress,now/1000);renderer.render(scene,camera);}
}
function ensureScene(){if(initStarted)return;initStarted=true;init();}
metrics();if(routeActive)ensureScene();requestAnimationFrame(frame);
