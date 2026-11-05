import {COLLECTION_LANGUAGES as languages,COLLECTION_CONDITIONS as conditions,COLLECTION_TYPES as types,COLLECTION_FINISHES as finishes,COLLECTION_ATTRIBUTES as attributes,COLLECTION_STATUS as statuses,parseCollectionMoney as cents,collectionDecimal as decimal,collectionDate as date,collectionCopyAcquisition,collectionBatchPayload,collectionQueueTotals,collectionDraftKey,collectionCostMutation,createCollectionSearchScheduler} from "./collection-domain.js";

export function createCollectionUI(ctx) {
  const {el,button,field,selectField,checkbox,message,empty,image,money,api,navigate,toast,getState,svgIcon,collectionNav}=ctx;
  const root="/account/collection",route="/conta/colecao",arr=value=>Array.isArray(value)?value:[],label=(list,id)=>list.find(([key])=>key===id)?.[1]||id||"—";
  let generation=0,cleanup=()=>{};
  window.addEventListener("bkm:route",()=>{generation++;cleanup();cleanup=()=>{};for(const node of document.querySelectorAll("dialog.collection-dialog[open]"))node.close();});
  const notice=()=>el("div",{"aria-live":"polite"});
  const status=item=>statuses[item.status]||"Em coleção";
  const title=item=>item.title||item.card?.name||item.cardId||"Item pessoal";
  const pic=item=>item.photoUrl||item.card?.image||item.card?.imageLarge||item.image||"";
  const number=item=>item.card?.displayNumber||item.displayNumber||item.card?.number||"";
  const setName=item=>item.card?.setName||item.setName||item.setId||"Sem coleção";
  const cost=value=>value==null?"Não informado":value===0?"Gratuito / R$ 0,00":money(value);
  const newId=()=>crypto.randomUUID();
  const countLabel=(count,singular,plural)=>`${count} ${count===1?singular:plural}`;
  const visibleChildren=children=>children.flat(Infinity).filter(child=>child!==null&&child!==undefined&&child!==false);
  const replace=(node,...children)=>node.replaceChildren(...visibleChildren(children));
  const append=(node,...children)=>node.append(...visibleChildren(children));
  const roundNote=item=>item.kind==="CARD"&&!item.photoUrl&&item.language!==(item.referenceLanguage||item.card?.referenceLanguage||item.card?.language)?`Imagem de referência em ${label(languages,item.referenceLanguage||item.card?.language)}. A existência desta impressão no idioma escolhido não foi confirmada pelo catálogo.`:"";
  function thumb(item,cls="collection-thumb") {return pic(item)?image(pic(item),title(item),cls):el("span",{class:`${cls} collection-no-image`,role:"img","aria-label":"Sem imagem disponível"},svgIcon("collection"));}
  function photoButton(item,cls="collection-photo") {return button(thumb(item),()=>preview(item),cls,{"aria-label":`Ampliar imagem de ${title(item)}`});}
  function preview(item) {modal(title(item),el("div",{class:"collection-image-preview"},thumb(item),roundNote(item)?message(roundNote(item)):null));}
  function modal(name,content) {
    const node=el("dialog",{class:"personal-dialog collection-dialog","aria-label":name}),close=button("×",()=>node.close(),"shop-close",{"aria-label":`Fechar ${name}`});
    append(node,el("div",{class:"personal-dialog-content"},el("div",{class:"personal-dialog-heading"},el("h2",{},name),close),content));
    node.addEventListener("click",event=>{if(event.target===node)node.close();});node.addEventListener("close",()=>node.remove(),{once:true});append(document.body,node);node.showModal();return node;
  }
  async function run(trigger,region,task) {if(trigger.disabled)return;trigger.disabled=true;replace(region,);try{return await task();}catch(error){if(error.name!=="AbortError")replace(region,message(error.message,"error"));}finally{if(trigger.isConnected)trigger.disabled=false;}}
  function confirm(name,text,task,{strong=false}={}) {
    let dialog;const region=notice(),input=strong?field("Digite EXCLUIR para confirmar","confirmDelete","text","",{autocomplete:"off"}):null;
    const form=el("form",{class:"personal-form",onSubmit:event=>{event.preventDefault();run(form.querySelector("[type=submit]"),region,async()=>{if(strong&&input.querySelector("input").value!=="EXCLUIR")throw new Error("Digite EXCLUIR para confirmar a exclusão permanente.");await task();dialog.close();});}},el("p",{class:"shop-muted"},text),input,region,el("div",{class:"shop-actions"},button("Cancelar",()=>dialog.close(),"shop-button secondary"),el("button",{type:"submit",class:"shop-button"},strong?"Excluir permanentemente":"Confirmar")));
    dialog=modal(name,form);
  }
  function moneyField(name,text,value,onChange,onInvalid) {
    const wrap=field(text,name,"text",decimal(value),{inputmode:"decimal",placeholder:"Não informado",autocomplete:"off",maxlength:"18"}),input=wrap.querySelector("input"),region=notice();
    input.addEventListener("input",()=>{try{const parsed=cents(input.value);input.setCustomValidity("");replace(region,);onInvalid?.(null);onChange?.(parsed);}catch(error){input.setCustomValidity(error.message);onInvalid?.(error.message);replace(region,message(error.message,"error"));}});
    const set=value=>{input.value=decimal(value);input.setCustomValidity("");onInvalid?.(null);onChange?.(value);input.dispatchEvent(new Event("change",{bubbles:true}));replace(region,);};
    return el("div",{class:"collection-money"},wrap,el("div",{class:"collection-increments"},[10,100,500,1000,5000,10000].map(amount=>button(`+${decimal(amount).replace(/,00$/,"")}`,()=>{try{set((cents(input.value)||0)+amount);}catch(error){replace(region,message(error.message,"error"));}},"collection-chip")),button("Zerar",()=>set(0),"collection-chip"),button("Não informar",()=>set(null),"collection-chip")),region);
  }
  function saveLocal(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{}}
  function readLocal(key){try{return JSON.parse(localStorage.getItem(key)||"null");}catch{return null;}}

  async function dashboard(path=route) {
    const owner=getState().user.id,key=`bkm:collection-view:v2:${owner}`,prefs=readLocal(key)||{},query=new URLSearchParams(location.search);query.set("pageSize","36");
    if(!query.has("sort")&&prefs.sort)query.set("sort",prefs.sort);if(!query.has("group")&&prefs.group)query.set("group",prefs.group);
    const current=++generation,region=notice(),results=el("div"),stats=el("div"),selected=new Map(),selection=el("div",{class:"collection-selection","aria-live":"polite"}),container=el("section",{class:"collection-page"});
    let data={items:[],total:0},view=prefs.view||"grid",controller,debounce,undoId=null,selecting=false;
    const mutationRequests=new Map();
    const sortKeys=["sort","dir","group","pageSize"],filterEntries=()=>[...query].filter(([name,value])=>value&&name!=="page"&&!sortKeys.includes(name));
    const updateQuery=(name,value)=>{value!==null&&value!==undefined&&value!==''?query.set(name,value):query.delete(name);query.delete("page");if(!sortKeys.includes(name))selected.clear();};
    const remember=()=>saveLocal(key,{view,sort:query.get("sort")||"default",group:query.get("group")||"none"});
    const count=el("span",{class:"collection-inventory-count"});
    const add=()=>navigate(`${route}/adicionar`);
    const heading=el("div",{class:"collection-heading collection-inventory-heading"},
      el("div",{},el("h1",{},"Minha Coleção"),count),
      button([svgIcon("plus"),"Adicionar itens"],add,"shop-button collection-inventory-add"));
    const search=field("Buscar na minha coleção","q","search",query.get("q")||"",{placeholder:"Nome, número ou coleção"});
    const searchInput=search.querySelector("input"),filterFields=el("div",{class:"collection-filter-grid"}),advancedFields=el("div",{class:"collection-filter-grid"}),chips=el("div",{class:"collection-active-filters"});
    const resetFilters=()=>{for(const [name] of filterEntries())query.delete(name);query.delete("page");searchInput.value="";selected.clear();load();};
    const filterToggle=button("Buscar e filtrar",()=>{filters.hidden=!filters.hidden;filterToggle.setAttribute("aria-expanded",String(!filters.hidden));},
      "shop-button secondary collection-inventory-filter-toggle",{"aria-controls":"collection-inventory-filters","aria-expanded":"false"});
    const selectToggle=button("Selecionar",()=>{
      selecting=!selecting;
      if(!selecting)selected.clear();
      renderResults();
    },"shop-button secondary",{"aria-pressed":"false"});
    searchInput.addEventListener("input",event=>{updateQuery("q",event.target.value.trim());controller?.abort();clearTimeout(debounce);debounce=setTimeout(load,250);});
    const statusOptions=[["ACTIVE","Em coleção"],["SOLD","Vendidos"],["ARCHIVED","Arquivados"],["ALL","Todos"]];
    const statusTabs=el("div",{class:"collection-status-tabs",role:"group","aria-label":"Situação dos itens"},statusOptions.map(([id,text])=>button(text,()=>{updateQuery("status",id==="ACTIVE"?null:id);load();},"collection-chip",{"aria-pressed":String((query.get("status")||"ACTIVE")===id)})));
    const sort=selectField("Ordenar","sort",[["default","Padrão"],["dex","Pokédex"],["number","Código da carta"],["set","Coleção (set)"],["rarity","Raridade"],["name","Nome"],["acquired","Data da compra"],["cost","Quanto paguei"],["value","Valor estimado"],["recent","Adicionado recentemente"]],query.get("sort")||"default"),group=selectField("Agrupar","group",[["none","Sem agrupamento"],["set","Coleção / set"],["pokemon","Pokémon"],["rarity","Raridade"],["illustrator","Ilustrador"],["status","Situação"]],query.get("group")||"none");
    for(const node of [sort,group])node.querySelector("select").addEventListener("change",event=>{updateQuery(event.target.name,event.target.value);remember();load();});
    const layouts=selectField("Visualização","view",[["grid","Grade"],["compact","Grade compacta"],["list","Lista"],["detailed","Lista detalhada"]],view);
    layouts.querySelector("select").addEventListener("change",event=>{view=event.target.value;remember();renderResults();});
    const tools=el("div",{class:"collection-filter-grid"},sort,group,layouts,button("Inverter ordem",()=>{updateQuery("dir",query.get("dir")==="desc"?"asc":"desc");load();},"shop-button secondary"));
    const refreshButton=button("Atualizar valor estimado",event=>run(event.currentTarget,region,async()=>{
      const ids=data.items.filter(item=>item.kind==="CARD").slice(0,24).map(item=>item.id);
      if(!ids.length)return;
      await api(`${root}/inventory/market-refresh`,{method:"POST",body:{ids}});
      await load();
      if(current===generation)toast("Referências desta página consultadas.");
    }),"shop-button secondary");
    const filters=el("section",{class:"collection-inventory-filters",id:"collection-inventory-filters","aria-label":"Filtros da coleção",hidden:true},
      search,statusTabs,filterFields,tools,
      el("details",{class:"collection-inventory-advanced"},el("summary",{},"Filtros avançados"),advancedFields),
      el("div",{class:"collection-inventory-actions"},button("Limpar filtros",resetFilters,"shop-button secondary"),
        button("Histórico de movimentações",history,"shop-button secondary"),refreshButton));
    const selectTools=el("div",{class:"collection-inventory-select-tools",hidden:true},
      button("Selecionar todos desta página",()=>{data.items.forEach(item=>selected.set(item.id,item));renderResults();},"shop-button secondary"));
    append(container,heading,stats,collectionNav(path),
      el("div",{class:"collection-inventory-toolbar"},filterToggle,selectToggle),
      filters,chips,selectTools,region,results,selection);
    function buildFilters() {
      const facets=data.facets||{},definition=[
        ["Coleção / expansão","setId",[["","Todas"],...arr(facets.sets).map(set=>[set.id,set.name||set.id])]],
        ["Tipo de item","kind",[["","Todos"],["CARD","Carta"],["SEALED","Selado"],["CUSTOM","Personalizado"]]],
        ["Idioma","language",[["","Todos"],...languages]],
        ["Conservação","condition",[["","Todas"],...conditions,...[['LP','Levemente jogada (LP, cadastro anterior)'],['DMG','Danificada (DMG, cadastro anterior)']].filter(([code])=>arr(facets.conditions).includes(code)),["SEALED","Lacrado"],["OPENED","Aberto"]]],
        ["Raridade","rarity",[["","Todas"],...arr(facets.rarities).map(value=>[value,value])]],
        ["Acabamento","variant",[["","Todos"],...finishes]],
        ["Referência de preço","price",[["","Todas"],["known","Com cotação válida"],["missing","Sem cotação"],["stale","Desatualizada"]]],
        ["Custo informado","cost",[["","Todos"],["known","Informado"],["missing","Não informado"]]]
      ];
      const makeSelect=([text,name,options])=>{
        const node=selectField(text,name,options,query.get(name)||"");
        node.querySelector("select").addEventListener("change",event=>{updateQuery(name,event.target.value);load();});
        return node;
      };
      const ranges=[["Aquisição desde","acquiredFrom","date"],["Aquisição até","acquiredTo","date"],
        ["Custo mínimo (R$)","minCost","text"],["Custo máximo (R$)","maxCost","text"],
        ["Valor mínimo (R$)","minValue","text"],["Valor máximo (R$)","maxValue","text"]];
      replace(filterFields,...definition.slice(0,4).map(makeSelect));
      replace(advancedFields,...definition.slice(4).map(makeSelect),...ranges.map(([text,name,type])=>{
        const value=query.get(name),node=field(text,name,type,value==null?"":type==="date"?value:decimal(Number(value)),
          {inputmode:type==="text"?"decimal":undefined});
        const input=node.querySelector("input");
        input.addEventListener("change",()=>{
          try{updateQuery(name,type==="date"?input.value:cents(input.value));load();}
          catch(error){replace(region,message(error.message,"error"));}
        });
        return node;
      }));
      const chipNames={q:'Busca',status:'Situação',setId:'Coleção',kind:'Tipo',language:'Idioma',condition:'Conservação',rarity:'Raridade',variant:'Acabamento',price:'Cotação',cost:'Custo',acquiredFrom:'Aquisição desde',acquiredTo:'Aquisição até',minCost:'Custo mínimo',maxCost:'Custo máximo',minValue:'Valor mínimo',maxValue:'Valor máximo'};
      const chipValue=(name,value)=>name==='status'?({ACTIVE:'Em coleção',ALL:'Todos',...statuses})[value]||value:name==='setId'?(arr(data.facets?.sets).find(set=>set.id===value)?.name||value):name==='kind'?({CARD:'Carta',SEALED:'Selado',CUSTOM:'Personalizado'})[value]||value:name==='language'?label(languages,value):name==='condition'?label(conditions,value):name==='variant'?label(finishes,value):/^(?:min|max)(?:Cost|Value)$/.test(name)?money(Number(value)):['acquiredFrom','acquiredTo'].includes(name)?date(value):name==='price'?({known:'Com cotação',missing:'Sem cotação',stale:'Desatualizada'})[value]||value:name==='cost'?({known:'Informado',missing:'Não informado'})[value]||value:value;
      const activeFilters=filterEntries();
      replace(chips,...activeFilters.map(([name,value])=>button(`${chipNames[name]||name} · ${chipValue(name,value)} ×`,()=>{
        updateQuery(name,null);
        if(name==="q")searchInput.value="";
        load();
      },"collection-chip",{"aria-label":`Remover filtro ${chipNames[name]||name}`})));
      filterToggle.textContent=activeFilters.length?`Buscar e filtrar (${activeFilters.length})`:"Buscar e filtrar";
      statusTabs.querySelectorAll("button").forEach((node,index)=>node.setAttribute("aria-pressed",String(statusOptions[index][0]===(query.get("status")||"ACTIVE"))));
    }
    function renderStats() {
      const totals=data.totals||{},quantity=totals.quantity??totals.activeQuantity??0,known=totals.knownValueQuantity??0;
      count.textContent=countLabel(quantity,"item","itens");
      replace(stats,el("div",{class:"collection-stats","aria-label":"Resumo da coleção"},
        el("div",{class:"collection-stat"},el("span",{},"Valor estimado"),
          el("strong",{},known?money(totals.estimatedValueCents??0):[
            el("span",{"aria-hidden":"true"},"—"),el("span",{class:"sr-only"},"Sem estimativa disponível")
          ]),
          known>0&&known<quantity?el("small",{},"Parcial"):null),
        el("div",{class:"collection-stat"},el("span",{},"Valor gasto"),el("strong",{},money(totals.paidCents??totals.knownCostCents??0)))));
    }
    function renderSelection() {
      selection.hidden=!selecting||!selected.size;
      if(selection.hidden){replace(selection);return;}
      replace(selection,el("strong",{},countLabel(selected.size,"item selecionado","itens selecionados")),
        button("Limpar",()=>{selected.clear();renderResults();},"shop-button secondary"),
        button("Editar custo",()=>bulkCost([...selected.values()]),"shop-button secondary"),
        button("Registrar saída",()=>sell([...selected.values()]),"shop-button secondary"),
        button("Arquivar",()=>confirm("Arquivar itens",`Arquivar ${selected.size} registros? Eles saem dos totais ativos e podem ser restaurados.`,()=>mutate({action:"archive",ids:[...selected.keys()]})),"shop-button secondary"),
        button("Restaurar",()=>confirm("Restaurar itens","Restaurar os itens selecionados para sua coleção?",()=>mutate({action:"restore",ids:[...selected.keys()]})),"shop-button secondary"));
    }
    function itemNode(item) {
      const name=title(item),marked=selected.has(item.id),condition=item.condition;
      const identity=[setName(item)!=="Sem coleção"?setName(item):null,number(item)].filter(Boolean).join(" · ");
      const kind=label(types,item.itemType);
      const captionId=`collection-caption-${item.id}`,statusId=`collection-status-${item.id}`;
      const facts=[
        condition?el("span",{class:"collection-item-condition",title:label(conditions,condition)},condition==="SEALED"?"Lacrado":condition==="OPENED"?"Aberto":condition==="CUSTOM"?"Personalizado":condition):null,
        item.quantity>1?el("span",{class:"collection-item-quantity","aria-label":countLabel(item.quantity,"exemplar","exemplares")},`${item.quantity}×`):null,
        Number.isFinite(item.paidCents)?el("span",{class:"collection-item-cost"},el("small",{},item.quantity>1?"Pago por un.":"Pago"),el("strong",{},money(item.paidCents))):null
      ].filter(Boolean);
      const itemInfo=el("span",{class:"collection-item-copy"},
        el("strong",{class:"collection-item-title"},name),
        el("span",{class:"collection-item-caption",id:captionId},
          identity||item.kind!=="CARD"?el("span",{class:"collection-item-set"},identity||kind):null,
          facts.length?el("span",{class:"collection-item-facts"},facts):null,
          view==="detailed"?el("span",{class:"collection-item-extra"},[label(languages,item.language),item.kind==="CARD"?label(finishes,item.variant):kind,item.card?.rarity,item.card?.illustrator,item.acquiredAt?date(item.acquiredAt):null].filter(Boolean).join(" · ")):null));
      const node=el("article",{class:`collection-item${marked?" is-selected":""}`,"data-item-id":item.id});
      const caption=`${statusId} ${captionId}`;
      const content=[
        el("span",{class:"collection-photo"},thumb(item)),
        el("span",{class:`collection-item-status status-${item.status}`,id:statusId},status(item)),
        itemInfo
      ];
      if(selecting){
        const check=el("input",{type:"checkbox",checked:marked,"aria-label":`Selecionar ${name}`,"aria-describedby":caption,onChange:event=>{
          if(event.target.checked)selected.set(item.id,item);
          else selected.delete(item.id);
          node.classList.toggle("is-selected",event.target.checked);
          renderSelection();
        }});
        append(node,el("label",{class:"collection-inventory-card"},content,el("span",{class:"collection-check"},check)));
      }else append(node,button(content,()=>detail(item),"collection-inventory-card",{"aria-label":`Ver detalhes de ${name}`,"aria-describedby":caption}));
      return node;
    }
    function groupKey(item,name) {if(name==='set')return item.setId||((item.card?.setName||item.setName)?'manual:'+(item.card?.setName||item.setName):'unknown');if(name==='rarity')return item.card?.rarity||'unknown';if(name==='illustrator')return item.card?.illustrator||'unknown';if(name==='status')return item.status;if(name==='pokemon')return arr(item.card?.dexNumbers).length?'dex-'+item.card.dexNumbers[0]:item.kind==='CARD'?'non-pokemon':item.kind;return 'all';}
    function renderResults() {
      results.className=`collection-results view-${view}`;
      const items=arr(data.items),grouping=query.get("group")||"none";
      selectToggle.disabled=!selecting&&!items.length;
      selectToggle.textContent=selecting?"Concluir":"Selecionar";
      selectToggle.setAttribute("aria-pressed",String(selecting));
      selectTools.hidden=!selecting||!items.length;
      refreshButton.hidden=!items.some(item=>item.kind==="CARD");
      if(!items.length){
        const filtered=filterEntries().length>0;
        replace(results,filtered
          ?empty("Nenhum item encontrado.","Experimente outro termo ou limpe os filtros.",button("Limpar filtros",resetFilters,"shop-button secondary"))
          :empty(data.total?"Nenhum item nesta página.":"Sua coleção está vazia.",data.total?"Volte à página anterior.":"Adicione uma carta, um selado ou um item personalizado.",
            data.total?null:button("Adicionar primeiro item",add,"shop-button")));
      }else if(grouping==="none"){
        replace(results,el("div",{class:"collection-items"},items.map(itemNode)));
      }else{
        const groups=new Map();
        for(const item of items){
          const key=groupKey(item,grouping);
          if(!groups.has(key))groups.set(key,[]);
          groups.get(key).push(item);
        }
        replace(results,...[...groups].map(([key,rows])=>{
          const meta=arr(data.groups).find(group=>String(group.key)===key);
          const name=grouping==="status"?statuses[key]:(meta?.label||(grouping==="set"?setName(rows[0]):key==="unknown"?"Sem informação":key));
          const quantity=meta?.quantity??rows.reduce((sum,item)=>sum+(item.quantity||1),0);
          return el("details",{class:"collection-group",open:true},el("summary",{},el("strong",{},name),el("span",{},countLabel(quantity,"exemplar","exemplares"))),
            el("div",{class:"collection-items"},rows.map(itemNode)));
        }));
      }
      const pages=Math.ceil(data.total/(data.pageSize||36));
      if(pages>1)append(results,el("nav",{class:"shop-pagination","aria-label":"Páginas da coleção"},
        button("Anterior",()=>{query.set("page",String(data.page-1));load();},"shop-button secondary",{disabled:data.page<=1}),
        el("span",{},`Página ${data.page} de ${pages}`),
        button("Próxima",()=>{query.set("page",String(data.page+1));load();},"shop-button secondary",{disabled:data.page>=pages})));
      renderSelection();
    }
    async function load() {
      clearTimeout(debounce);
      controller?.abort();
      controller=new AbortController();
      const active=controller;
      results.setAttribute("aria-busy","true");
      replace(region,message("Carregando sua coleção…"));
      try {
        const next=await api(`${root}/inventory?${query}`,{signal:active.signal});
        if(active.signal.aborted||current!==generation||active!==controller||getState().user?.id!==owner)return;
        data={...next,items:arr(next.items)};
        for(const item of data.items)if(selected.has(item.id))selected.set(item.id,item);
        renderStats();
        buildFilters();
        renderResults();
        replace(region);
      } catch(error) {
        if(error.name==="AbortError"||active!==controller||current!==generation)return;
        replace(region,message(error.message,"error"),button("Tentar novamente",load,"shop-button secondary"));
      } finally {
        if(active===controller)results.removeAttribute("aria-busy");
      }
    }
    async function mutate(body) {const payloadKey=JSON.stringify(body);if(!mutationRequests.has(payloadKey))mutationRequests.set(payloadKey,newId());const response=await api(`${root}/inventory/bulk`,{method:"POST",body:{requestId:mutationRequests.get(payloadKey),...body}});mutationRequests.delete(payloadKey);undoId=response.operationId;selected.clear();await load();if(undoId)append(region,message("Alteração salva no seu histórico.","success"),button("Desfazer esta alteração",async event=>run(event.currentTarget,region,async()=>{await api(`${root}/inventory/bulk`,{method:'POST',body:{requestId:newId(),action:'undo',operationId:undoId}});undoId=null;await load();}),"shop-text-link"));return response;}
    function bulkCost(items) {
      let amount=null,costTouched=false,dialog;const region=notice(),mode=selectField("Como aplicar o custo","mode",[["unit","Mesmo valor por exemplar"],["total","Distribuir um total entre os exemplares"]],"unit"),changeDate=checkbox("Alterar a data de aquisição","changeDate",false),dateField=field("Data de aquisição (opcional)","acquiredAt","date",""),form=el("form",{class:"personal-form",onSubmit:event=>{event.preventDefault();run(form.querySelector('[type=submit]'),region,async()=>{if(!form.reportValidity())return;const values=new FormData(form);await mutate(collectionCostMutation({ids:items.map(item=>item.id),costTouched,paidCents:amount,mode:values.get('mode'),changeDate:values.get('changeDate')==='on',acquiredAt:values.get('acquiredAt')||null}));dialog.close();});}},el("p",{class:"shop-muted"},`Editar ${items.reduce((sum,item)=>sum+item.quantity,0)} exemplares. Confirme se o valor é unitário ou de todo o lote.`),mode,moneyField('paidCents','Novo custo em reais (deixe sem tocar para preservar)',null,value=>{amount=value;costTouched=true;}),changeDate,dateField,message("Os custos atuais são preservados enquanto você não editar o valor nem usar os botões. Não informar remove explicitamente o custo; Zerar registra R$ 0,00. Só a data marcada será alterada."),region,el("button",{type:"submit",class:"shop-button"},"Confirmar alterações selecionadas"));dialog=modal("Editar custo em massa",form);
    }
    function sell(items) {
      let amount=null,dialog;const region=notice(),profit=el('p',{class:'collection-profit'}),mode=selectField('Como aplicar o valor','mode',[["unit","Valor por exemplar"],["total","Valor total do lote"]],"unit"),exit=selectField('Tipo de saída','exitType',[["SALE","Venda"],["TRADE","Troca"],["DONATION","Doação"],["OTHER","Outra saída"]],"SALE"),quantity=items.length===1&&items[0].quantity>1?field('Exemplares desta saída','quantity','number',items[0].quantity,{min:1,max:items[0].quantity,required:true}):null;
      const explain=()=>{const totalQty=quantity?Number(quantity.querySelector('input').value):items.reduce((sum,item)=>sum+item.quantity,0),known=items.every(item=>item.paidCents!=null),basis=quantity?items[0].paidCents*totalQty:items.reduce((sum,item)=>sum+(item.paidCents||0)*item.quantity,0),received=mode.querySelector('select').value==='total'?amount:amount==null?null:amount*totalQty;profit.textContent=exit.querySelector('select').value==='SALE'&&known&&received!=null?`Resultado realizado: ${money(received-basis)}`:'Resultado realizado indisponível: informe custo e valor de venda para compará-los.';};
      const amountField=moneyField('amountCents','Valor da venda (opcional)',null,value=>{amount=value;explain();});mode.addEventListener('change',explain);exit.addEventListener('change',()=>{amountField.hidden=exit.querySelector('select').value!=='SALE';explain();});quantity?.addEventListener('input',explain);
      const form=el("form",{class:"personal-form",onSubmit:event=>{event.preventDefault();run(form.querySelector('[type=submit]'),region,async()=>{if(!form.reportValidity())return;const values=new FormData(form);await mutate({action:'sell',ids:items.map(item=>item.id),amountCents:values.get('exitType')==='SALE'?amount:null,mode:values.get('mode'),exitType:values.get('exitType'),date:values.get('date')||null,notes:values.get('notes')||'',...(quantity?{quantities:{[items[0].id]:Number(values.get('quantity'))}}:{})});dialog.close();});}},items.length===1?el('div',{class:'collection-sale-identity'},thumb(items[0]),el('strong',{},title(items[0]))):el('p',{},`${items.length} registros selecionados`),message('Este é um registro privado de saída da sua coleção. Ele não cria anúncio, pagamento ou pedido da loja.'),exit,quantity,mode,amountField,field('Data da saída (opcional)','date','date',''),field('Observações da saída','notes','textarea','',{maxlength:2000,rows:3}),profit,region,el('button',{type:'submit',class:'shop-button'},'Confirmar saída / registrar venda'));explain();dialog=modal(items.length===1?`Vendi ${title(items[0])}`:'Registrar saída em massa',form);
    }
    async function detail(item) {
      const content=el("div",{},el("p",{class:"shop-loading"},"Carregando detalhes…")),dialog=modal(title(item),content);
      try{
        const result=await api(`${root}/inventory/${encodeURIComponent(item.id)}`),record=result.item||item;
        if(!dialog.isConnected)return;
        const facts=[
          ["Condição",label(conditions,record.condition)],
          ["Idioma",label(languages,record.language)],
          ["Acabamento",record.kind==="CARD"?label(finishes,record.variant):null],
          ["Tipo",record.kind!=="CARD"?label(types,record.itemType):null],
          ["Quantidade",record.quantity],
          ["Valor pago por unidade",record.paidCents==null?null:money(record.paidCents)],
          ["Aquisição",record.acquiredAt?date(record.acquiredAt):null],
          ["Raridade",record.card?.rarity],
          ["Ilustração",record.card?.illustrator]
        ];
        const sale=record.status==="SOLD"?record.sale:null;
        if(sale)facts.push(["Saída",({SALE:"Venda",TRADE:"Troca",DONATION:"Doação",OTHER:"Outra saída"})[sale.exitType]||"Registrada"],
          ["Data da saída",sale.date?date(sale.date):null],["Valor recebido",sale.amountCents==null?null:money(sale.amountCents)],
          ["Custo registrado na saída",sale.costCents==null?null:money(sale.costCents)],
          ["Resultado por exemplar",sale.realizedGainCents==null?null:money(sale.realizedGainCents)]);
        const closed=record.status==="SOLD"||record.status==="ARCHIVED";
        replace(content,el("div",{class:"collection-detail"},
          photoButton(record),
          el("div",{},
            el("span",{class:"shop-badge"},status(record)),
            el("p",{class:"collection-detail-set"},[setName(record)!=="Sem coleção"?setName(record):null,number(record)].filter(Boolean).join(" · ")),
            el("dl",{class:"collection-detail-facts"},facts.filter(([,value])=>value!=null&&value!=="")
              .map(([text,value])=>el("div",{},el("dt",{},text),el("dd",{},value)))),
            roundNote(record)?el("p",{class:"shop-muted"},roundNote(record)):null,
            record.notes?el("p",{class:"collection-private-notes"},record.notes):null)),
          el("div",{class:"shop-actions collection-detail-actions"},
            button("Editar",()=>{dialog.close();edit(record,load);},"shop-button"),
            button("Duplicar exemplar",()=>{dialog.close();startDuplicate(record);},"shop-button secondary"),
            closed
              ?button("Restaurar",()=>{dialog.close();confirm("Restaurar item","Colocar este item de volta na sua coleção?",()=>mutate({action:"restore",ids:[record.id]}));},"shop-button secondary")
              :button("Registrar saída",()=>{dialog.close();sell([record]);},"shop-button secondary")),
          el("details",{class:"collection-inventory-advanced"},el("summary",{},"Histórico e outras ações"),
            eventsNode(result.events),
            el("div",{class:"shop-actions collection-detail-actions"},
              record.status!=="ARCHIVED"?button("Arquivar",()=>{dialog.close();confirm("Arquivar item","O registro sairá dos totais ativos e poderá ser restaurado.",()=>mutate({action:"archive",ids:[record.id]}));},"shop-button secondary"):null,
              button("Excluir permanentemente",()=>{dialog.close();confirm("Excluir permanentemente","O exemplar será removido permanentemente do inventário. A trilha de operações é mantida para auditoria; esta exclusão não pode ser desfeita.",async()=>{
                await api(`${root}/inventory/${encodeURIComponent(record.id)}`,{method:"DELETE",body:{confirmation:"EXCLUIR"}});
                await load();
              },{strong:true});},"shop-text-link"))));
      }catch(error){
        if(dialog.isConnected)replace(content,message(error.message,"error"),button("Tentar novamente",()=>{dialog.close();detail(item);},"shop-button secondary"));
      }
    }
    function startDuplicate(item) {const draft={...item,id:undefined,quantity:1,status:'IN_COLLECTION',sale:undefined,events:undefined,manualValueCents:null,manualQuotedAt:null,localId:newId(),touched:{}};const storageKey=collectionDraftKey(owner),previous=readLocal(storageKey),queue=previous?.owner===owner?arr(previous.queue):[];queue.push(draft);saveLocal(storageKey,{owner,queue,updatedAt:Date.now(),step:'details',index:queue.length-1,requestId:newId()});navigate(`${route}/adicionar`);}
    async function history() {const content=el('div',{},message('Carregando movimentações…')),dialog=modal('Histórico da minha coleção',content);try{const result=await api(`${root}/inventory/events?pageSize=60`);if(dialog.isConnected)replace(content,eventsNode(result.items||result.events),message('As saídas registradas aqui são particulares e não geram pedidos na loja.'));}catch(error){replace(content,message(error.message,'error'));}}
    cleanup=()=>{controller?.abort();clearTimeout(debounce);};await load();return container;
  }
  function eventsNode(events) {return arr(events).length?el('ol',{class:'collection-events'},events.map(event=>{const action=event.action||event.kind;return el('li',{},el('strong',{},event.label||({ADD:'Adicionado',CREATE:'Adicionado',EDIT:'Editado',COST:'Custo atualizado',SELL:'Saída registrada',ARCHIVE:'Arquivado',RESTORE:'Restaurado',UNDO:'Alteração desfeita',DELETE:'Excluído'})[action]||'Atualização'),el('span',{},event.after?.card?.name||event.before?.card?.name||''),el('span',{},event.createdAt?new Date(event.createdAt).toLocaleString('pt-BR'):'Data não informada'),event.notes?el('p',{},event.notes):null);})):el('p',{class:'shop-muted'},'Nenhuma movimentação anterior registrada.');}

  function identityNode(item) {return el('div',{class:'collection-identity'},photoButton(item),el('div',{},el('p',{class:'shop-kicker'},item.kind==='CARD'?'CARTA POKÉMON':item.kind==='SEALED'?'PRODUTO SELADO':'ITEM PERSONALIZADO'),el('h3',{},title(item)),el('p',{},`${setName(item)} · ${number(item)}`),el('p',{class:'shop-muted'},[item.card?.series,item.card?.rarity,item.card?.illustrator].filter(Boolean).join(' · '))));}
  function photoFields(item,change) {
    const saved=el('div',{class:'collection-saved-photo'}),region=notice(),privatePhoto=url=>/^\/api\/account\/collection\/photos\/[a-f0-9-]+$/i.test(url||'');
    const linkField=field('Link da imagem','photoUrl','url',privatePhoto(item.photoUrl)?'':item.photoUrl||'',{maxlength:2000,placeholder:'https://…'}),linkInput=linkField.querySelector('input');
    const uploadField=field('Enviar uma imagem','photoFile','file','',{accept:'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp'}),input=uploadField.querySelector('input');
    let pending;
    const showSaved=()=>replace(saved,item.photoUrl?el('div',{},thumb(item),el('span',{},'Foto selecionada'),button('Remover foto',()=>{cancelUpload();linkInput.value='';linkInput.setCustomValidity('');change('photoUrl','');replace(region);showSaved();},'shop-text-link')):null);
    const cancelUpload=()=>{pending?.abort();pending=null;input.setCustomValidity('');};
    linkInput.addEventListener('input',()=>{
      cancelUpload();replace(region);const value=linkInput.value.trim();let valid=!value;
      try{const url=new URL(value);valid=url.protocol==='https:'&&!url.username&&!url.password;}catch{}
      linkInput.setCustomValidity(valid?'':'Use um link HTTPS válido para a imagem.');
      if(valid&&(value||!privatePhoto(item.photoUrl)))change('photoUrl',value);
    });
    linkInput.addEventListener('change',showSaved);
    input.addEventListener('change',async()=>{
      cancelUpload();const file=input.files?.[0];input.value='';if(!file)return;
      const mime=file.type||({png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'})[file.name.split('.').at(-1)?.toLowerCase()];
      if(!['image/png','image/jpeg','image/webp'].includes(mime)||!file.size||file.size>2*1024*1024){replace(region,message('Escolha uma imagem PNG, JPEG ou WebP de até 2 MB.','error'));return;}
      const active=new AbortController();pending=active;input.setCustomValidity('Aguarde o envio da foto.');replace(region,el('p',{class:'shop-muted'},'Enviando foto…'));
      try{
        const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let offset=0;offset<bytes.length;offset+=16384)binary+=String.fromCharCode(...bytes.subarray(offset,offset+16384));
        if(active.signal.aborted||!input.isConnected)return;
        const response=await api(`${root}/photos`,{method:'POST',body:{data:btoa(binary),mime},signal:active.signal});
        if(active.signal.aborted||!input.isConnected)return;
        if(!privatePhoto(response.url))throw new Error('Não foi possível confirmar a foto enviada.');
        linkInput.value='';linkInput.setCustomValidity('');change('photoUrl',response.url);showSaved();replace(region,el('p',{class:'shop-muted'},'Foto enviada.'));
      }catch(error){if(!active.signal.aborted&&input.isConnected)replace(region,message(error.message,'error'));}
      finally{if(pending===active){pending=null;input.setCustomValidity('');}}
    });
    showSaved();return el('details',{class:'collection-photo-fields',open:!!item.photoUrl},el('summary',{},'Foto do exemplar (opcional)'),el('div',{class:'collection-photo-inputs'},uploadField,el('p',{class:'shop-muted'},'PNG, JPEG ou WebP, até 2 MB. Você também pode usar um link.'),linkField,saved,region));
  }
  function detailFields(item,onChange,{allowManualValue=false}={}) {
    const touched=name=>{item.touched={...item.touched,[name]:true};},change=(name,value)=>{item[name]=value;touched(name);onChange?.();},invalid=name=>error=>{item.errors={...item.errors};error?item.errors[name]=error:delete item.errors[name];onChange?.();};
    const lang=selectField('Idioma do exemplar','language',languages,item.language||'pt'),type=selectField('Tipo de item','itemType',item.kind==='CARD'?types.filter(([key])=>key==='SINGLE'):[['','Selecione o tipo'],...types.filter(([key])=>key!=='SINGLE'&&(item.kind!=='SEALED'||key!=='CUSTOM'))],item.itemType|| (item.kind==='CARD'?'SINGLE':''),{required:true});
    lang.querySelector('select').addEventListener('change',event=>{change('language',event.target.value);replace(warning,roundNote(item)?message(roundNote(item)):null);});type.querySelector('select').addEventListener('change',event=>change('itemType',event.target.value));
    const condition=el('fieldset',{class:'collection-choice-group'},el('legend',{},'Conservação / condição'),...(item.kind==='CARD'?[...conditions,...(item.condition==='LP'?[['LP','Levemente jogada — registro anterior']]:item.condition==='DMG'?[['DMG','Danificada — registro anterior']]:[])]:item.kind==='SEALED'?[['SEALED','Lacrado'],['OPENED','Aberto']]:[['CUSTOM','Descrita nas observações'],['M','Excelente'],['SP','Com marcas de uso'],['D','Danificado']]).map(([id,text])=>{const input=el('input',{type:'radio',name:'condition',value:id,checked:item.condition===id,required:true,onChange:()=>change('condition',id)});return el('label',{class:'collection-radio',title:text},input,el('span',{},id),el('small',{},text));}));
    const acquired=field('Data de aquisição (opcional)','acquiredAt','date',item.acquiredAt||''),notes=field('Observações privadas','notes','textarea',item.notes||'',{rows:3,maxlength:2000}),warning=notice();
    acquired.querySelector('input').addEventListener('change',event=>change('acquiredAt',event.target.value||null));notes.querySelector('textarea').addEventListener('input',event=>change('notes',event.target.value));replace(warning,roundNote(item)?message(roundNote(item)):null);
    const finish=selectField('Acabamento','variant',finishes,item.variant||'NORMAL');finish.querySelector('select').addEventListener('change',event=>change('variant',event.target.value));
    const attr=el('fieldset',{class:'collection-choice-group'},el('legend',{},'Atributos adicionais'),attributes.map(([id,text])=>{const node=checkbox(text,`attribute-${id}`,arr(item.attributes).includes(id));node.querySelector('input').addEventListener('change',event=>change('attributes',event.target.checked?[...new Set([...arr(item.attributes),id])]:arr(item.attributes).filter(value=>value!==id)));return node;}));
    const manual=allowManualValue?el('details',{class:'collection-manual-value'},el('summary',{},'Informar meu próprio valor de referência'),moneyField('manualValueCents','Referência manual unitária (R$)',item.manualValueCents??null,value=>change('manualValueCents',value),invalid('manualValueCents'))):null;
    const manualIdentity=item.kind==='CUSTOM'||item.kind==='SEALED'&&!item.sealedId&&!item.card?.sealedId?el('div',{class:'collection-manual-identity'},...[['Nome do item','title','text',title(item)],['Coleção ou linha','setName','text',setName(item)==='Sem coleção'?'':setName(item)],['Descrição','description','textarea',item.description||item.card?.description||'']].map(([text,name,type,value])=>{const node=field(text,name,type,value,{required:name==='title',maxlength:name==='description'?2000:200,rows:type==='textarea'?3:undefined});node.querySelector('input,textarea').addEventListener('input',event=>{if(name==='setName'){item.card={...item.card,setName:event.target.value};touched(name);onChange?.();}else change(name,event.target.value);});return node;})):null;
    return el('div',{class:'collection-detail-fields'},manualIdentity,el('div',{class:'shop-form-grid'},type,lang),warning,condition,moneyField('paidCents','Valor pago por exemplar (R$, opcional)',item.paidCents??null,value=>change('paidCents',value),invalid('paidCents')),acquired,item.kind==='CARD'?el('div',{class:'collection-finish-fields'},finish,el('details',{class:'collection-extra-fields'},el('summary',{},'Atributos adicionais (opcional)'),attr)):null,notes,photoFields(item,change),manual);
  }
  function edit(record,onSaved) {let item=structuredClone(record),requestId=newId(),dialog;const region=notice(),form=el('form',{class:'personal-form',onSubmit:event=>{event.preventDefault();run(form.querySelector('[type=submit]'),region,async()=>{if(!form.reportValidity())return;const payload=collectionBatchPayload([item],newId()).items[0];delete payload.quantity;if(!item.touched?.manualValueCents)delete payload.manualValueCents;payload.requestId=requestId;payload.revision=record.revision;await api(`${root}/inventory/${encodeURIComponent(record.id)}`,{method:'PUT',body:payload});dialog.close();toast('Exemplar atualizado.');await onSaved?.();});}},identityNode(item),detailFields(item,()=>requestId=newId(),{allowManualValue:true}),region,el('button',{type:'submit',class:'shop-button'},'Salvar alterações'));dialog=modal(`Editar ${title(record)}`,form);}

  async function wizard() {
    const owner=getState().user.id,key=collectionDraftKey(owner),draft=readLocal(key),valid=draft?.owner===owner&&Date.now()-draft.updatedAt<7*86400000;let queue=valid?arr(draft.queue):[],step=valid?draft.step||'choose':'choose',index=Math.min(valid?draft.index||0:0,Math.max(queue.length-1,0)),requestId=valid?draft.requestId||newId():newId(),queueOpen=false,copyUndo=null,replaceIndex=null;
    const current=++generation,page=el('section',{class:'collection-wizard'}),main=el('div',{class:'collection-wizard-main'}),sidebar=el('aside',{class:'collection-queue',id:'collection-wizard-queue','aria-label':'Fila de itens'}),region=notice();
    const queries=new Map(),resultCache=new Map();let searchAbort,searchSchedule,detailsAbort,refreshSearchCounts;
    const save=()=>{if(getState().user?.id!==owner)return;saveLocal(key,{owner,queue,step,index,requestId,updatedAt:Date.now()});};
    const changed=()=>{requestId=newId();save();renderQueue();};
    const goto=value=>{
      queueOpen=false;step=value;save();render();
      main.scrollIntoView({block:'start'});main.querySelector('h2')?.focus({preventScroll:true});
    };
    function startDetails() {const pending=queue.findIndex(item=>!item.condition||!item.itemType||Object.keys(item.errors||{}).length);index=pending<0?0:pending;goto('details');}
    let queueTrigger;
    function closeQueue() {queueOpen=false;renderQueue();queueTrigger?.focus();}
    function openQueue(event) {
      if(queueOpen){closeQueue();return;}
      queueTrigger=event.currentTarget;queueOpen=true;renderQueue();sidebar.querySelector('.collection-queue-close')?.focus();
    }
    const queueControls={'aria-expanded':'false','aria-controls':'collection-wizard-queue'};
    const queueToggle=button('Fila (0)',openQueue,'shop-button secondary collection-queue-toggle',queueControls);
    const queueCount=button('',openQueue,'collection-continue-count',{...queueControls,'aria-live':'polite'});
    const continueButton=button('Preencher detalhes',startDetails,'shop-button collection-wizard-primary');
    const continueBar=el('div',{class:'collection-wizard-continue',hidden:true},queueCount,continueButton);
    const header=el('div',{class:'collection-heading collection-wizard-heading'},button('‹ Minha coleção',()=>navigate(route),'shop-text-link'),el('h1',{},'Adicionar à coleção'),queueToggle);
    append(page,header,el('ol',{class:'collection-steps','aria-label':'Etapas para adicionar um item'},['Tipo','Buscar','Detalhar','Revisar'].map((text,i)=>el('li',{'data-step':i},text))),region,el('div',{class:'collection-wizard-layout'},main,sidebar),continueBar);
    const newQueueItem=(kind,card={})=>({localId:newId(),kind,cardId:kind==='CARD'?(card.providerId||card.id):undefined,setId:card.setId||'',sealedId:kind==='SEALED'?card.id:undefined,card:kind==='CARD'?card:{name:card.name||'',setName:card.setName||'',image:card.image||'',sealedId:card.sealedId},title:card.name||'',language:card.language||'pt',referenceLanguage:card.referenceLanguage||card.language||'pt',condition:'',variant:card.availableVariants?.length===1?card.availableVariants[0]:'NORMAL',attributes:[],quantity:1,paidCents:null,acquiredAt:null,manualValueCents:null,notes:'',photoUrl:'',itemType:kind==='CARD'?'SINGLE':card.itemType||(kind==='SEALED'?'':'CUSTOM'),needsCardDetails:kind==='CARD'&&!Array.isArray(card.availableVariants),touched:{}});
    function renderQueue() {
      const count=countLabel(queue.length,'item selecionado','itens selecionados'),canContinue=!!queue.length&&['choose','cards','sealed'].includes(step)&&replaceIndex==null;
      if(queueCount.textContent!==count)queueCount.textContent=count;
      queueCount.setAttribute('aria-expanded',String(queueOpen));
      continueBar.hidden=!canContinue||queueOpen;
      page.classList.toggle('has-collection-continue',canContinue);
      sidebar.classList.toggle('is-open',queueOpen);queueToggle.textContent=`Fila (${queue.length})`;queueToggle.setAttribute('aria-expanded',String(queueOpen));
      const heading=el('div',{class:'collection-queue-heading'},
        button('×',closeQueue,'shop-text-link collection-queue-close',{'aria-label':'Fechar fila'}),
        el('h2',{},countLabel(queue.length,'item na fila','itens na fila')),
        button('Adicionar mais',()=>{replaceIndex=null;goto('choose');},'shop-text-link'),
        button('Limpar',()=>confirm('Limpar fila','Remover todos os itens deste rascunho?',()=>{queue=[];replaceIndex=null;changed();goto('choose');}),'shop-text-link',{disabled:!queue.length}));
      const list=queue.length?el('ol',{class:'collection-queue-list'},queue.map(queueRow)):el('div',{class:'collection-queue-empty'},svgIcon('collection'),el('p',{},'Os itens selecionados aparecem aqui.'));
      replace(sidebar,heading,list,canContinue?el('div',{class:'collection-queue-footer'},button('Preencher detalhes',startDetails,'shop-button collection-wizard-primary')):null);
      refreshSearchCounts?.();
    }
    function queueRow(item,i) {
      const open=button([el('span',{class:'collection-queue-index'},String(i+1)),thumb(item),el('span',{},el('strong',{},title(item)),el('small',{},`${item.condition||'Condição pendente'} · ${label(languages,item.language)}`))],()=>{index=i;replaceIndex=null;goto('details');},'collection-queue-item');
      const remove=button('×',()=>{
        queue.splice(i,1);
        if(i<index)index--;
        index=Math.min(index,Math.max(queue.length-1,0));
        const replacing=replaceIndex!=null;replaceIndex=null;changed();
        if(!queue.length)goto('choose');else if(replacing||step==='details'||step==='review')render();
        if(queueOpen)sidebar.querySelector('.collection-queue-close')?.focus();
      },'collection-remove',{'aria-label':`Remover ${title(item)} da fila`});
      const duplicate=button('+',()=>{
        if(queue.length>=100){replace(region,message('A fila aceita até 100 exemplares.','error'));return;}
        queue.splice(i+1,0,{...structuredClone(item),localId:newId()});
        if(i<index)index++;
        if(replaceIndex!=null&&i<replaceIndex)replaceIndex++;
        changed();if(step==='details'||step==='review')render();
        if(queueOpen)sidebar.querySelector('.collection-queue-close')?.focus();
      },'collection-duplicate',{'aria-label':`Repetir ${title(item)} na fila`});
      return el('li',{class:index===i&&step==='details'?'is-editing':''},open,remove,duplicate);
    }
    function choose() {replace(main,el('div',{class:'collection-type-choice'},el('h2',{tabindex:-1},'O que você quer adicionar?'),[['cards','collection','Carta','Encontre pelo nome ou número da carta.'],['sealed','bag','Selado','Boosters, decks, ETBs e outros produtos.'],['custom','plus','Personalizado','Cadastre um item fora do catálogo.']].map(([target,icon,text,description])=>button([svgIcon(icon),el('span',{},el('strong',{},text),el('small',{},description)),el('span',{'aria-hidden':true},'›')],()=>{replaceIndex=null;goto(target);},'collection-type-button'))));}
    function add(card,kind) {
      if(replaceIndex!=null){const prior=queue[replaceIndex];queue[replaceIndex]={...prior,cardId:card.providerId||card.id,setId:card.setId,card,title:card.name,referenceLanguage:card.referenceLanguage||card.language,needsCardDetails:!Array.isArray(card.availableVariants)};index=replaceIndex;replaceIndex=null;changed();goto('details');return;}
      if(queue.length>=100){replace(region,message('A fila aceita até 100 exemplares.','error'));return;}
      queue.push(newQueueItem(kind,card));changed();
    }
    function search(kind) {
      const cards=kind==='CARD',query=field(cards?'Buscar cartas':'Buscar selados','catalogQuery','search',queries.get(kind)||'',{placeholder:cards?'Ex. Pikachu ou 025/165':'Nome, coleção ou código do produto',autocomplete:'off',enterkeyhint:'search','aria-controls':'collection-search-results'}),input=query.querySelector('input'),rows=[];
      const results=el('div',{class:`collection-search-results${cards?'':' collection-search-sealed'}`,id:'collection-search-results'}),status=el('p',{class:'collection-search-status',role:'status'}),searchError=el('div',{});
      let loadedPage=0,lastRequested='';
      const more=button(cards?'Ver mais cartas':'Ver mais selados',()=>load(loadedPage+1),'shop-button secondary collection-search-more',{hidden:true});
      const back=button(replaceIndex==null?'‹ Tipo':'‹ Detalhes',()=>{const replacing=replaceIndex!=null;replaceIndex=null;goto(replacing?'details':'choose');},'shop-text-link',{'aria-label':replaceIndex==null?'Escolher tipo':'Voltar aos detalhes'});
      const form=el('form',{class:'collection-search-form',role:'search',onSubmit:event=>{event.preventDefault();if(input.value.trim()!==lastRequested)searchSchedule.flush();}},el('h2',{tabindex:-1},cards?'Buscar cartas':'Buscar selados'),back,query);

      const updateCounts=()=>{
        const counts=new Map();for(const item of queue){const key=cards?`${item.cardId}:${item.referenceLanguage}`:item.sealedId;if(item.kind===kind&&key)counts.set(key,(counts.get(key)||0)+1);}
        for(const {key,badge} of rows){const count=counts.get(key)||0;badge.hidden=!count;badge.textContent=count?`${count} na fila`:'';}
      };
      refreshSearchCounts=updateCounts;
      function result(card) {
        const item={card,title:card.name,kind,language:card.language,referenceLanguage:card.referenceLanguage},key=cards?`${card.providerId||card.id}:${card.referenceLanguage||card.language}`:card.id;
        const badge=el('span',{class:'collection-queued-count',hidden:true}),code=card.displayNumber||card.number||card.sku,collection=card.setName||card.setCode||card.setId;
        const action=button([svgIcon('plus'),el('span',{},replaceIndex==null?'Adicionar':'Selecionar')],()=>{input.blur();add(card,kind);},'shop-button secondary collection-search-add',{'aria-label':`${replaceIndex==null?'Adicionar':'Selecionar'} ${card.name}${code?` ${code}`:''}${collection?` de ${collection}`:''}`});
        const thumbnail=card.imageSmall?{...item,card:{...card,image:card.imageSmall}}:item;
        const photo=pic(thumbnail)?button(thumb(thumbnail),()=>preview(item),'collection-photo',{'aria-label':`Ampliar imagem de ${card.name}`}):el('span',{class:'collection-photo collection-search-missing'},'Sem imagem');
        rows.push({key,badge});
        return el('article',{class:'collection-search-result'},photo,el('div',{class:'collection-search-copy'},el('strong',{},card.name),code?el('p',{class:'collection-search-code'},code):null,collection?el('p',{class:'collection-search-set'},collection):null,badge),action);
      }
      function reset() {rows.length=0;loadedPage=0;lastRequested='';replace(results);replace(searchError);more.hidden=true;results.removeAttribute('aria-busy');}
      async function load(pageNumber=1) {
        const value=input.value.trim();if(!value)return;
        searchAbort?.abort();const active=new AbortController();searchAbort=active;
        const isCurrent=()=>!active.signal.aborted&&current===generation&&active===searchAbort&&main.contains(form)&&value===input.value.trim();
        lastRequested=value;status.textContent=pageNumber===1?'Buscando…':'Carregando mais resultados…';replace(searchError);results.setAttribute('aria-busy','true');more.disabled=true;
        const params=new URLSearchParams({q:value,page:String(pageNumber),pageSize:'12',live:'1'});if(cards)params.set('view','quick');
        const request=`${root}/catalog/${cards?'search':'sealed'}?${params}`;
        try {
          const cached=resultCache.get(request),data=cached&&Date.now()-cached.at<60000?cached.data:await api(request,{signal:active.signal});if(!isCurrent())return;
          if(!cached||cached.data!==data){resultCache.set(request,{data,at:Date.now()});if(resultCache.size>30)resultCache.delete(resultCache.keys().next().value);}
          if(pageNumber===1){rows.length=0;replace(results);}
          append(results,arr(data.items).map(result));updateCounts();loadedPage=pageNumber;
          const count=data.total??rows.length;
          status.textContent=count?`${countLabel(count,'resultado','resultados')}${data.languageFallback?' · referências em inglês':''}${data.stale?' · catálogo em cache':''}`:cards?'Nenhuma carta encontrada. Tente outro nome ou número.':'Nenhum selado encontrado. Você pode cadastrar o seu item.';
          more.hidden=rows.length>=count||!arr(data.items).length;
        } catch(error) {
          if(error.name==='AbortError'||!isCurrent())return;
          status.textContent='';replace(searchError,el('p',{role:'alert',class:'collection-search-error'},'Não foi possível buscar no catálogo.'),button('Tentar novamente',()=>load(pageNumber),'shop-button secondary'));
        } finally {if(isCurrent()){results.removeAttribute('aria-busy');more.disabled=false;}}
      }
      function onInput(event) {
        if(event?.isComposing)return;searchAbort?.abort();searchSchedule.cancel();queries.set(kind,input.value);reset();
        const value=input.value.trim();status.textContent=value?'Buscando…':cards?'Digite o nome ou número impresso na carta.':'Digite o nome ou código do produto.';
        if(value)searchSchedule.schedule();
      }
      searchSchedule=createCollectionSearchScheduler(load,{delay:200});input.addEventListener('input',onInput);input.addEventListener('compositionend',onInput);
      replace(main,form,!cards?button('Não encontrei meu produto',()=>goto('sealed-custom'),'shop-text-link collection-sealed-manual'):null,status,searchError,results,more);
      if(input.value.trim())load();else onInput();
    }
    function custom(kind) {const item=newQueueItem(kind),region=notice(),form=el('form',{class:'personal-form collection-custom-form',onSubmit:event=>{event.preventDefault();if(!form.reportValidity())return;const values=new FormData(form),quantity=Number(values.get('quantity'));if(!Number.isInteger(quantity)||quantity<1||quantity>50||queue.length+quantity>100){replace(region,message('Use de 1 a 50 unidades, respeitando o limite de 100 itens na fila.','error'));return;}for(let i=0;i<quantity;i++)queue.push({...structuredClone(item),localId:newId(),title:String(values.get('title')).trim(),itemType:values.get('itemType'),description:values.get('description')||'',setId:'',card:{name:String(values.get('title')).trim(),setName:values.get('setName')||'',image:''}});changed();startDetails();}},el('h2',{tabindex:-1},kind==='SEALED'?'Seu selado personalizado':'Seu item personalizado'),button(kind==='SEALED'?'‹ Voltar à busca':'‹ Escolher tipo',()=>goto(kind==='SEALED'?'sealed':'choose'),'shop-text-link'),field('Nome do item','title','text','',{required:true,minlength:2,maxlength:200}),selectField('Categoria','itemType',types.filter(([key])=>key!=='SINGLE'&&(kind!=='SEALED'||key!=='CUSTOM')),kind==='SEALED'?'ETB':'CUSTOM'),field('Coleção ou linha (opcional)','setName','text','',{maxlength:200}),field('Descrição (opcional)','description','textarea','',{rows:3,maxlength:2000}),field('Quantidade de exemplares','quantity','number',1,{required:true,min:1,max:50}),region,el('button',{type:'submit',class:'shop-button collection-wizard-primary'},'Preencher detalhes'));replace(main,form);}
    async function enrichDetails(item,form) {
      if(!item.needsCardDetails)return;
      const active=new AbortController();detailsAbort=active;
      const params=new URLSearchParams({cardId:item.cardId,setId:item.setId,language:item.referenceLanguage,view:'quick'});
      try {
        const card=await api(`${root}/catalog/card?${params}`,{signal:active.signal});
        if(active.signal.aborted||!main.contains(form)||(card.providerId||card.id)!==item.cardId||card.setId!==item.setId)return;
        item.card={...item.card,...card};item.needsCardDetails=false;
        if(!item.touched?.variant&&card.availableVariants?.length===1){item.variant=card.availableVariants[0];form.querySelector('select[name="variant"]').value=item.variant;}
        changed();
      }catch{/* Search metadata and the manually chosen finish are enough to continue. */}
    }
    function details() {
      if(!queue.length){goto('choose');return;}
      const item=queue[index],next=index<queue.length-1;
      const form=el('form',{class:'collection-item-form',onSubmit:event=>{event.preventDefault();if(!form.reportValidity())return;if(next){index++;goto('details');}else goto('review');}});
      const back=button(index>0?'Anterior':'Voltar',()=>{if(index>0){index--;goto('details');}else goto(item.kind==='CARD'?'cards':item.sealedId?'sealed':'choose');},'shop-button secondary');
      append(form,el('h2',{tabindex:-1},'Detalhes do exemplar'),el('div',{class:'collection-item-progress'},el('strong',{},`Item ${index+1} de ${queue.length}`),el('progress',{max:queue.length,value:index+1,'aria-label':`Item ${index+1} de ${queue.length}`})),identityNode(item),item.kind==='CARD'?button('Trocar carta',()=>{replaceIndex=index;goto('cards');},'shop-text-link'):null,detailFields(item,changed));
      if(next)append(form,el('section',{class:'collection-copy'},el('h3',{},'Comprou tudo igual?'),el('p',{},'Copie custo, data, condição, idioma e acabamento para os próximos itens.'),button('Aplicar aos itens restantes',()=>{let dialog;const overwrite=checkbox('Sobrescrever também campos já preenchidos','overwrite',false);dialog=modal('Aplicar dados aos itens restantes',el('form',{class:'personal-form',onSubmit:event=>{event.preventDefault();copyUndo=structuredClone(queue);queue=collectionCopyAcquisition(queue,index,{overwrite:overwrite.querySelector('input').checked});changed();dialog.close();render();}},overwrite,el('button',{type:'submit',class:'shop-button'},'Confirmar cópia')));},'shop-button secondary'),copyUndo?button('Desfazer cópia',()=>{queue=copyUndo;copyUndo=null;changed();render();},'shop-text-link'):null));
      append(form,el('div',{class:'collection-form-footer'},back,el('button',{type:'submit',class:'shop-button collection-wizard-primary'},next?'Próximo item':`Revisar ${countLabel(queue.length,'item','itens')}`)));
      replace(main,form);enrichDetails(item,form);
    }
    function review() {
      const totals=collectionQueueTotals(queue),errors=queue.flatMap((item,i)=>[...(!item.condition?[`Item ${i+1}: selecione a condição.`]:[]),...(!item.itemType?[`Item ${i+1}: selecione o tipo de item.`]:[]),...Object.values(item.errors||{}).map(text=>`Item ${i+1}: ${text}`)]);
      const form=el('form',{class:'collection-review',onSubmit:event=>{event.preventDefault();run(form.querySelector('[type=submit]'),region,async()=>{if(errors.length||!queue.length)throw new Error('Revise os itens antes de salvar.');if(getState().user?.id!==owner)throw new Error('A sessão mudou. Entre novamente antes de salvar.');const submittedRequest=requestId,payload=collectionBatchPayload(queue,submittedRequest);page.inert=true;page.setAttribute('aria-busy','true');replace(region,message('Salvando exemplares…'));try{const response=await api(`${root}/inventory/batch`,{method:'POST',body:payload});if(readLocal(key)?.requestId===submittedRequest)localStorage.removeItem(key);if(current!==generation||getState().user?.id!==owner)return;toast(`${countLabel(response.added??queue.length,'item adicionado','itens adicionados')} à sua coleção.`);queue=[];cleanup=()=>{};navigate(route);}finally{page.inert=false;page.removeAttribute('aria-busy');}});}},el('h2',{tabindex:-1},'Revisar e adicionar'),el('div',{class:'collection-review-totals'},el('span',{},countLabel(totals.quantity,'exemplar','exemplares')),el('strong',{},totals.unknownCost===totals.quantity?'Sem valor pago informado':`Valor pago: ${money(totals.knownCost)}`)),errors.length?message(errors.join(' '),'error'):null,el('div',{class:'collection-review-items'},queue.map((item,i)=>el('article',{},thumb(item),el('div',{},el('strong',{},title(item)),el('p',{},[setName(item),number(item)].filter(Boolean).join(' · ')),el('p',{},[label(languages,item.language),item.condition||'Condição pendente',item.kind==='CARD'?label(finishes,item.variant):null].filter(Boolean).join(' · ')),item.paidCents!=null?el('p',{class:'collection-item-cost'},`Pago: ${money(item.paidCents)}`):null,item.acquiredAt?el('p',{},`Aquisição: ${date(item.acquiredAt)}`):null,item.notes?el('p',{},item.notes):null,button(`Editar item ${i+1}`,()=>{index=i;goto('details');},'shop-text-link'))))),el('div',{class:'collection-form-footer'},el('button',{type:'submit',class:'shop-button collection-wizard-primary',disabled:errors.length>0||!queue.length},`Adicionar ${countLabel(totals.quantity,'item','itens')} à coleção`)));
      replace(main,form);
    }
    function stopRequests() {searchAbort?.abort();searchSchedule?.dispose();detailsAbort?.abort();refreshSearchCounts=null;}
    function render() {
      if(current!==generation)return;stopRequests();replace(region);
      const activeStep=({choose:0,cards:1,sealed:1,custom:1,'sealed-custom':1,details:2,review:3})[step];
      page.querySelectorAll('.collection-steps li').forEach((node,i)=>{node.classList.toggle('active',i===activeStep);i===activeStep?node.setAttribute('aria-current','step'):node.removeAttribute('aria-current');});
      renderQueue();if(step==='choose')choose();else if(step==='cards')search('CARD');else if(step==='sealed')search('SEALED');else if(step==='custom')custom('CUSTOM');else if(step==='sealed-custom')custom('SEALED');else if(step==='details')details();else review();
    }
    const closeQueueOnEscape=event=>{if(event.key==='Escape'&&queueOpen)closeQueue();};page.addEventListener('keydown',closeQueueOnEscape);
    cleanup=()=>{page.removeEventListener('keydown',closeQueueOnEscape);stopRequests();save();};render();return page;
  }
  return {dashboard,wizard};
}
