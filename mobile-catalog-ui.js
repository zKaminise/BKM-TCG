// Keep catalogue filters within reach without pushing all products below the
// first mobile screen. The original form and its submitted values are preserved.
const FILTER_KEYS=['q','set','number','language','condition','finish','minPrice','maxPrice'];

export function catalogActiveFilterCount(search) {
  const params=new URLSearchParams(search||'');
  return FILTER_KEYS.reduce((count,key)=>count+(String(params.get(key)||'').trim()?1:0),0)+(params.get('available')==='true'?1:0);
}

export function createCatalogFiltersPanel({el,filters,search,matchMedia=query=>window.matchMedia(query)}) {
  const media=matchMedia('(max-width: 760px)'),count=catalogActiveFilterCount(search);
  const summary=el('summary',{class:'shop-catalog-filter-toggle'},
    el('span',{class:'shop-catalog-filter-title'},'Filtrar produtos'),
    el('span',{class:'shop-filter-active-count'},count?`${count} ${count===1?'ativo':'ativos'}`:'Todas as opções'),
    el('span',{class:'shop-catalog-filter-indicator','aria-hidden':'true'}));
  const node=el('details',{class:'shop-catalog-filter-panel'},summary,filters);
  node.open=!media.matches;
  let destroyed=false;
  function resize(event) {
    if(destroyed)return;
    const narrow=event.matches,focused=filters.ownerDocument?.activeElement;
    const restoreFocus=narrow&&focused&&filters.contains(focused);
    node.open=!narrow;
    if(restoreFocus)summary.focus({preventScroll:true});
  }
  if(media.addEventListener)media.addEventListener('change',resize);
  else media.addListener?.(resize);
  return {node,destroy(){
    if(destroyed)return;destroyed=true;
    if(media.removeEventListener)media.removeEventListener('change',resize);
    else media.removeListener?.(resize);
  }};
}
