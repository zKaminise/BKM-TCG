'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const modulePromise=import('../mobile-catalog-ui.js');

class Element {
 constructor(tag,props={},children=[],document){this.tag=tag;this.props=props;this.children=children.flat(Infinity);this.ownerDocument=document;this.open=false;}
 contains(value){return this===value||this.children.some(child=>child instanceof Element&&child.contains(value));}
 focus(options){this.ownerDocument.activeElement=this;this.focusOptions=options;}
 get textContent(){return this.children.map(child=>child instanceof Element?child.textContent:String(child)).join(' ');}
}
function fixture({narrow=true,search='',legacy=false}={}) {
 const document={activeElement:null},el=(tag,props,...children)=>new Element(tag,props,children,document),listeners=new Set();
 const media={matches:narrow};
 if(legacy){media.addListener=listener=>listeners.add(listener);media.removeListener=listener=>listeners.delete(listener);}
 else{media.addEventListener=(kind,listener)=>{assert.equal(kind,'change');listeners.add(listener);};media.removeEventListener=(kind,listener)=>{assert.equal(kind,'change');listeners.delete(listener);};}
 const input=el('input',{name:'q'});input.value='Pikachu';const filters=el('form',{class:'shop-filters'},input);
 return {document,el,filters,input,listeners,options:{el,filters,search,matchMedia:query=>{assert.equal(query,'(max-width: 760px)');return media;}},resize(matches){media.matches=matches;for(const listener of listeners)listener({matches});}};
}

test('active count tracks catalogue criteria without counting sorting, pagination or an unchecked availability filter',async()=>{
 const {catalogActiveFilterCount}=await modulePromise;
 const params=new URLSearchParams('q=Pikachu&set=cel25&number=5&language=pt&condition=SP&finish=HOLO&minPrice=0&maxPrice=2500&available=true&page=2&sort=price_asc&kind=SINGLE');
 const before=params.toString();assert.equal(catalogActiveFilterCount(params),9);assert.equal(params.toString(),before);
 assert.equal(catalogActiveFilterCount('q=%20%20&minPrice=0&available=false&set=&page=1'),1);
 assert.equal(catalogActiveFilterCount('available=1&sort=name'),0);assert.equal(catalogActiveFilterCount(),0);
});

test('mobile starts collapsed with visible applied-filter count and the original form retained intact',async()=>{
 const {createCatalogFiltersPanel}=await modulePromise,f=fixture({search:'q=Pikachu&language=pt'}),panel=createCatalogFiltersPanel(f.options);
 assert.equal(panel.node.tag,'details');assert.equal(panel.node.open,false);assert.equal(panel.node.props.class,'shop-catalog-filter-panel');
 const summary=panel.node.children[0];assert.equal(summary.tag,'summary');assert.match(summary.textContent,/Filtrar produtos 2 ativos/);assert.equal(panel.node.children[1],f.filters);assert.equal(f.input.value,'Pikachu');
 assert.equal(summary.children[2].props['aria-hidden'],'true');panel.node.open=true;assert.equal(panel.node.contains(f.input),true);panel.destroy();
});

test('desktop stays expanded and resizing does not strand keyboard focus in the closed form or clear input values',async()=>{
 const {createCatalogFiltersPanel}=await modulePromise,f=fixture({narrow:false}),panel=createCatalogFiltersPanel(f.options);assert.equal(panel.node.open,true);
 f.document.activeElement=f.input;f.resize(true);assert.equal(panel.node.open,false);assert.equal(f.document.activeElement,panel.node.children[0]);assert.deepEqual(panel.node.children[0].focusOptions,{preventScroll:true});assert.equal(f.input.value,'Pikachu');
 f.resize(false);assert.equal(panel.node.open,true);assert.equal(f.input.value,'Pikachu');panel.destroy();
});

test('resize leaves outside focus alone and destroy removes the breakpoint listener once',async()=>{
 const {createCatalogFiltersPanel}=await modulePromise,f=fixture({narrow:false}),outside=f.el('button',{},'Comprar'),panel=createCatalogFiltersPanel(f.options);f.document.activeElement=outside;assert.equal(f.listeners.size,1);
 f.resize(true);assert.equal(f.document.activeElement,outside);assert.match(panel.node.children[0].textContent,/Todas as opções/);panel.destroy();panel.destroy();assert.equal(f.listeners.size,0);f.resize(false);assert.equal(panel.node.open,false);
});

test('legacy media-query listeners are supported and cleaned up for mobile Safari compatibility',async()=>{
 const {createCatalogFiltersPanel}=await modulePromise,f=fixture({legacy:true}),panel=createCatalogFiltersPanel(f.options);assert.equal(f.listeners.size,1);f.resize(false);assert.equal(panel.node.open,true);panel.destroy();assert.equal(f.listeners.size,0);
});
