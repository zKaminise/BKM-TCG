const navMount = document.querySelector("#store-nav");
const mount = document.querySelector("#storefront");
const overlay = document.querySelector("#store-overlay");
const experience = document.querySelector(".experience");
const money = (value) => Number.isFinite(value) ? (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "A calcular";
const asArray = (value) => Array.isArray(value) ? value : [];
const languages = { pt: "Portugu\xEAs", en: "Ingl\xEAs", ja: "Japon\xEAs", es: "Espanhol", fr: "Franc\xEAs", de: "Alem\xE3o", it: "Italiano", ko: "Coreano", zh: "Chin\xEAs" };
const conditions = { NM: "Near Mint", LP: "Levemente jogada", MP: "Moderadamente jogada", HP: "Muito jogada", DMG: "Danificada", SEALED: "Lacrado" };
const finishes = { NORMAL: "Normal", HOLO: "Holo", REVERSE: "Reverse holo", FOIL: "Foil" };
const paymentLabels = {APPROVED:"Aprovado",PENDING:"Pendente",REJECTED:"Recusado",CANCELLED:"Cancelado",EXPIRED:"Expirado",REVIEW:"Em análise",REFUNDED:"Estornado",CHARGEBACK:"Contestado"};
const orderLabels = {CONFIRMED:"Confirmado",PENDING:"Aguardando pagamento",PAYMENT_REVIEW:"Pagamento em análise",CANCELLED:"Cancelado",EXPIRED:"Expirado",PROCESSING:"Em preparação",SHIPPED:"Enviado",DELIVERED:"Entregue",UNFULFILLED:"A preparar"};
const isLocalHost = () => ["localhost","127.0.0.1","::1","[::1]", ""].includes(location.hostname);
const isDemo = () => state.config.demo === true || state.config.environment === "demo" || (!state.apiReady && !isLocalHost());
const demoNotice = () => isDemo() ? el("div",{class:"shop-demo-note"},el("strong",{},"AMBIENTE DE DEMONSTRAÇÃO"),el("span",{},"Produtos e valores ilustrativos. Pedidos de teste, sem cobranças ou envios reais.")) : null;
const icons = { search: "\u2315", heart: "\u2661", bag: "\u25B1", user: "\u25EF", menu: "\u2630", close: "\xD7", arrow: "\u2197", plus: "+", minus: "\u2212" };
let pageVersion = 0;
let routeCleanup=null;
let mercadoPagoSdkPromise=null;
let state = { user: null, csrfToken: "", config: {}, apiReady: false, cart: asArray(readLocal("bkm-cart-v1", [])).filter(item => item && typeof item.variantId === "string" && Number.isInteger(item.quantity) && item.quantity > 0), favorites: asArray(readLocal("bkm-favorites-v1", [])).filter(item => item && typeof item.id === "string" && typeof item.slug === "string"), drawer: false };
let catalogCache = /* @__PURE__ */ new Map();
function readLocal(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function persist() {
  try {
    localStorage.setItem("bkm-cart-v1", JSON.stringify(state.cart));
    localStorage.setItem("bkm-favorites-v1", JSON.stringify(state.favorites));
  } catch {
    toast("O navegador n\xE3o permitiu salvar suas prefer\xEAncias.");
  }
  if (state.user && state.apiReady && !state.syncing) scheduleAccountSave();
}
let accountSaveTimer;
function scheduleAccountSave() {
  clearTimeout(accountSaveTimer);
  accountSaveTimer = setTimeout(async () => {
    if (!state.user) return;
    try {
      await Promise.all([
        api("/account/cart", {method:"PUT", body:{items:state.cart.map(item => ({variantId:item.variantId,quantity:item.quantity}))}}),
        api("/account/favorites", {method:"PUT", body:{items:state.favorites.map(item => item.id)}})
      ]);
    } catch (error) { toast(`Não foi possível sincronizar a conta: ${displayError(error)}`); }
  }, 450);
}
async function syncAccount() {
  if (!state.user) return;
  state.syncing = true;
  try {
    const [cart,favorites] = await Promise.all([api("/account/cart"),api("/account/favorites")]);
    const products = new Map([...asArray(cart.products),...asArray(favorites.products)].map(product => [product.id, product]));
    const variants = new Map([...products.values()].flatMap(product => asArray(product.variants).map(variant => [variant.id,{product,variant}])));
    for (const item of asArray(cart.items)) {
      const match = variants.get(item.variantId);
      if (!match || match.variant.stock < 1) continue;
      const existing = state.cart.find(local => local.variantId === item.variantId);
      if(existing) existing.quantity = Math.min(match.variant.stock,Math.max(existing.quantity,item.quantity));
      else state.cart.push({variantId:item.variantId,productId:match.product.id,slug:match.product.slug,name:match.product.name,image:productImage(match.product).url,language:match.variant.language,condition:match.variant.condition,finish:match.variant.finish,priceCents:match.variant.priceCents,stock:match.variant.stock,quantity:Math.min(item.quantity,match.variant.stock)});
    }
    for (const id of asArray(favorites.items)) {
      const product=products.get(typeof id === "string" ? id : id.productId);
      if(product && !state.favorites.some(item => item.id === product.id)) state.favorites.push({id:product.id,slug:product.slug,name:product.name});
    }
    await reconcileCart();
    persist();
  } catch (error) { toast(`Não foi possível carregar as escolhas da conta: ${displayError(error)}`); }
  finally { state.syncing=false; scheduleAccountSave(); }
}
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === void 0 || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === "value") node.value = value;
    else if (key === "checked") node.checked = !!value;
    else if (key === "disabled") node.disabled = !!value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === void 0 || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}
function setChildren(node,...children){node.replaceChildren(...children.flat(Infinity).filter(child=>child!==null&&child!==undefined&&child!==false));}
const link = (label, href, cls = "") => el("a", { href, class: cls, "data-route": true }, label);
const button = (label, onClick, cls = "shop-button", attrs = {}) => el("button", { type: "button", class: cls, onClick, ...attrs }, label);
const badge = (text) => el("span", { class: "shop-badge" }, text);
const message = (text, kind = "info") => el("p", { class: `shop-message ${kind}`, role: kind === "error" ? "alert" : "status" }, text);
const loading = (text) => el("div", { class: "shop-loading", role: "status" }, el("span", { class: "shop-spinner", "aria-hidden": true }), text || "Carregando sua pr\xF3xima descoberta\u2026");
function empty(title, description, action) {
  return el("div", { class: "shop-empty" }, el("span", { class: "shop-empty-mark", "aria-hidden": true }, "\u2726"), el("h2", {}, title), el("p", {}, description), action);
}
function field(label, name, type = "text", value = "", extra = {}) {
  const input = el(type === "textarea" ? "textarea" : "input", { name, id: `field-${name}-${Math.random().toString(36).slice(2, 7)}`, type: type === "textarea" ? void 0 : type, value, ...extra });
  return el("label", { class: "shop-field" }, el("span", {}, label), input);
}
function selectField(label, name, options, value = "", extra = {}) {
  const select = el("select", { name, "aria-label":label, ...extra }, options.map(([val, text]) => el("option", { value: val, selected: String(val) === String(value) }, text)));
  select.value = String(value ?? "");
  return el("label", { class: "shop-field" }, el("span", {}, label), select);
}
function checkbox(label, name, checked = false) {
  return el("label", { class: "shop-check" }, el("input", { type: "checkbox", name, checked }), el("span", {}, label));
}
function safeImage(url) {
  if (typeof url !== "string") return "";
  try {
    const parsed = new URL(url, location.href);
    return ["https:", "http:"].includes(parsed.protocol) && (!parsed.username && !parsed.password) ? parsed.href : "";
  } catch {
    return "";
  }
}
function image(url, alt, cls = "") {
  const src = safeImage(url);
  return src ? el("img", { src, alt, class: cls, loading: "lazy", decoding: "async", onError: (e) => {
    e.currentTarget.replaceWith(el("span", { class: "shop-image-missing" }, "Imagem indispon\xEDvel"));
  } }) : el("span", { class: "shop-image-missing" }, "Sem imagem");
}
function readImageDataUrl(blob){
  return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error("Não foi possível ler a imagem."));reader.readAsDataURL(blob);});
}
async function prepareImageUpload(file){
  if(file.size>8*1024*1024)throw new Error("Escolha uma imagem com até 8 MB.");
  if(!["image/png","image/jpeg","image/webp"].includes(file.type))throw new Error("Use uma imagem PNG, JPEG ou WebP.");
  // Leave room for base64 and JSON within the deployment's request-body limit.
  const uploadLimit=3*1024*1024;
  if(file.size<=uploadLimit)return{name:file.name,dataUrl:await readImageDataUrl(file)};
  toast("Otimizando a imagem para enviar com qualidade…");
  let bitmap;
  try{
    bitmap=await createImageBitmap(file);
    if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>64000000)throw new Error("Escolha uma imagem com até 64 megapixels.");
    const scale=Math.min(1,4096/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement("canvas"),context=canvas.getContext("2d",{alpha:true});
    if(!context)throw new Error("O navegador não conseguiu preparar a imagem.");
    let width=Math.max(1,Math.round(bitmap.width*scale)),height=Math.max(1,Math.round(bitmap.height*scale));
    for(let attempt=0;attempt<9;attempt++){
      canvas.width=width;canvas.height=height;context.clearRect(0,0,width,height);context.drawImage(bitmap,0,0,width,height);
      const quality=Math.max(.72,.92-attempt*.05);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/webp",quality));
      if(!blob)throw new Error("Não foi possível otimizar a imagem.");
      if(blob.size<=uploadLimit){
        const extension=blob.type==="image/webp"?"webp":blob.type==="image/jpeg"?"jpg":"png";
        return{name:file.name.replace(/\.[^.]+$/,"")+"."+extension,dataUrl:await readImageDataUrl(blob)};
      }
      if(attempt>=2){width=Math.max(1,Math.round(width*.82));height=Math.max(1,Math.round(height*.82));}
    }
    throw new Error("Reduza a imagem para até 3 MB e tente novamente.");
  }catch(error){
    throw new Error(error?.message||"Não foi possível preparar a imagem. Tente um arquivo WebP ou JPEG menor.");
  }finally{bitmap?.close();}
}
function productImage(product) {
  return asArray(product.images).find((img) => img.kind === "actual") || asArray(product.images)[0] || {};
}
function lowest(product) {
  const variants = asArray(product.variants);
  return variants.length ? Math.min(...variants.map((v) => v.priceCents)) : null;
}
function available(product) {
  return asArray(product.variants).some((v) => v.stock > 0);
}
function displayError(error) {
  return error?.message || "N\xE3o foi poss\xEDvel concluir. Tente novamente.";
}
async function api(path, options = {}) {
  const headers = { "Accept": "application/json", ...options.headers };
  if (options.body !== void 0) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(options.body);
  }
  if (options.method && !["GET", "HEAD"].includes(options.method)) headers["X-CSRF-Token"] = state.csrfToken;
  const response = await fetch(`/api${path}`, { credentials: "same-origin", ...options, headers });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("O servidor n\xE3o respondeu em JSON. Inicie a loja pelo servidor local.");
  }
  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.message || `N\xE3o foi poss\xEDvel concluir (${response.status}).`);
    error.status = response.status;
    error.code = data?.error?.code;
    error.fields = data?.error?.fields;
    throw error;
  }
  return data;
}
function toast(text) {
  let region = document.querySelector("#shop-toast");
  if (!region) {
    region = el("div", { id: "shop-toast", class: "shop-toast", role: "status", "aria-live": "polite" });
    document.body.append(region);
  }
  region.textContent = text;
  region.classList.add("is-visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => region.classList.remove("is-visible"), 4500);
}
function navigate(path, { replace = false, scroll = true } = {}) {
  if (path.startsWith("#")) {
    document.querySelector(path)?.scrollIntoView();
    return;
  }
  history[replace ? "replaceState" : "pushState"]({}, "", path);
  closeOverlay();
  renderRoute();
  if (scroll) window.scrollTo({ top: 0, behavior: "instant" });
}
document.addEventListener("click", (event) => {
  const anchor = event.target.closest("a[data-route],a.brand,a.footer-brand");
  if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(anchor.getAttribute("href"));
});
window.addEventListener("popstate", () => {
  closeOverlay();
  renderRoute();
});
function heading(kicker, title, description) {
  return el("div", { class: "shop-heading" }, el("p", { class: "shop-kicker" }, kicker), el("h1", {}, title), description ? el("p", { class: "shop-lead" }, description) : null);
}
function renderNav() {
  if (!navMount) return;
  const count = state.cart.reduce((n, item) => n + item.quantity, 0);
  const form = el("form", { class: "shop-search", role: "search", onSubmit: (e) => {
    e.preventDefault();
    const q = new FormData(form).get("q").trim();
    navigate(`/busca${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  } }, el("label", { class: "sr-only", for: "shop-search-q" }, "Buscar produtos"), el("input", { id: "shop-search-q", name: "q", type: "search", placeholder: "Busque sua pr\xF3xima carta", autocomplete: "off", value: new URLSearchParams(location.search).get("q") || "" }), button(icons.search, () => form.requestSubmit(), "shop-icon", { "aria-label": "Buscar produtos" }));
  const links = el("nav", { class: "shop-navigation", "aria-label": "Navega\xE7\xE3o da loja" }, link("Lacrados", "/lacrados"), link("Cartas avulsas", "/cartas"), link("Coleções", "/colecoes"), link("A experiência", "/"), state.user?.role === "ADMIN" ? link("Administrar", "/admin") : link("Sobre a BKM", "/sobre"));
  const actions = el("div", { class: "shop-nav-actions" }, link(el("span", { "aria-hidden": true }, icons.heart), "/favoritos", "shop-icon"), link(el("span", { "aria-hidden": true }, icons.user), state.user ? "/conta" : "/entrar", "shop-icon"), button([el("span", { "aria-hidden": true }, icons.bag), el("span", { class: "shop-cart-count" }, count)], () => openCart(), "shop-icon", { "aria-label": `Abrir carrinho, ${count} ${count === 1 ? "item" : "itens"}` }));
  actions.children[0].setAttribute("aria-label", "Meus favoritos");
  actions.children[1].setAttribute("aria-label", state.user ? "Minha conta" : "Entrar na conta");
  navMount.replaceChildren(el("div", { class: "shop-nav-content" }, button(icons.menu, () => {
    const open = links.classList.toggle("is-open");
    navMount.querySelector(".shop-menu-toggle")?.setAttribute("aria-expanded", String(open));
  }, "shop-icon shop-menu-toggle", { "aria-label": "Abrir menu", "aria-expanded": "false" }), links, form, actions));
  setupSearchSuggestions(form);
  let notice=document.querySelector("#shop-demo-banner");
  if(isDemo()){
    if(!notice){notice=el("div",{id:"shop-demo-banner",class:"shop-demo-banner"});document.body.prepend(notice);}
    setChildren(notice,el("span",{},"DEMONSTRAÇÃO"),state.apiReady?"Sem vendas ou cobranças reais. Explore a loja e simule pedidos.":"Sem vendas ou cobranças reais. Catálogo, conta e pedidos aguardam conexão ao banco de dados.",state.apiReady?link("Acessar loja ↓","/busca"):link("Ver a experiência ↓","/"));
  }else notice?.remove();
}
function setupSearchSuggestions(form){
  const input=form.querySelector("input"),list=el("div",{class:"shop-suggestions",id:"shop-suggestions",role:"listbox",hidden:true});
  form.append(list);
  input.setAttribute("role","combobox");input.setAttribute("aria-label","Buscar produtos");input.setAttribute("aria-autocomplete","list");input.setAttribute("aria-controls",list.id);input.setAttribute("aria-expanded","false");
  let timer,version=0,active=-1,options=[];
  const hide=()=>{list.hidden=true;input.setAttribute("aria-expanded","false");input.removeAttribute("aria-activedescendant");active=-1;};
  input.addEventListener("input",()=>{
    clearTimeout(timer);const current=++version,q=input.value.trim();hide();if(q.length<2)return;
    timer=setTimeout(async()=>{
      try{
        const data=await api(`/products?q=${encodeURIComponent(q)}&pageSize=6&sort=relevance`);
        if(current!==version||!input.isConnected)return;
        options=asArray(data.items).map((product,index)=>{
          const item=link(el("span",{},el("strong",{},product.name),el("small",{},`${product.kind==="SINGLE"?"Carta avulsa":"Lacrado"} · ${money(lowest(product))}`)),`/produto/${encodeURIComponent(product.slug)}`,"shop-suggestion");
          item.setAttribute("role","option");item.id=`shop-suggestion-${index}`;item.setAttribute("aria-selected","false");return item;
        });
        setChildren(list,options.length?options:el("p",{role:"status"},"Nenhum anúncio encontrado."));list.hidden=false;input.setAttribute("aria-expanded","true");
      }catch{hide();}
    },280);
  });
  input.addEventListener("keydown",event=>{
    if(event.key==="Escape"){hide();return;}
    if(!list.hidden&&options.length&&["ArrowDown","ArrowUp"].includes(event.key)){
      event.preventDefault();active=(active+(event.key==="ArrowDown"?1:-1)+options.length)%options.length;
      options.forEach((node,index)=>node.setAttribute("aria-selected",String(index===active)));input.setAttribute("aria-activedescendant",options[active].id);
    }else if(event.key==="Enter"&&!list.hidden&&active>=0){event.preventDefault();navigate(options[active].getAttribute("href"));}
  });
  form.addEventListener("focusout",()=>queueMicrotask(()=>{if(!form.contains(document.activeElement)){++version;clearTimeout(timer);hide();}}));
}
function setHome(home) {
  document.body.classList.toggle("shop-route-home", home);
  document.body.classList.toggle("shop-route-page", !home);
  if (experience) experience.hidden = !home;
  document.querySelector(".header-link")?.classList.toggle("shop-hidden", !home);
  window.dispatchEvent(new CustomEvent("bkm:route", { detail: { home } }));
  window.dispatchEvent(new Event("resize"));
}
async function renderRoute() {
  if(routeCleanup){routeCleanup();routeCleanup=null;}
  const version = ++pageVersion;
  const path = location.pathname.replace(/\/$/, "") || "/";
  const home = path === "/" || path === "/index.html" || path === "/ABRIR.html";
  setHome(home);
  renderNav();
  if (!mount) return;
  mount.replaceChildren(loading());
  document.title = `${home ? "A sua pr\xF3xima descoberta" : path.startsWith("/admin") ? "Administra\xE7\xE3o" : "Loja Pok\xE9mon"} \xB7 BKM TCG`;
  try {
    if (!state.apiReady) {
      const local=isLocalHost();
      mount.replaceChildren(el("div", { class: "shop-shell" }, empty(local?"Vamos conectar sua loja.":"Demonstração online aguardando conexão ao banco de dados.", local?"A experiência visual está disponível. Para usar catálogo, estoque e conta, abra a loja pelo servidor local.":"Catálogo, conta e pedidos estarão disponíveis após a configuração do Supabase.", el("div", { class: "shop-actions" }, button("Tentar conectar", async () => {
        await initialize();
        renderRoute();
      }), link("Ver a experi\xEAncia", "/", "shop-button secondary")))));
      return;
    }
    let node;
    if (home) node = await homePage();
    else if (["/lacrados", "/cartas", "/busca"].includes(path)) node = await catalogPage(path);
    else if (path.startsWith("/produto/")) node = await productPage(decodeURIComponent(path.slice(9)));
    else if (path === "/favoritos") node = await favoritesPage();
    else if (path === "/carrinho") node = await cartPage();
    else if (path === "/checkout") node = await checkoutPage();
    else if (path === "/entrar" || path === "/cadastro") node = authPage(path);
    else if(path === "/recuperar-senha")node=recoveryPage();
    else if (path === "/conta") node = await accountPage();
    else if (path.startsWith("/conta/pedidos/")) node = await orderPage(decodeURIComponent(path.split("/").at(-1)));
    else if (path === "/colecoes") node = await collectionsPage();
    else if (path.startsWith("/admin")) node = await adminPage(path);
    else node = infoPage(path);
    if (version !== pageVersion) return;
    mount.replaceChildren(node);
    mount.querySelector("h1")?.setAttribute("tabindex", "-1");
  } catch (error) {
    if (version !== pageVersion) return;
    mount.replaceChildren(el("div", { class: "shop-shell" }, heading("BKM TCG", "N\xE3o foi poss\xEDvel abrir esta p\xE1gina."), message(displayError(error), "error"), el("div", { class: "shop-actions" }, button("Tentar novamente", () => renderRoute()), link("Voltar \xE0 loja", "/", "shop-button secondary"))));
  }
}
async function homePage() {
  const [featured,sealed,singles,collections] = await Promise.all([api("/products?featured=true&pageSize=4"),api("/products?kind=SEALED&pageSize=4"),api("/products?kind=SINGLE&pageSize=4"),api("/collections")]);
  const section=(title,kicker,products,href)=>el("section",{class:"shop-section","aria-label":title},el("div",{class:"shop-section-top"},el("div",{},el("p",{class:"shop-kicker"},kicker),el("h2",{},title)),link("Explorar todos ↗",href,"shop-text-link")),products.length?productGrid(products):empty("A seleção está sendo preparada.","Os anúncios publicados aparecerão aqui.",link("Explorar catálogo",href,"shop-button secondary")));
  return el("div",{class:"shop-shell shop-home-content"},demoNotice(),el("div",{class:"shop-section-top"},el("div",{},el("p",{class:"shop-kicker"},"BKM TCG / COLECIONE O EXTRAORDINÁRIO"),el("h2",{},"O próximo capítulo é seu.")),link("Explorar catálogo ↗","/busca","shop-text-link")),el("div",{class:"shop-categories"},link([el("span",{class:"shop-category-no"},"01"),el("h3",{},"O começo da surpresa."),el("p",{},"Boosters, boxes e produtos lacrados."),el("span",{class:"shop-text-link"},"Explorar lacrados ↗")],"/lacrados","shop-category"),link([el("span",{class:"shop-category-no"},"02"),el("h3",{},"A carta que faltava."),el("p",{},"Encontre o próximo destaque da sua coleção."),el("span",{class:"shop-text-link"},"Explorar cartas ↗")],"/cartas","shop-category cyan")),section("Em destaque.","SELEÇÃO BKM",asArray(featured.items),"/busca"),section("Abra novas possibilidades.","PRODUTOS LACRADOS",asArray(sealed.items),"/lacrados"),section("Para a sua coleção.","CARTAS AVULSAS",asArray(singles.items),"/cartas"),el("section",{class:"shop-section"},el("div",{class:"shop-section-top"},el("div",{},el("p",{class:"shop-kicker"},"NOVOS UNIVERSOS"),el("h2",{},"Explore as coleções.")),link("Ver coleções ↗","/colecoes","shop-text-link")),collectionGrid(asArray(collections.items).filter(item=>item.featured).slice(0,6))),...asArray(state.config.banners).filter(b=>b.active!==false).map(b=>{const content=el("div",{class:"shop-campaign"},b.image?image(b.image,b.title):null,el("div",{},el("p",{class:"shop-kicker"},"BKM TCG"),el("h2",{},b.title),el("p",{},b.subtitle)));return b.url?.startsWith("/")&&!b.url.startsWith("//")?link(content,b.url,"shop-campaign-link"):content;}),el("div",{class:"shop-editorial"},el("p",{class:"shop-kicker"},"CADA CARTA TEM UMA HISTÓRIA"),el("h2",{},"A sua coleção merece uma nova descoberta."),el("p",{},"Lacrados e cartas avulsas em um só lugar. A identidade BKM, do primeiro pacote ao próximo encontro.")));
}
function collectionGrid(items){
  return items.length?el("div",{class:"shop-collections-grid"},items.map(item=>link([item.image?image(item.image,item.name):el("span",{class:"shop-collection-monogram","aria-hidden":true},"✦"),el("div",{},el("p",{class:"shop-kicker"},item.id),el("h3",{},item.name),el("p",{},item.description||"Descubra as cartas desta coleção."),el("span",{class:"shop-text-link"},"Explorar coleção ↗"))],`/cartas?set=${encodeURIComponent(item.id)}`,"shop-collection"))):message("As coleções publicadas serão exibidas aqui.");
}
async function collectionsPage(){const data=await api("/collections");return el("div",{class:"shop-shell"},heading("UNIVERSO POKÉMON TCG","Cada coleção, uma descoberta.","Escolha uma expansão para encontrar seus próximos destaques."),collectionGrid(asArray(data.items)));}
function productGrid(products) {
  return el("div", { class: "shop-grid" }, products.map(productCard));
}
function productCard(product) {
  catalogCache.set(product.id, product);
  const favorited = state.favorites.some((f) => f.id === product.id);
  const photo = productImage(product);
  return el("article", { class: "shop-product-card" }, el("div", { class: "shop-product-picture" }, link(image(photo.url, product.name), `/produto/${encodeURIComponent(product.slug)}`), button(favorited ? "\u2665" : "\u2661", (event) => toggleFavorite(product, event.currentTarget), "shop-favorite", { "aria-label": `${favorited ? "Remover" : "Adicionar"} ${product.name} ${favorited ? "dos" : "aos"} favoritos`, "aria-pressed": String(favorited) }), !available(product) ? badge("Indispon\xEDvel") : null), el("div", { class: "shop-product-meta" }, isDemo()?el("span",{class:"shop-demo-product"},"DEMONSTRAÇÃO"):null,el("p", { class: "shop-product-set" }, product.setName || "Pok\xE9mon TCG"), link(el("h3", {}, product.name), `/produto/${encodeURIComponent(product.slug)}`), el("p", { class: "shop-product-detail" }, product.kind === "SINGLE" ? [product.card?.number, asArray(product.variants).map((v) => languages[v.language] || v.language).filter((v, i, a) => a.indexOf(v) === i).join(" \xB7 ")].filter(Boolean).join(" \xB7 ") : "Produto lacrado"), el("p", { class: "shop-price" }, asArray(product.variants).length > 1 ? el("span", {}, "A partir de ") : null, money(lowest(product))), link(available(product) ? "Escolher op\xE7\xE3o \u2197" : "Ver detalhes \u2197", `/produto/${encodeURIComponent(product.slug)}`, "shop-product-action")));
}
function toggleFavorite(product, target) {
  const index = state.favorites.findIndex((f) => f.id === product.id);
  if (index < 0) state.favorites.push({ id: product.id, slug: product.slug, name: product.name });
  else state.favorites.splice(index, 1);
  persist();
  if (target) {
    target.textContent = index < 0 ? "\u2665" : "\u2661";
    target.setAttribute("aria-pressed", String(index < 0));
    target.setAttribute("aria-label", `${index < 0 ? "Remover" : "Adicionar"} ${product.name} ${index < 0 ? "dos" : "aos"} favoritos`);
  }
  toast(index < 0 ? "Produto salvo nos favoritos." : "Produto removido dos favoritos.");
}
async function catalogPage(path) {
  const search = new URLSearchParams(location.search);
  if(path==="/cartas")search.set("kind","SINGLE");
  if(path==="/lacrados")search.set("kind","SEALED");
  search.set("pageSize","12");
  const data=await api(`/products?${search}`);
  const title=path==="/cartas"?"Cartas avulsas.":path==="/lacrados"?"Lacrados.":search.get("q")?`Resultados para “${search.get("q")}”.`:"Encontre sua próxima carta.";
  const filters=el("form",{class:"shop-filters",onSubmit:event=>{event.preventDefault();applyFilters(filters,path);}},field("Buscar","q","search",search.get("q")||"",{placeholder:"Nome, número ou coleção"}),selectField("Coleção","set",[["","Todas as coleções"],...asArray(data.facets?.sets).map(set=>[set.id,set.name])],search.get("set")||""),path!=="/lacrados"?field("Número da carta","number","text",search.get("number")||"",{placeholder:"Ex.: 276 ou 276/217"}):null,selectField("Idioma","language",[["","Todos os idiomas"],...Object.entries(languages)],search.get("language")||""),selectField("Condição","condition",[["","Todas as condições"],...Object.entries(conditions).filter(([key])=>path!=="/cartas"||key!=="SEALED")],search.get("condition")||""),path!=="/lacrados"?selectField("Acabamento","finish",[["","Todos os acabamentos"],...Object.entries(finishes)],search.get("finish")||""):null,el("div",{class:"shop-filter-prices"},field("Preço mínimo (R$)","minPrice","number",search.has("minPrice")?(Number(search.get("minPrice"))/100).toFixed(2):"",{min:"0",step:".01"}),field("Preço máximo (R$)","maxPrice","number",search.has("maxPrice")?(Number(search.get("maxPrice"))/100).toFixed(2):"",{min:"0",step:".01"})),checkbox("Somente disponíveis","available",search.get("available")==="true"),button("Aplicar filtros",()=>filters.requestSubmit(),"shop-button secondary"),link("Limpar filtros",path,"shop-text-link"));
  const sort=selectField("Ordenar por","sort",[["newest","Mais recentes"],["price_asc","Menor preço"],["price_desc","Maior preço"],["name","Nome: A a Z"]],search.get("sort")||"newest");
  sort.querySelector("select").addEventListener("change",event=>{const params=new URLSearchParams(location.search);params.set("sort",event.target.value);params.delete("page");navigate(`${path}?${params}`);});
  const pagination=data.pagination||{},total=pagination.total??data.total??data.items.length,pages=pagination.pages??Math.ceil(total/12),current=Number(search.get("page"))||1;
  return el("div",{class:"shop-shell"},heading("CATÁLOGO POKÉMON TCG",title,"Escolha a coleção, o idioma e os detalhes da sua próxima descoberta."),el("div",{class:"shop-catalog-layout"},el("aside",{"aria-label":"Filtros do catálogo"},filters),el("div",{},el("div",{class:"shop-results-bar"},el("p",{},`${total} ${total===1?"produto encontrado":"produtos encontrados"}`),sort),data.items.length?productGrid(data.items):empty("Nenhum produto encontrado.","Tente remover os filtros ou buscar por outro termo.",link("Ver catálogo completo",path,"shop-button secondary")),pages>1?el("nav",{class:"shop-pagination","aria-label":"Paginação"},button("← Anterior",()=>goPage(path,current-1),"shop-button secondary",{disabled:current<=1}),el("span",{},`Página ${current} de ${pages}`),button("Próxima →",()=>goPage(path,current+1),"shop-button secondary",{disabled:current>=pages})):null)));
}
function applyFilters(form, path) {
  const params = new URLSearchParams();
  for (const [key, value] of new FormData(form)) {
    if (value) params.set(key, key === "available" ? "true" : ["minPrice","maxPrice"].includes(key) ? String(Math.round(Number(value)*100)) : value);
  }
  const sort = new URLSearchParams(location.search).get("sort");
  if (sort) params.set("sort", sort);
  navigate(`${path}${params.size ? `?${params}` : ""}`);
}
function goPage(path, page) {
  const params = new URLSearchParams(location.search);
  params.set("page", page);
  navigate(`${path}?${params}`);
}
async function productPage(slug) {
  const response = await api(`/products/${encodeURIComponent(slug)}`);
  const product = response.product || response;
  catalogCache.set(product.id, product);
  let chosen = asArray(product.variants).find((v) => v.stock > 0) || asArray(product.variants)[0];
  let quantity = 1;
  let activePhoto=productImage(product);
  const media = button([image(activePhoto.url, product.name),el("span",{class:"shop-zoom-hint"},"Ampliar imagem ↗")],()=>openImageZoom(activePhoto.url,product.name),"shop-product-main-image",{"aria-label":`Ampliar imagem de ${product.name}`});
  const mainPrice = el("p", { class: "shop-detail-price" });
  const stock = el("p", { class: "shop-stock" });
  const qtyInput = el("input", { type: "number", name: "quantity", min: "1", value: "1", "aria-label": "Quantidade", onChange: (event) => {
    quantity = Math.max(1, Math.min(chosen?.stock || 1, Math.trunc(Number(event.target.value)) || 1));
    event.target.value = quantity;
  } });
  const add = button("Adicionar ao carrinho", () => {
    addToCart(product, chosen, quantity);
    openCart();
  }, "shop-button");
  const buy = button("Comprar agora", () => {
    addToCart(product, chosen, quantity);
    navigate("/checkout");
  }, "shop-button secondary");
  const variantButtons = asArray(product.variants).map((variant) => button([el("strong", {}, languages[variant.language] || variant.language), el("span", {}, `${conditions[variant.condition] || variant.condition} \xB7 ${finishes[variant.finish] || variant.finish || "Normal"}`)], (event) => {
    chosen = variant;
    quantity = 1;
    qtyInput.value = "1";
    variantButtons.forEach((node) => node.classList.remove("selected"));
    event.currentTarget.classList.add("selected");
    sync();
  }, `shop-variant ${variant.id === chosen?.id ? "selected" : ""}`, { "aria-label": `${languages[variant.language] || variant.language}, ${conditions[variant.condition] || variant.condition}, ${money(variant.priceCents)}`, disabled: variant.stock <= 0 }));
  function sync() {
    setChildren(mainPrice,chosen?.compareAtCents > chosen?.priceCents ? el("del", {}, money(chosen.compareAtCents)) : null, chosen ? money(chosen.priceCents) : "Pre\xE7o indispon\xEDvel");
    stock.textContent = chosen?.stock > 0 ? `${chosen.stock} ${chosen.stock === 1 ? "unidade dispon\xEDvel" : "unidades dispon\xEDveis"}` : "Produto indispon\xEDvel";
    stock.classList.toggle("unavailable", !chosen?.stock);
    qtyInput.max = String(chosen?.stock || 1);
    add.disabled = !chosen?.stock;
    buy.disabled = !chosen?.stock;
    qtyInput.disabled = !chosen?.stock;
  }
  sync();
  const imageNotes = el("p", { class: "shop-image-note" }, asArray(product.images).some((img) => img.kind === "actual") ? "Fotos do produto dispon\xEDveis na galeria." : "Imagem de refer\xEAncia. Confira idioma, condi\xE7\xE3o e acabamento antes de comprar.");
  const shippingBox = shippingForm();
  const page=el("div", { class: "shop-shell" }, demoNotice(),el("nav", { class: "shop-breadcrumb", "aria-label": "Localiza\xE7\xE3o" }, link("In\xEDcio", "/"), el("span", {}, "/"), link(product.kind === "SINGLE" ? "Cartas avulsas" : "Lacrados", product.kind === "SINGLE" ? "/cartas" : "/lacrados"), el("span", {}, "/"), el("span", {}, product.name)), el("div", { class: "shop-detail-layout" }, el("div", { class: "shop-gallery" }, media, asArray(product.images).length > 1 ? el("div", { class: "shop-thumbnails" }, product.images.map((img, i) => button(image(img.url, `${product.name}, imagem ${i + 1}`), () => {
    activePhoto=img;setChildren(media,image(img.url,product.name),el("span",{class:"shop-zoom-hint"},"Ampliar imagem ↗"));
  }, "shop-thumbnail", { "aria-label": `Ver imagem ${i + 1}` }))) : null, imageNotes), el("div", { class: "shop-detail-info" }, el("p", { class: "shop-kicker" }, product.setName || "POK\xC9MON TCG"), el("h1", {}, product.name), product.kind === "SINGLE" && product.card ? el("p", { class: "shop-muted" }, [product.card.number, product.card.rarity].filter(Boolean).join(" \xB7 ")) : null, mainPrice, el("div", { class: "shop-variants" }, el("p", { class: "shop-label" }, "Selecione sua vers\xE3o"), variantButtons), stock, el("div", { class: "shop-quantity" }, button("\u2212", () => {
    quantity = Math.max(1, quantity - 1);
    qtyInput.value = quantity;
  }, "shop-quantity-button", { "aria-label": "Diminuir quantidade" }), qtyInput, button("+", () => {
    quantity = Math.min(chosen?.stock || 1, quantity + 1);
    qtyInput.value = quantity;
  }, "shop-quantity-button", { "aria-label": "Aumentar quantidade" })), el("div", { class: "shop-purchase-actions" }, add, buy), button(state.favorites.some((f) => f.id === product.id) ? "\u2665 Salvo nos favoritos" : "\u2661 Salvar nos favoritos", (event) => {
    toggleFavorite(product);
    event.currentTarget.textContent = state.favorites.some((f) => f.id === product.id) ? "\u2665 Salvo nos favoritos" : "\u2661 Salvar nos favoritos";
  }, "shop-text-link"), shippingBox, el("details", { class: "shop-description", open: true }, el("summary", {}, "Sobre este produto"), el("p", {}, product.description || "As caracter\xEDsticas cadastradas deste produto est\xE3o acima.")), el("details", { class: "shop-description" }, el("summary", {}, "Condi\xE7\xE3o e conserva\xE7\xE3o"), el("p", {}, "Near Mint: sinais m\xEDnimos de manuseio. Levemente jogada: pequenos sinais de uso. Moderadamente jogada: desgaste vis\xEDvel. Muito jogada ou danificada: desgaste acentuado. Fotos reais, quando dispon\xEDveis, complementam essa descri\xE7\xE3o.")))));
  if(product.attributes&&Object.values(product.attributes).some(Boolean))page.querySelector(".shop-detail-info").append(el("details",{class:"shop-description"},el("summary",{},"Especificações"),el("dl",{class:"shop-specifications"},Object.entries({"Categoria":product.attributes.category,"Fabricante":product.attributes.manufacturer,"Conteúdo":product.attributes.contents,"Peso":product.attributes.weightGrams?`${product.attributes.weightGrams} g`:"","Dimensões":product.attributes.widthCm&&product.attributes.heightCm&&product.attributes.lengthCm?`${product.attributes.widthCm} × ${product.attributes.heightCm} × ${product.attributes.lengthCm} cm`:"","Detalhes":product.attributes.specifications,"Observações":product.attributes.sellerNotes}).filter(([,v])=>v).map(([label,value])=>el("div",{},el("dt",{},label),el("dd",{},value))))));
  const related=asArray(response.related).filter(item=>item.id!==product.id);
  if(related.length)page.append(el("section",{class:"shop-section","aria-label":"Produtos relacionados"},el("div",{class:"shop-section-top"},el("div",{},el("p",{class:"shop-kicker"},"CONTINUE EXPLORANDO"),el("h2",{},"Outras descobertas."))),productGrid(related.slice(0,4))));
  return page;
}
function addToCart(product, variant, quantity) {
  if (!variant || variant.stock < 1) {
    toast("Esta op\xE7\xE3o n\xE3o est\xE1 dispon\xEDvel.");
    return;
  }
  let item = state.cart.find((item2) => item2.variantId === variant.id);
  if (item) item.quantity = Math.min(variant.stock, item.quantity + quantity);
  else state.cart.push({ variantId: variant.id, productId: product.id, slug: product.slug, name: product.name, image: productImage(product).url, language: variant.language, condition: variant.condition, finish: variant.finish, priceCents: variant.priceCents, stock: variant.stock, quantity: Math.min(variant.stock, quantity) });
  persist();
  renderNav();
  toast("Produto adicionado ao carrinho.");
}
function openImageZoom(url,name){
  closeOverlay();overlayReturnFocus=document.activeElement;document.body.classList.add("shop-overlay-open");setOverlayBackgroundInert(true);
  const close=button("×",closeOverlay,"shop-close",{"aria-label":"Fechar imagem ampliada"});
  overlay.replaceChildren(el("div",{class:"shop-overlay-backdrop shop-zoom-backdrop",onClick:event=>{if(event.target===event.currentTarget)closeOverlay();}},el("section",{class:"shop-image-zoom",role:"dialog","aria-modal":"true","aria-label":name},el("div",{class:"shop-drawer-heading"},el("h2",{},name),close),image(url,name))));
  document.addEventListener("keydown",overlayKeys);close.focus();
}
let overlayReturnFocus=null;
function setOverlayBackgroundInert(value){
  for(const node of document.querySelectorAll("main,.header,footer,#shop-demo-banner")){
    if(value)node.setAttribute("inert","");else node.removeAttribute("inert");
  }
}
function closeOverlay() {
  overlay?.replaceChildren();
  document.body.classList.remove("shop-overlay-open");
  setOverlayBackgroundInert(false);
  state.drawer = false;
  document.removeEventListener("keydown", overlayKeys);
  if(overlayReturnFocus){const target=overlayReturnFocus.isConnected?overlayReturnFocus:document.querySelector('[aria-label^="Abrir carrinho"]');target?.focus({preventScroll:true});}
  overlayReturnFocus=null;
}
function overlayKeys(event) {
  if (event.key === "Escape") closeOverlay();
  if (event.key === "Tab" && overlay?.firstChild) {
    const nodes = [...overlay.querySelectorAll('a[href],button,input,select,textarea,[tabindex="0"]')].filter((node) => !node.disabled && !node.closest("[hidden],[inert]") && node.getClientRects().length);
    const first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
}
async function openCart() {
  closeOverlay();
  overlayReturnFocus=document.activeElement;
  state.drawer = true;
  document.body.classList.add("shop-overlay-open");
  setOverlayBackgroundInert(true);
  const content = el("div", { class: "shop-drawer-body" }, loading("Conferindo seu carrinho\u2026"));
  const close = button("\xD7", () => closeOverlay(), "shop-close", { "aria-label": "Fechar carrinho" });
  overlay.replaceChildren(el("div", { class: "shop-overlay-backdrop", onClick: (event) => {
    if (event.target === event.currentTarget) closeOverlay();
  } }, el("section", { class: "shop-drawer", role: "dialog", "aria-modal": "true", "aria-labelledby": "shop-cart-title" }, el("div", { class: "shop-drawer-heading" }, el("h2", { id: "shop-cart-title" }, "Seu carrinho."), close), content)));
  document.addEventListener("keydown", overlayKeys);
  close.focus();
  try{await reconcileCart();}catch(error){toast(displayError(error));}
  if (!state.drawer) return;
  content.replaceChildren(await cartContent(true));
}
async function reconcileCart() {
  if (!state.cart.length || !state.apiReady) return;
  const requested = state.cart.map(item => ({...item}));
  const products = new Map(await Promise.all(requested.map(async item => {
    try{return [item.variantId,await api(`/products/${encodeURIComponent(item.slug)}`)];}
    catch(error){if(error.status===404)return [item.variantId,null];throw error;}
  })));
  let changed = false;
  state.cart = state.cart.filter((item) => {
    if(!products.has(item.variantId))return true;
    const result=products.get(item.variantId),product = result?.product || result;
    const variant = product?.variants?.find((v) => v.id === item.variantId);
    if (!variant || variant.stock < 1) {
      changed = true;
      return false;
    }
    if (item.priceCents !== variant.priceCents || item.quantity > variant.stock) changed = true;
    Object.assign(item, { name: product.name, priceCents: variant.priceCents, stock: variant.stock, image: productImage(product).url, quantity: Math.min(item.quantity, variant.stock) });
    return true;
  });
  persist();
  renderNav();
  if (changed) toast("Seu carrinho foi atualizado com os pre\xE7os e estoques atuais.");
}
function cartItems(onUpdate) {
  return el("div", { class: "shop-cart-items" }, state.cart.map((item) => el("article", { class: "shop-cart-item", "data-cart-variant":item.variantId }, link(image(item.image, item.name), `/produto/${encodeURIComponent(item.slug)}`, "shop-cart-image"), el("div", { class: "shop-cart-item-info" }, link(el("h3", {}, item.name), `/produto/${encodeURIComponent(item.slug)}`), el("p", {}, `${languages[item.language] || item.language} · ${conditions[item.condition] || item.condition} · ${finishes[item.finish] || item.finish || "Normal"}`), el("strong", {}, money(item.priceCents)), el("div", { class: "shop-cart-quantity" }, button("\u2212", () => updateQuantity(item.variantId, item.quantity - 1, onUpdate), "shop-quantity-button", { "aria-label": `Diminuir quantidade de ${item.name}`, "data-cart-action":"decrease" }), el("span", {"aria-live":"polite"}, item.quantity), button("+", () => updateQuantity(item.variantId, item.quantity + 1, onUpdate), "shop-quantity-button", { "aria-label": `Aumentar quantidade de ${item.name}`, "data-cart-action":"increase", disabled: item.quantity >= item.stock }), button("Remover", () => updateQuantity(item.variantId, 0, onUpdate), "shop-remove",{"data-cart-action":"remove","aria-label":`Remover ${item.name} do carrinho`}))))) );
}
async function updateQuantity(id, quantity, callback) {
  const item = state.cart.find((v) => v.variantId === id);
  if (!item) return;
  const active=document.activeElement,action=active?.dataset?.cartAction;
  const rowIndex=[...document.querySelectorAll("[data-cart-variant]")].indexOf(active?.closest("[data-cart-variant]"));
  if (quantity <= 0) state.cart = state.cart.filter((v) => v.variantId !== id);
  else item.quantity = Math.min(item.stock, quantity);
  persist();
  renderNav();
  await callback();
  if(action){
    const scope=state.drawer?overlay:mount,rows=[...scope.querySelectorAll("[data-cart-variant]")];
    const row=rows.find(node=>node.dataset.cartVariant===id)||rows[Math.min(Math.max(rowIndex,0),rows.length-1)];
    const target=row?.querySelector(`[data-cart-action="${action}"]:not(:disabled)`)||row?.querySelector("button:not(:disabled)")||scope.querySelector(".shop-close,a[href],button:not(:disabled)");
    target?.focus({preventScroll:true});
  }
}
async function cartContent(drawer = false) {
  if (!state.cart.length) return empty("Seu carrinho espera uma descoberta.", "Explore o cat\xE1logo e escolha o pr\xF3ximo destaque da sua cole\xE7\xE3o.", link("Explorar produtos", "/busca", "shop-button"));
  const content = el("div", { class: drawer ? "" : "shop-cart-layout" });
  const rerender = async () => {
    if (drawer) {
      content.replaceWith(await cartContent(true));
    } else await renderRoute();
  };
  const subtotal = state.cart.reduce((n, item) => n + item.priceCents * item.quantity, 0);
  const threshold = state.config.shipping?.freeShippingEnabled ? state.config.shipping?.freeShippingThresholdCents || state.config.freeShippingThresholdCents : 0;
  const progress = threshold ? el("div", { class: "shop-free-shipping" }, el("p", {}, subtotal >= threshold ? "Voc\xEA atingiu o valor para frete gr\xE1tis. Consulte seu CEP." : `Faltam ${money(threshold - subtotal)} para o frete gr\xE1tis.`), el("progress", { max: threshold, value: Math.min(subtotal, threshold), "aria-label": "Progresso para frete gr\xE1tis" })) : null;
  const summary = el("aside", { class: "shop-summary" }, el("h2", {}, "Resumo do pedido"),isDemo()?el("p",{class:"shop-fine"},"DEMONSTRAÇÃO — preços ilustrativos, sem cobranças reais."):null, el("div", { class: "shop-summary-row" }, el("span", {}, "Subtotal dos produtos"), el("strong", {}, money(subtotal))), progress, shippingForm(), el("p", { class: "shop-fine" }, "Pre\xE7o, estoque, cupom e frete ser\xE3o conferidos pelo servidor antes da finaliza\xE7\xE3o."), link("Continuar para checkout \u2197", "/checkout", "shop-button"), drawer ? link("Ver carrinho completo", "/carrinho", "shop-text-link") : link("Continuar comprando", "/busca", "shop-text-link"));
  content.append(cartItems(rerender), summary);
  return content;
}
async function cartPage() {
  await reconcileCart();
  return el("div", { class: "shop-shell" }, heading("SEUS PRODUTOS", "Seu carrinho."), await cartContent());
}
function shippingForm() {
  const result = el("div", { "aria-live": "polite" });
  const form = el("form", { class: "shop-shipping-form", onSubmit: async (event) => {
    event.preventDefault();
    const cep = new FormData(form).get("cep").replace(/\D/g, "");
    if (cep.length !== 8) {
      result.replaceChildren(message("Informe um CEP com 8 n\xFAmeros.", "error"));
      return;
    }
    localStorage.setItem("bkm-cep", cep);
    const submit = form.querySelector("button");
    submit.disabled = true;
    try {
      let items = state.cart.map((item) => ({ variantId: item.variantId, quantity: item.quantity }));
      if (!items.length) {
        result.replaceChildren(message(state.config.shipping?.enabled ? "Adicione um produto ao carrinho para calcular o frete." : "O c\xE1lculo de entrega ainda n\xE3o foi configurado."));
        return;
      }
      const quote = await api("/checkout/quote", { method: "POST", body: { items, cep } });
      result.replaceChildren(message(quote.shipping?.available ? `${isDemo()?"Frete de demonstração: ":""}${money(quote.shippingCents)}${quote.shipping?.estimatedDays ? ` \xB7 estimativa de ${quote.shipping.estimatedDays} dias \xFAteis` : ""}` : quote.reason || quote.shipping?.reason || "Entrega indispon\xEDvel para este CEP."));
    } catch (error) {
      result.replaceChildren(message(displayError(error), "error"));
    } finally {
      submit.disabled = false;
    }
  } }, el("label", { class: "shop-label" }, "Entrega para o seu CEP"), el("div", { class: "shop-inline-form" }, el("input", { name: "cep", placeholder: "00000-000", "aria-label": "CEP de entrega", inputmode: "numeric", maxlength: "9", value: localStorage.getItem("bkm-cep") || "", required: true, pattern: "[0-9]{5}-?[0-9]{3}" }), button("Calcular", () => form.requestSubmit(), "shop-button secondary")), result);
  return form;
}
async function favoritesPage() {
  const results = await Promise.all(state.favorites.map((favorite) => api(`/products/${encodeURIComponent(favorite.slug)}`).then((r) => r.product || r).catch(() => null)));
  return el("div", { class: "shop-shell" }, heading("GUARDE SUAS DESCOBERTAS", "Seus favoritos.", state.user?"Os produtos salvos são sincronizados com sua conta. A disponibilidade é conferida ao abrir a página.":"Os produtos salvos ficam neste navegador. Entre na conta para acessá-los em outros dispositivos."), results.filter(Boolean).length ? productGrid(results.filter(Boolean)) : empty("Um espa\xE7o para suas pr\xF3ximas escolhas.", "Toque no cora\xE7\xE3o de um produto para salv\xE1-lo aqui.", link("Explorar o cat\xE1logo", "/busca", "shop-button")), results.some((result) => !result) ? message("Alguns produtos salvos n\xE3o est\xE3o mais publicados.") : null);
}
// Mercado Pago's official SDK is loaded only after a configured, non-demo checkout selects card.
// The Brick owns sensitive card fields; requests to BKM contain only its token and payment metadata.
function loadMercadoPagoSDK(){
  if(typeof window.MercadoPago==="function")return Promise.resolve(window.MercadoPago);
  if(mercadoPagoSdkPromise)return mercadoPagoSdkPromise;
  mercadoPagoSdkPromise=new Promise((resolve,reject)=>{
    const script=el("script",{src:"https://js.mercadopago.com/v2",async:true});
    script.addEventListener("load",()=>{if(typeof window.MercadoPago==="function")resolve(window.MercadoPago);else{mercadoPagoSdkPromise=null;script.remove();reject(new Error("O formulário seguro não ficou disponível."));}},{once:true});
    script.addEventListener("error",()=>{mercadoPagoSdkPromise=null;script.remove();reject(new Error("Não foi possível carregar o formulário seguro de cartão. Tente novamente."));},{once:true});document.head.append(script);
  });return mercadoPagoSdkPromise;
}
function createMercadoPagoPaymentUi({getQuote,getEmail,config}){
  let controller=null,destroyed=false,mountVersion=0,amountCents=null;
  const status=el("div",{"aria-live":"polite"}),method=selectField("Forma de pagamento","mercadoPagoMethod",[["pix","Pix"],["card","Cartão"]],"pix");
  const identificationType=selectField("Tipo de documento","payerIdentificationType",[["CPF","CPF"],["CNPJ","CNPJ"]],"CPF"),identificationNumber=field("Documento do pagador","payerIdentificationNumber","text","",{required:true,inputmode:"numeric",autocomplete:"off",maxlength:"18"});
  const pix=el("div",{class:"shop-payment-pix-fields"},el("p",{class:"shop-fine"},"O código Pix será gerado pelo Mercado Pago após a confirmação do pedido e ficará disponível na sua conta."),el("div",{class:"shop-form-grid"},identificationType,identificationNumber));
  const cardContainer=el("div",{id:`bkm-card-payment-${crypto.randomUUID()}`,class:"shop-card-payment-brick"}),card=el("div",{hidden:true},el("p",{class:"shop-fine"},"O formulário seguro é fornecido pelo Mercado Pago. Os dados do cartão são tokenizados no navegador."),cardContainer);
  const unmount=()=>{if(controller){try{controller.unmount();}catch{}controller=null;}};
  async function renderCard(){
    const version=++mountVersion,quote=getQuote();unmount();cardContainer.replaceChildren();
    if(destroyed||method.querySelector("select").value!=="card")return;
    if(!quote?.paymentAvailable||!quote.shipping?.available||!Number.isSafeInteger(quote.totalCents)||quote.totalCents<=0){status.replaceChildren(message("Confira um CEP atendido e o resumo do pedido antes de preencher o cartão."));return;}
    setChildren(status,loading("Carregando formulário seguro…"));
    try{
      const MercadoPago=await loadMercadoPagoSDK();if(destroyed||version!==mountVersion||!cardContainer.isConnected)return;
      const mp=new MercadoPago(config.publicKey,{locale:"pt-BR"});amountCents=quote.totalCents;
      const next=await mp.bricks().create("cardPayment",cardContainer.id,{initialization:{amount:quote.totalCents/100,payer:{email:getEmail()}},customization:{visual:{style:{theme:"dark"},hidePaymentButton:true,hideFormTitle:false}},callbacks:{onReady:()=>{if(version===mountVersion)status.replaceChildren();},onError:()=>{if(version===mountVersion)status.replaceChildren(message("Confira o formulário de cartão ou tente carregá-lo novamente.","error"));}}});
      if(destroyed||version!==mountVersion){next.unmount();return;}controller=next;
    }catch{if(!destroyed&&version===mountVersion)setChildren(status,message("Não foi possível abrir o formulário seguro. Confira sua conexão e tente novamente.","error"),button("Carregar formulário novamente",renderCard,"shop-button secondary"));}
  }
  method.querySelector("select").addEventListener("change",()=>{const isCard=method.querySelector("select").value==="card";pix.hidden=isCard;card.hidden=!isCard;if(isCard)renderCard();else{++mountVersion;unmount();status.replaceChildren();}});
  const element=el("section",{class:"shop-admin-section shop-real-payment"},el("h2",{},"Pagamento com Mercado Pago"),config.environment==="sandbox"?message("AMBIENTE SANDBOX — utilize somente dados de teste do Mercado Pago. Este ambiente não recebe pagamentos comerciais."):null,method,pix,card,status);
  return{element,async updateAmount(value){if(destroyed)return;if(controller&&value!==amountCents){amountCents=value;if(Number.isSafeInteger(value)&&value>0){const updated=await controller.update({amount:value/100});if(!updated)await renderCard();}else{++mountVersion;unmount();}}else if(!controller&&method.querySelector("select").value==="card"&&element.isConnected)await renderCard();},async getPayment(){
    if(destroyed)throw new Error("Reabra o checkout para continuar.");
    if(method.querySelector("select").value==="pix"){
      const input=identificationNumber.querySelector("input");if(!input.reportValidity())throw new Error("Informe o documento do pagador.");const type=identificationType.querySelector("select").value,number=input.value.replace(/\D/g,"");if(number.length!==(type==="CPF"?11:14))throw new Error("Confira o número do documento do pagador.");return{provider:"mercadopago",method:"pix",payer:{email:getEmail(),identification:{type,number}}};
    }
    if(!controller)throw new Error("Aguarde o formulário seguro de cartão ficar disponível.");
    let data,additional;try{data=await controller.getFormData();additional=await controller.getAdditionalData();}catch{throw new Error("Confira os dados do cartão no formulário seguro.");}
    if(!data?.token||!data.payment_method_id||!data.payer?.email)throw new Error("Preencha os dados do cartão no formulário seguro.");
    const type=additional?.paymentTypeId;if(!["credit_card","debit_card"].includes(type))throw new Error("Selecione um cartão de crédito ou débito aceito.");
    return{provider:"mercadopago",method:"card",payer:{email:data.payer.email,identification:data.payer.identification},card:{token:data.token,paymentMethodId:data.payment_method_id,type,installments:Number(data.installments)||1}};
  },destroy(){destroyed=true;++mountVersion;unmount();}};
}
async function checkoutPage() {
  const routeVersion=pageVersion;
  await reconcileCart();
  if(routeVersion!==pageVersion)return loading();
  if(!state.cart.length)return el("div",{class:"shop-shell"},heading("FINALIZAR PEDIDO","Checkout."),empty("Seu carrinho está vazio.","Escolha um produto para continuar.",link("Explorar o catálogo","/busca","shop-button")));
  if(!state.user)return el("div",{class:"shop-shell shop-checkout-login"},demoNotice(),heading("SUA PRÓXIMA DESCOBERTA","Entre para continuar.","Sua conta guarda os pedidos e permite acompanhar cada etapa da simulação."),el("div",{class:"shop-actions"},link("Entrar na minha conta","/entrar?next=%2Fcheckout","shop-button"),link("Criar uma conta","/cadastro?next=%2Fcheckout","shop-button secondary")));
  const status=el("div",{"aria-live":"polite"}),summary=el("aside",{class:"shop-summary"},loading("Calculando o pedido…"));
  let currentQuote=null,quoteVersion=0,submitting=false,disposed=false;
  const idempotencyKey=crypto.randomUUID();
  const submit=el("button",{type:"submit",class:"shop-button",disabled:true},isDemo()?"Confirmar pedido de teste":"Pagamento indisponível");
  const demoPayments=isDemo()&&state.config.payments?.provider==="mock";
  const realPayments=!isDemo()&&state.config.payments?.provider==="mercadopago"&&state.config.payments?.available===true&&typeof state.config.payments?.publicKey==="string"&&!!state.config.payments.publicKey;
  let realUi=null;
  function showCreatedOrder(id,orderedItems,customerId,uncertain=false){
    if(customerId!==state.user?.id)return;
    clearTimeout(accountSaveTimer);const quantities=new Map(orderedItems.map(item=>[item.variantId,item.quantity]));state.cart=state.cart.map(item=>({...item,quantity:item.quantity-(quantities.get(item.variantId)||0)})).filter(item=>item.quantity>0);persist();renderNav();
    if(!disposed)navigate(`/conta/pedidos/${encodeURIComponent(id)}`);
    toast(uncertain?"Pedido registrado. Consulte o pagamento na sua conta antes de tentar novamente.":isDemo()?"Pedido de demonstração criado. Nenhuma cobrança foi realizada.":"Pedido criado. Acompanhe o status do pagamento na sua conta.");
  }
  const checkoutForm=el("form",{id:"bkm-checkout-form",class:"shop-checkout-form",onSubmit:async event=>{
    event.preventDefault();if(submitting||disposed)return;
    if(!(demoPayments||realPayments)||!currentQuote?.paymentAvailable||!currentQuote?.shipping?.available){status.replaceChildren(message("Confira o CEP e a disponibilidade da forma de pagamento.","error"));return;}
    submitting=true;submit.disabled=true;submit.textContent=isDemo()?"Criando pedido de teste…":"Processando pedido…";status.replaceChildren();
    let orderedItems=[],customerId=state.user?.id;
    try{
      const values=Object.fromEntries(new FormData(checkoutForm)),cep=values.cep.replace(/\D/g,"");
      orderedItems=state.cart.map(item=>({variantId:item.variantId,quantity:item.quantity}));
      const payment=demoPayments?{provider:"mock",outcome:values.paymentOutcome}:await realUi.getPayment();
      if(disposed)return;
      const result=await api("/checkout",{method:"POST",body:{items:orderedItems,coupon:values.coupon.trim()||null,cep,contact:{name:values.name.trim(),email:values.email.trim(),phone:values.phone.trim()},address:{name:values.name.trim(),phone:values.phone.trim(),zip:cep,cep,street:values.street.trim(),number:values.number.trim(),complement:values.complement.trim(),district:values.district.trim(),city:values.city.trim(),state:values.state},shipping:{method:values.shippingMethod},payment,idempotencyKey}});
      const order=result.order||result;if(!order.id)throw new Error("O servidor não retornou a identificação do pedido.");
      showCreatedOrder(order.id,orderedItems,customerId);
    }catch(error){if(error.fields?.orderId){showCreatedOrder(error.fields.orderId,orderedItems,customerId,true);return;}if(disposed)return;status.replaceChildren(message(displayError(error),"error"));submitting=false;submit.textContent=isDemo()?"Confirmar pedido de teste":"Confirmar pedido";await quote();}
  }},el("h2",{},"Contato e entrega"),el("p",{class:"shop-fine"},isDemo()?"Use dados de teste. O endereço será salvo neste ambiente para demonstrar o fluxo de entrega.":"Confira seus dados antes de continuar."),el("div",{class:"shop-form-grid"},field("Nome completo","name","text",state.user.name||"",{required:true,minlength:"2",maxlength:"120",autocomplete:"name"}),field("E-mail","email","email",state.user.email||"",{required:true,maxlength:"254",autocomplete:"email"}),field("Celular","phone","tel","",{required:true,minlength:"10",maxlength:"20",autocomplete:"tel",placeholder:"(11) 99999-9999"}),field("CEP","cep","text",readLocal("bkm-checkout-cep","")||localStorage.getItem("bkm-cep")||"",{required:true,inputmode:"numeric",pattern:"[0-9]{5}-?[0-9]{3}",autocomplete:"postal-code"}),field("Rua / avenida","street","text","",{required:true,maxlength:"200",autocomplete:"address-line1"}),field("Número","number","text","",{required:true,maxlength:"20"}),field("Complemento","complement","text","",{maxlength:"100",autocomplete:"address-line2"}),field("Bairro","district","text","",{required:true,maxlength:"100"}),field("Cidade","city","text","",{required:true,maxlength:"100",autocomplete:"address-level2"}),selectField("Estado","state",[["","Selecione"],..."AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ").map(uf=>[uf,uf])],"",{required:true})),el("div",{class:"shop-coupon-form"},field("Cupom de desconto","coupon","text","",{placeholder:"Ex.: BKMDEMO"}),button("Atualizar valores",()=>quote(),"shop-button secondary")),el("fieldset",{class:"shop-checkout-choice"},el("legend",{},"Modalidade de entrega"),el("label",{class:"shop-check"},el("input",{type:"radio",name:"shippingMethod",value:isDemo()?"demo-standard":"standard",checked:true,required:true}),el("span",{},isDemo()?"Entrega de demonstração — sem envio físico":"Entrega padrão")),el("p",{class:"shop-fine"},"O CEP e o valor do carrinho determinam a elegibilidade. O frete grátis depende da cobertura configurada.")),el("fieldset",{class:"shop-checkout-choice"},el("legend",{},"Pagamento"),demoPayments?el("div",{},selectField("Resultado do pagamento de teste","paymentOutcome",[["approved","Aprovado — simular baixa de estoque"],["pending","Pendente — simular reserva de estoque"],["rejected","Recusado — simular liberação"],["cancelled","Cancelado — simular liberação"],["expired","Expirado — simular liberação"]],"approved"),message("SIMULAÇÃO: este pagamento não utiliza Pix, cartão ou dinheiro. Nenhuma cobrança será feita.")):realPayments?el("p",{class:"shop-fine"},"Selecione Pix ou cartão na etapa de pagamento abaixo."):message(state.config.payments?.reason||"Cobranças reais estão desativadas.")),status,submit,el("p",{class:"shop-fine"},"Preços, descontos, disponibilidade e entrega são confirmados pelo servidor. Cada pedido possui uma identificação única."));
  async function quote(){
    if(disposed)return;
    const version=++quoteVersion,data=new FormData(checkoutForm),cep=String(data.get("cep")||"").replace(/\D/g,"");submit.disabled=true;
    setChildren(summary,loading("Conferindo valores…"));
    try{
      const result=await api("/checkout/quote",{method:"POST",body:{items:state.cart.map(item=>({variantId:item.variantId,quantity:item.quantity})),coupon:String(data.get("coupon")||"").trim()||null,cep}});if(disposed||version!==quoteVersion)return;currentQuote=result;
      setChildren(summary,el("p",{class:"shop-kicker"},isDemo()?"PEDIDO DE DEMONSTRAÇÃO":"RESUMO"),el("h2",{},"Seu pedido"),state.cart.map(item=>el("div",{class:"shop-summary-row"},el("span",{},`${item.quantity} × ${item.name}`),el("span",{},money(item.priceCents*item.quantity)))),el("hr"),summaryRow("Subtotal",result.subtotalCents),result.discountCents?summaryRow("Desconto",-result.discountCents):null,summaryRow(isDemo()?"Frete de demonstração":"Frete",result.shipping?.available?result.shippingCents:null),el("div",{class:"shop-summary-total"},el("span",{},"Total"),el("strong",{},money(result.totalCents))),result.shipping?.available?message(result.shipping.free?`Valor mínimo e CEP elegíveis para frete grátis${isDemo()?" de demonstração":""}.`:`${isDemo()?"Entrega de demonstração — estimativa ilustrativa":"Estimativa de entrega"}: ${result.shipping.estimatedDays||7} dias úteis.`):message(result.shipping?.reason||"Informe um CEP atendido para conferir a entrega."),...asArray(result.errors).map(error=>message(typeof error==="string"?error:error.message,"error")));
      submit.disabled=submitting||!(demoPayments||realPayments)||!result.paymentAvailable||!result.shipping?.available;
      if(realUi)await realUi.updateAmount(result.totalCents);
      if(!result.paymentAvailable)summary.append(message(result.reason||state.config.payments?.reason||"Pagamento indisponível."));
    }catch(error){if(disposed||version!==quoteVersion)return;currentQuote=null;setChildren(summary,message(displayError(error),"error"));submit.disabled=true;}
  }
  checkoutForm.querySelector("[name=cep]").addEventListener("change",()=>quote());
  checkoutForm.querySelector("[name=coupon]").addEventListener("change",()=>quote());
  const checkoutFlow=el("div",{class:"shop-checkout-flow"},checkoutForm);
  if(realPayments){realUi=createMercadoPagoPaymentUi({getQuote:()=>currentQuote,getEmail:()=>checkoutForm.querySelector("[name=email]").value.trim(),config:state.config.payments});submit.remove();submit.setAttribute("form",checkoutForm.id);submit.textContent="Confirmar pedido";checkoutFlow.append(realUi.element,submit);}
  routeCleanup=()=>{disposed=true;++quoteVersion;realUi?.destroy();};
  await quote();return el("div",{class:"shop-shell"},demoNotice(),heading("UMA NOVA HISTÓRIA PARA SUA COLEÇÃO",isDemo()?"Checkout de demonstração.":"Checkout."),el("div",{class:"shop-checkout-layout"},checkoutFlow,summary));
}
function summaryRow(label, value) {
  return el("div", { class: "shop-summary-row" }, el("span", {}, label), el("span", {}, money(value)));
}
function authPage(path) {
  const register = path === "/cadastro";
  if (state.user) return el("div", { class: "shop-shell shop-auth" }, heading("SUA CONTA", "Voc\xEA j\xE1 est\xE1 por aqui."), link("Ir para minha conta", "/conta", "shop-button"));
  const status = el("div", { "aria-live": "polite" });
  const form = el("form", { class: "shop-auth-form", onSubmit: async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    status.replaceChildren();
    try {
      const result = await api(`/auth/${register ? "register" : "login"}`, { method: "POST", body: values });
      state.user = result.user;
      state.csrfToken = result.csrfToken || state.csrfToken;
      await syncAccount();
      renderNav();
      const next = new URLSearchParams(location.search).get("next");
      navigate(next && next.startsWith("/") && !next.startsWith("//") ? next : register ? "/conta" : state.user?.role === "ADMIN" ? "/admin" : "/conta");
      toast(register ? "Conta criada. Bem-vindo \xE0 BKM." : "Voc\xEA entrou na sua conta.");
    } catch (error) {
      status.replaceChildren(message(displayError(error), "error"));
      submit.disabled = false;
    }
  } }, register ? field("Seu nome", "name", "text", "", { required: true, autocomplete: "name", minlength: "2" }) : null, field("E-mail", "email", "email", "", { required: true, autocomplete: "email" }), field("Senha", "password", "password", "", { required: true, autocomplete: register ? "new-password" : "current-password", minlength: register ? "12" : void 0 }), register ? el("p", { class: "shop-fine" }, "Use pelo menos 12 caracteres. Ao criar uma conta, voc\xEA concorda com os ", link("termos de uso", "/termos", "shop-text-link"), " e a ", link("pol\xEDtica de privacidade", "/privacidade", "shop-text-link"), ".") : null, status, el("button", { type: "submit", class: "shop-button" }, register ? "Criar minha conta" : "Entrar"), el("p", { class: "shop-muted" }, register ? "J\xE1 tem uma conta? " : "Sua primeira visita? ", link(register ? "Entrar" : "Crie uma conta", `${register ? "/entrar" : "/cadastro"}${location.search}`, "shop-text-link")));
  if(!register)form.append(link("Esqueci minha senha","/recuperar-senha","shop-text-link"));
  return el("div", { class: "shop-shell shop-auth" }, heading("BEM-VINDO \xC0 BKM", register ? "Sua cole\xE7\xE3o.\nSua conta." : "Bom ter voc\xEA\npor aqui."), form);
}
function recoveryPage(){
  const token=new URLSearchParams(location.search).get("token")||"",status=el("div",{"aria-live":"polite"});
  const form=el("form",{class:"shop-auth-form",onSubmit:async event=>{event.preventDefault();const values=Object.fromEntries(new FormData(form)),submit=form.querySelector("[type=submit]");submit.disabled=true;status.replaceChildren();try{if(token){if(values.password!==values.confirmPassword)throw new Error("As senhas precisam ser iguais.");await api("/auth/reset-password",{method:"POST",body:{token,password:values.password}});status.replaceChildren(message("Senha redefinida. Entre novamente para continuar.","success"),link("Entrar na conta","/entrar","shop-button"));form.querySelectorAll("input").forEach(input=>input.value="");}else{const result=await api("/auth/forgot-password",{method:"POST",body:{email:values.email}});status.replaceChildren(message(result.message||"Se a conta existir, as instruções de recuperação serão preparadas."));}}catch(error){status.replaceChildren(message(displayError(error),"error"));}finally{submit.disabled=false;}}},token?field("Nova senha","password","password","",{required:true,minlength:"12",maxlength:"128",autocomplete:"new-password"}):field("E-mail da conta","email","email","",{required:true,autocomplete:"email"}),token?field("Confirme a nova senha","confirmPassword","password","",{required:true,minlength:"12",maxlength:"128",autocomplete:"new-password"}):null,isDemo()&&!token?message("No ambiente de demonstração, os e-mails geram prévias seguras na administração. O envio externo depende da configuração do provedor."):null,status,el("button",{type:"submit",class:"shop-button"},token?"Salvar nova senha":"Solicitar recuperação"),link("Voltar para entrar","/entrar","shop-text-link"));
  return el("div",{class:"shop-shell shop-auth"},heading("SUA CONTA BKM",token?"Crie uma nova senha.":"Recupere seu acesso."),form);
}
async function accountPage() {
  if (!state.user) {
    navigate("/entrar?next=%2Fconta", { replace: true });
    return loading();
  }
  const data = await api("/account/orders").catch((error) => ({ items: [], error: displayError(error) }));
  return el("div", { class: "shop-shell" }, heading("SUA CONTA", `Ol\xE1, ${state.user.name.split(" ")[0]}.`), el("div", { class: "shop-account-top" }, el("div", {}, el("p", {}, state.user.name), el("p", { class: "shop-muted" }, state.user.email)), el("div", { class: "shop-actions" }, state.user.role === "ADMIN" ? link("Administrar a loja", "/admin", "shop-button") : null, button("Sair da conta", () => logout(), "shop-button secondary"))), el("section", { class: "shop-section" }, el("h2", {}, "Seus pedidos"), data.error ? message(data.error, "error") : null, asArray(data.items || data.orders).length ? ordersList(data.items || data.orders) : empty("Sua cole\xE7\xE3o come\xE7a no pr\xF3ximo pedido.", "Quando uma compra for confirmada, voc\xEA poder\xE1 acompanhar o pedido aqui.", link("Explorar produtos", "/busca", "shop-button secondary"))));
}
async function logout() {
  try {
    await api("/auth/logout", { method: "POST" });
    state.user = null;
    const session = await api("/session");
    state.csrfToken = session.csrfToken;
    renderNav();
    navigate("/");
    toast("Voc\xEA saiu da sua conta.");
  } catch (error) {
    toast(displayError(error));
  }
}
function ordersList(orders,admin=false) {
  return el("div",{class:"shop-table-wrap"},el("table",{class:"shop-table"},el("thead",{},el("tr",{},["Pedido",...(admin?["Cliente"]:[]),"Data","Status","Pagamento","Envio","Total",""].map(text=>el("th",{},text)))),el("tbody",{},orders.map(order=>el("tr",{},el("td",{},link(order.number||order.id,`${admin?"/admin":"/conta"}/pedidos/${encodeURIComponent(order.id)}`,"shop-text-link"),isDemo()?el("small",{class:"shop-demo-product"},"TESTE"):null),admin?el("td",{},order.contact?.name||order.customer?.name||order.customerName||order.customerEmail||"Cliente de demonstração"):null,el("td",{},order.createdAt?new Date(order.createdAt).toLocaleDateString("pt-BR"):"—"),el("td",{},badge(orderLabels[order.status]||order.status||"Pendente")),el("td",{},paymentLabels[order.paymentStatus]||order.paymentStatus||"Pendente"),el("td",{},orderLabels[order.shippingStatus]||order.shippingStatus||"A preparar"),el("td",{},money(order.totalCents)),el("td",{},link("Ver detalhes ↗",`${admin?"/admin":"/conta"}/pedidos/${encodeURIComponent(order.id)}`,"shop-text-link")))))));
}
async function orderPage(id,admin=false){
  const orderRouteVersion=pageVersion;
  if(!state.user){navigate(`/entrar?next=${encodeURIComponent(`/conta/pedidos/${id}`)}`,{replace:true});return loading();}
  const response=await api(`/${admin?"admin":"account"}/orders/${encodeURIComponent(id)}`),order=response.order||response;
  const status=el("div",{"aria-live":"polite"});
  const items=asArray(order.items),contact=order.contact||order.customer||{},address=order.address||order.shippingAddress||{};
  const paymentStatus=order.paymentStatus||order.payment?.status||"PENDING";
  const detail=el("section",{class:"shop-order-detail"},demoNotice(),el("div",{class:"shop-section-top"},el("div",{},el("p",{class:"shop-kicker"},isDemo()?"PEDIDO DE TESTE / SEM COBRANÇA REAL":"ACOMPANHE SEU PEDIDO"),el("h1",{},order.number||order.id),el("p",{class:"shop-muted"},order.createdAt?new Date(order.createdAt).toLocaleString("pt-BR"):"")),link("← Todos os pedidos",admin?"/admin/pedidos":"/conta","shop-text-link")),el("div",{class:"shop-order-statuses"},badge(orderLabels[order.status]||order.status),badge(`Pagamento${isDemo()?" simulado":""}: ${paymentLabels[paymentStatus]||paymentStatus}`),badge(`Entrega${isDemo()?" de teste":""}: ${orderLabels[order.shippingStatus]||order.shippingStatus||"A preparar"}`)),el("div",{class:"shop-order-layout"},el("div",{},el("section",{class:"shop-admin-section"},el("h2",{},"Itens do pedido"),items.map(item=>{const snapshot={...item.variant,...(item.snapshot||item.productSnapshot||item)};const photoValue=snapshot.image||snapshot.imageUrl||asArray(snapshot.images)[0]?.url;const photo=typeof photoValue==="string"?photoValue:photoValue?.url;return el("article",{class:"shop-order-item"},photo?image(photo,snapshot.name||item.name||"Produto"):null,el("div",{},el("h3",{},snapshot.name||item.name||item.productName||"Produto"),el("p",{class:"shop-muted"},[snapshot.number,snapshot.language?languages[snapshot.language]||snapshot.language:null,snapshot.condition?conditions[snapshot.condition]||snapshot.condition:null,snapshot.finish?finishes[snapshot.finish]||snapshot.finish:null].filter(Boolean).join(" · ")),el("p",{},`${item.quantity} × ${money(item.priceCents??item.unitPriceCents??snapshot.priceCents)}`)),el("strong",{},money(item.totalCents??((item.priceCents??item.unitPriceCents??snapshot.priceCents??0)*item.quantity))));})),el("section",{class:"shop-admin-section"},el("h2",{},"Contato e endereço"),el("p",{},contact.name||address.name||state.user.name),el("p",{class:"shop-muted"},contact.email||order.email||""),el("p",{class:"shop-muted"},contact.phone||address.phone||""),el("p",{class:"shop-muted"},[address.street,address.number,address.complement].filter(Boolean).join(", ")),el("p",{class:"shop-muted"},[address.district,address.city,address.state].filter(Boolean).join(" · ")),el("p",{class:"shop-muted"},`CEP: ${address.zip||address.cep||"—"}`))),el("aside",{class:"shop-summary"},el("h2",{},"Resumo"),summaryRow("Subtotal",order.subtotalCents),order.discountCents?summaryRow("Desconto",-order.discountCents):null,summaryRow(isDemo()?"Frete de demonstração":"Frete",order.shippingCents),el("div",{class:"shop-summary-total"},el("span",{},"Total"),el("strong",{},money(order.totalCents))),order.trackingCode||order.tracking?.code||order.shipment?.trackingCode?el("div",{class:"shop-order-tracking"},el("h3",{},isDemo()?"Rastreamento de teste":"Rastreamento"),el("p",{},order.trackingCode||order.tracking?.code||order.shipment?.trackingCode),safeImage(order.trackingUrl||order.tracking?.url||order.shipment?.trackingUrl)?el("a",{href:safeImage(order.trackingUrl||order.tracking?.url||order.shipment?.trackingUrl),class:"shop-text-link",target:"_blank",rel:"noopener noreferrer"},"Consultar rastreamento ↗"):null):null,isDemo()?message("Este pedido foi gerado em demonstração. Não houve pagamento nem contratação de entrega."):null)),status);
  if(isDemo()&&paymentStatus==="PENDING"){
    const actions=el("div",{class:"shop-actions"});
    for(const [outcome,label]of[["approved","Simular aprovação"],["rejected","Simular recusa"],["cancelled","Simular cancelamento"],["expired","Simular expiração"]])actions.append(button(label,async event=>{const buttons=[...actions.querySelectorAll("button")];buttons.forEach(node=>node.disabled=true);try{await api(`/${admin?"admin":"account"}/orders/${encodeURIComponent(id)}/simulate`,{method:"POST",body:{outcome,idempotencyKey:crypto.randomUUID()}});toast("Evento de teste registrado.");renderRoute();}catch(error){status.replaceChildren(message(displayError(error),"error"));buttons.forEach(node=>node.disabled=false);}},outcome==="approved"?"shop-button":"shop-button secondary"));
    detail.append(el("section",{class:"shop-admin-section"},el("h2",{},"Controlar pagamento de teste"),el("p",{class:"shop-muted"},"O estoque está reservado enquanto o pagamento de teste aguarda uma decisão. Recusa, cancelamento e expiração liberam a reserva."),actions));
  }
  if(!isDemo()&&order.payment?.provider==="mercadopago"){
    const payment=order.payment,section=el("section",{class:"shop-admin-section shop-payment-status"},el("h2",{},"Pagamento com Mercado Pago"),payment.sandbox?message("AMBIENTE SANDBOX — pagamento de teste do Mercado Pago, sem venda comercial."):null);
    if(paymentStatus==="PENDING")section.append(message("A confirmação está pendente. Consulte o status antes de iniciar outra compra para este pagamento."));
    if(order.status==="PAYMENT_REVIEW"||paymentStatus==="REVIEW")section.append(message("Este pagamento requer conferência. O pedido permanece em análise até a confirmação do provedor."));
    if(paymentStatus==="PENDING"&&typeof payment.pix?.copyPaste==="string"&&payment.pix.copyPaste){
      const code=el("textarea",{class:"shop-pix-code",readonly:true,rows:"4","aria-label":"Código Pix copia e cola",value:payment.pix.copyPaste});
      section.append(el("h3",{},"Pix copia e cola"),el("p",{class:"shop-fine"},"Código fornecido pelo Mercado Pago. Confira o beneficiário e o valor no aplicativo do seu banco."),code,button("Copiar código Pix",async()=>{try{if(!navigator.clipboard?.writeText)throw new Error();await navigator.clipboard.writeText(payment.pix.copyPaste);toast("Código Pix copiado.");}catch{code.focus();code.select();toast("Selecione e copie o código Pix acima.");}},"shop-button secondary"));
    }
    if(payment.expiresAt&&Number.isFinite(Date.parse(payment.expiresAt)))section.append(el("p",{class:"shop-fine"},`Validade informada: ${new Date(payment.expiresAt).toLocaleString("pt-BR")}.`));
    section.append(button("Consultar status do pagamento",async event=>{const trigger=event.currentTarget;trigger.disabled=true;try{await api(`/${admin?"admin":"account"}/orders/${encodeURIComponent(id)}/reconcile`,{method:"POST",body:{}});if(orderRouteVersion===pageVersion){toast("Status consultado no provedor.");await renderRoute();}}catch(error){status.replaceChildren(message(displayError(error),"error"));trigger.disabled=false;}},"shop-button secondary"));
    detail.append(section);
  }
  if(admin&&order.status!=="PAYMENT_REVIEW"&&["APPROVED","PAID"].includes(paymentStatus)){
    const shipment=order.shipment||{};
    const form=el("form",{class:"shop-admin-section",onSubmit:async event=>{event.preventDefault();const submit=form.querySelector("[type=submit]");submit.disabled=true;try{const values=Object.fromEntries(new FormData(form));await api(`/admin/orders/${encodeURIComponent(id)}/shipping`,{method:"PATCH",body:{status:values.shippingStatus,trackingCode:values.trackingCode.trim(),trackingUrl:values.trackingUrl.trim()}});toast("Entrega atualizada.");renderRoute();}catch(error){status.replaceChildren(message(displayError(error),"error"));submit.disabled=false;}}},el("h2",{},isDemo()?"Entrega de demonstração":"Entrega"),el("div",{class:"shop-form-grid"},selectField("Status de entrega","shippingStatus",[["UNFULFILLED","A preparar"],["PROCESSING","Em preparação"],["SHIPPED","Enviado"],["DELIVERED","Entregue"]],order.shippingStatus||shipment.status||"UNFULFILLED"),field("Código de rastreamento","trackingCode","text",order.trackingCode||order.tracking?.code||shipment.trackingCode||"",{maxlength:"100"}),field("URL de rastreamento","trackingUrl","url",order.trackingUrl||order.tracking?.url||shipment.trackingUrl||"",{placeholder:"https://…"})),el("button",{type:"submit",class:"shop-button secondary"},"Salvar entrega"));detail.append(form);
  }
  const history=asArray(order.history);
  detail.append(el("section",{class:"shop-admin-section"},el("h2",{},"Histórico"),history.length?el("ol",{class:"shop-order-history"},history.map(entry=>el("li",{},el("span",{},entry.message||entry.description||entry.event||orderLabels[entry.status]||paymentLabels[entry.status]||entry.type||entry.status||"Atualização do pedido"),el("time",{},entry.createdAt?new Date(entry.createdAt).toLocaleString("pt-BR"):"")))):message("O histórico será exibido após a primeira atualização.")));
  return admin?detail:el("div",{class:"shop-shell"},detail);
}
async function adminPage(path) {
  if (!state.user) {
    navigate(`/entrar?next=${encodeURIComponent(path)}`, { replace: true });
    return loading();
  }
  if (state.user.role !== "ADMIN") return el("div", { class: "shop-shell" }, heading("ACESSO RESTRITO", "Esta \xE1rea \xE9 da administra\xE7\xE3o."), message("Sua conta n\xE3o possui permiss\xE3o para gerenciar a loja."), link("Voltar \xE0 minha conta", "/conta", "shop-button"));
  const tabs = [["Painel", "/admin"], ["Produtos", "/admin/produtos"], ["Estoque", "/admin/estoque"], ["Pedidos", "/admin/pedidos"], ["Coleções", "/admin/colecoes"], ["E-mails", "/admin/emails"], ["Cupons", "/admin/cupons"], ["Configura\xE7\xF5es", "/admin/configuracoes"]];
  let content;
  if (path === "/admin") content = await adminDashboard();
  else if (path === "/admin/produtos") content = await adminProducts();
  else if(path === "/admin/estoque")content=await adminInventory();
  else if (path === "/admin/produtos/novo") content = await productEditor();
  else if (/^\/admin\/produtos\/[^/]+$/.test(path)) content = await productEditor(decodeURIComponent(path.split("/").at(-1)));
  else if (path === "/admin/configuracoes") content = await adminSettings();
  else if (path === "/admin/cupons") content = await adminCoupons();
  else if (path === "/admin/pedidos") content = await adminOrders();
  else if (/^\/admin\/pedidos\/[^/]+$/.test(path)) content = await orderPage(decodeURIComponent(path.split("/").at(-1)),true);
  else if (path === "/admin/colecoes") content = await adminCollections();
  else if(path === "/admin/emails")content=await adminEmails();
  else content = empty("P\xE1gina n\xE3o encontrada.", "Escolha uma \xE1rea da administra\xE7\xE3o.", link("Ir para o painel", "/admin", "shop-button"));
  return el("div", { class: "shop-shell shop-admin" }, el("div", { class: "shop-admin-title" }, heading("BKM TCG / OPERA\xC7\xC3O", "Administra\xE7\xE3o."), link("Ver a loja \u2197", "/busca", "shop-text-link")), el("nav", { class: "shop-admin-nav", "aria-label": "Administra\xE7\xE3o" }, tabs.map(([label, href]) => link(label, href, path === href || href === "/admin/produtos" && path.startsWith("/admin/produtos/") ? "active" : ""))), content);
}
async function adminDashboard() {
  const [summary, coupons] = await Promise.all([api("/admin/summary"), api("/admin/coupons")]);
  return el("div", {}, el("div", { class: "shop-stat-grid" }, [["Produtos", summary.products], ["Publicados", summary.published], ["Unidades em estoque", summary.stockUnits], ["Pedidos", summary.orders]].map(([label, value]) => el("div", { class: "shop-stat" }, el("span", {}, label), el("strong", {}, value)))), el("div", { class: "shop-admin-welcome" }, el("div", {}, el("p", { class: "shop-kicker" }, "SEU CAT\xC1LOGO COME\xC7A AQUI"), el("h2", {}, summary.products ? "Tudo pronto para a pr\xF3xima descoberta." : "Vamos preparar a primeira cole\xE7\xE3o."), el("p", { class: "shop-muted" }, "Cadastre cartas e lacrados, defina suas vers\xF5es e publique quando pre\xE7o e estoque estiverem prontos.")), link("Cadastrar produto \u2197", "/admin/produtos/novo", "shop-button")), isDemo()?demoNotice():!state.config.paymentConfigured ? message("Cobranças reais estão indisponíveis até a configuração e validação do provedor.") : null, el("div", { class: "shop-admin-shortcuts" }, link("Configurar contato e entrega \u2197", "/admin/configuracoes", "shop-panel-link"), link(`Gerenciar ${asArray(coupons.items || coupons.coupons).length} cupons \u2197`, "/admin/cupons", "shop-panel-link")));
}
async function adminProducts() {
  const params = new URLSearchParams(location.search);
  params.set("pageSize", "48");
  const data = await api(`/admin/products?${params}`);
  const items = asArray(data.items || data.products);
  const search = el("form", { class: "shop-inline-form", onSubmit: (event) => {
    event.preventDefault();
    navigate(`/admin/produtos?q=${encodeURIComponent(new FormData(search).get("q"))}`);
  } }, el("input", { name: "q", placeholder: "Buscar produto, SKU ou cole\xE7\xE3o", "aria-label": "Buscar produtos administrativos", value: params.get("q") || "" }), button("Buscar", () => search.requestSubmit(), "shop-button secondary"));
  const section=el("section", {}, el("div", { class: "shop-section-top" }, el("h2", {}, "Produtos"), link("Novo produto +", "/admin/produtos/novo", "shop-button")), search, items.length ? el("div", { class: "shop-table-wrap" }, el("table", { class: "shop-table" }, el("thead", {}, el("tr", {}, ["Produto", "SKU", "Tipo", "Pre\xE7o", "Estoque", "Status", ""].map((t) => el("th", {}, t)))), el("tbody", {}, items.map((product) => el("tr", {}, el("td", {}, el("div", { class: "shop-table-product" }, image(productImage(product).url, product.name), el("span", {}, product.name))), el("td", {}, product.sku || "\u2014"), el("td", {}, product.kind === "SINGLE" ? "Carta" : "Lacrado"), el("td", {}, money(lowest(product))), el("td", {}, asArray(product.variants).reduce((n, v) => n + v.stock, 0)), el("td", {}, badge(product.published ? "Publicado" : "Rascunho")), el("td", {}, link("Editar \u2197", `/admin/produtos/${encodeURIComponent(product.id)}`, "shop-text-link"))))))) : empty("Seu cat\xE1logo est\xE1 pronto para come\xE7ar.", "Cadastre o primeiro produto para definir pre\xE7o, estoque e vers\xF5es.", link("Cadastrar produto", "/admin/produtos/novo", "shop-button")));
  const current=data.pagination?.page||1,pages=data.pagination?.pages||1;
  if(pages>1)section.append(el("nav",{class:"shop-pagination","aria-label":"Paginação administrativa"},button("← Anterior",()=>goPage("/admin/produtos",current-1),"shop-button secondary",{disabled:current<=1}),el("span",{},`Página ${current} de ${pages}`),button("Próxima →",()=>goPage("/admin/produtos",current+1),"shop-button secondary",{disabled:current>=pages})));
  return section;
}
function shopTable(columns,rows){
  return el("div",{class:"shop-table-wrap"},el("table",{class:"shop-table"},
    el("thead",{},el("tr",{},columns.map(text=>el("th",{},text)))),
    el("tbody",{},rows.map(cells=>el("tr",{},cells.map(cell=>el("td",{},cell)))))
  ));
}
async function adminInventory(){
  const params=new URLSearchParams(location.search);params.set("pageSize","48");
  const [data,movements]=await Promise.all([api(`/admin/products?${params}`),api("/admin/inventory")]);
  const search=el("form",{class:"shop-inline-form",onSubmit:event=>{
    event.preventDefault();navigate(`/admin/estoque?q=${encodeURIComponent(new FormData(search).get("q")||"")}`);
  }},el("input",{name:"q",type:"search",placeholder:"Pesquisar produto ou SKU","aria-label":"Pesquisar estoque",value:params.get("q")||""}),button("Buscar",()=>search.requestSubmit(),"shop-button secondary"));
  const rows=asArray(data.items).flatMap(product=>asArray(product.variants).map(variant=>[
    el("div",{},el("strong",{},product.name),el("p",{class:"shop-fine"},product.sku)),
    `${languages[variant.language]||variant.language} · ${conditions[variant.condition]||variant.condition} · ${finishes[variant.finish]||variant.finish}`,
    badge(variant.stock===0?"Esgotado":`${variant.stock} unidades`),money(variant.priceCents),
    link("Ajustar ↗",`/admin/produtos/${encodeURIComponent(product.id)}`,"shop-text-link")
  ]));
  const history=asArray(movements.items).map(item=>[
    item.name,item.delta>0?`+${item.delta}`:String(item.delta??"—"),item.resulting_stock??item.balance??item.stock_after??"—",item.reason||"Ajuste de estoque",item.created_at?new Date(item.created_at).toLocaleString("pt-BR"):"—"
  ]),pagination=data.pagination||{};
  return el("section",{},
    el("div",{class:"shop-section-top"},el("h2",{},"Estoque por variante"),link("Cadastrar produto +","/admin/produtos/novo","shop-button secondary")),
    el("p",{class:"shop-muted"},"Cada idioma, condição e acabamento possui seu próprio saldo. Abra o anúncio para ajustar quantidade ou preço."),search,
    rows.length?shopTable(["Produto / SKU","Variante","Estoque","Preço",""],rows):message("Nenhum produto encontrado."),
    pagination.pages>1?el("nav",{class:"shop-pagination","aria-label":"Paginação do estoque"},button("← Anterior",()=>goPage("/admin/estoque",pagination.page-1),"shop-button secondary",{disabled:pagination.page<=1}),el("span",{},`Página ${pagination.page} de ${pagination.pages}`),button("Próxima →",()=>goPage("/admin/estoque",pagination.page+1),"shop-button secondary",{disabled:pagination.page>=pagination.pages})):null,
    el("section",{class:"shop-section"},el("h2",{},"Últimas movimentações"),history.length?shopTable(["Produto","Alteração","Saldo","Motivo","Data"],history):message("As alterações de estoque aparecerão aqui."))
  );
}
async function productEditor(id) {
  let product = { kind: "SINGLE", name: "", slug: "", sku: "", description: "", setId: "", setName: "", tcg: "pokemon", images: [], variants: [], published: false, featured: false, card: null };
  if (id) {
    const result = await api(`/admin/products/${encodeURIComponent(id)}`);
    product = result.product || result;
  }
  let cardMetadata = product.card;
  const manualNumber=field("Número da carta (manual)","manualNumber","text",cardMetadata?.number||"");
  const manualTotal=field("Total impresso da coleção","manualTotal","text",cardMetadata?.total||"");
  const manualRarity=field("Raridade (manual)","manualRarity","text",cardMetadata?.rarity||"");
  const manualType=field("Tipo da carta (manual)","manualType","text",cardMetadata?.type||"");
  const manualHp=field("HP (manual)","manualHp","text",cardMetadata?.hp||"");
  const manualStatus=el("div",{"aria-live":"polite"});
  const manualSection=el("details",{class:"shop-admin-section"},el("summary",{},"Cadastrar ou corrigir os dados manualmente"),el("p",{class:"shop-fine"},"Use os dados impressos na carta. Preencha também o ID e o nome da coleção abaixo. Essa opção funciona mesmo quando o catálogo externo não responde."),el("div",{class:"shop-form-grid"},manualNumber,manualTotal,manualRarity,manualType,manualHp),button("Confirmar dados manuais",()=>{
    const read=node=>node.querySelector("input").value.trim();
    if(!read(manualNumber)||!setId.querySelector("input").value.trim()||!name.querySelector("input").value.trim()){manualStatus.replaceChildren(message("Preencha nome, ID da coleção e número da carta.","error"));return;}
    cardMetadata={name:name.querySelector("input").value.trim(),number:read(manualNumber),total:read(manualTotal)||null,rarity:read(manualRarity),type:read(manualType),hp:read(manualHp)||null,provider:"manual",providerId:"",language:variantValues[0]?.language||"pt"};
    manualStatus.replaceChildren(message("Dados manuais confirmados. Confira as imagens, o preço e o estoque antes de salvar.","success"));
  },"shop-button secondary"),manualStatus);
  manualSection.hidden=product.kind!=="SINGLE";
  let imageValues = asArray(product.images).map((img) => ({ ...img }));
  let variantValues = asArray(product.variants).map((v) => ({ ...v }));
  if (!variantValues.length) variantValues = [{ language: "pt", condition: product.kind === "SINGLE" ? "NM" : "SEALED", finish: "NORMAL", priceCents: 0, compareAtCents: null, stock: 0 }];
  const status = el("div", { "aria-live": "polite" });
  const kind = selectField("Tipo de produto", "kind", [["SINGLE", "Carta avulsa"], ["SEALED", "Produto lacrado"]], product.kind);
  const name = field("Nome do produto", "name", "text", product.name, { required: true, maxlength: "200" });
  const setId = field("ID da cole\xE7\xE3o", "setId", "text", product.setId || "");
  const setName = field("Nome da cole\xE7\xE3o", "setName", "text", product.setName || "");
  const description = field("Descri\xE7\xE3o", "description", "textarea", product.description, { rows: "5", maxlength: "10000" });
  const cardSearch = el("section", { class: "shop-admin-section" });
  const imageList = el("div", { class: "shop-image-editor" });
  const variantList = el("div", { class: "shop-variant-editor" });
  function renderImages() {
    setChildren(imageList,imageValues.map((img, i) => el("div", { class: "shop-image-editor-row" }, image(img.url, `Imagem ${i + 1}`), el("div", {}, el("p", {}, img.kind === "actual" ? "Foto real" : "Imagem de refer\xEAncia"), el("span", { class: "shop-fine" }, img.url)), button("Remover", () => {
      imageValues.splice(i, 1);
      renderImages();
    }, "shop-text-link"))));
  }
  function renderVariants() {
    setChildren(variantList,variantValues.map((variant, index) => {
      const row = el("fieldset", { class: "shop-variant-row" }, el("legend", {}, `Vers\xE3o ${index + 1}`), selectField("Idioma", "language", Object.entries(languages), variant.language || "pt"), selectField("Condi\xE7\xE3o", "condition", Object.entries(conditions), variant.condition || "NM"), selectField("Acabamento", "finish", Object.entries(finishes), variant.finish || "NORMAL"), field("Pre\xE7o (R$)", "price", "number", ((variant.priceCents || 0) / 100).toFixed(2), { min: ".01", step: ".01", required: true }), field("Pre\xE7o anterior (R$)", "compareAt", "number", variant.compareAtCents ? (variant.compareAtCents / 100).toFixed(2) : "", { min: "0", step: ".01" }), field("Estoque", "stock", "number", variant.stock || 0, { min: "0", step: "1", required: true }), button("Remover vers\xE3o", () => {
        captureVariants();
        variantValues.splice(index, 1);
        renderVariants();
      }, "shop-text-link", { disabled: variantValues.length === 1 }));
      row.dataset.variantIndex = index;
      return row;
    }));
  }
  function captureVariants() {
    variantValues = [...variantList.children].map((row, index) => {
      const value = (name2) => row.querySelector(`[name=${name2}]`).value;
      return { ...variantValues[index], language: value("language"), condition: value("condition"), finish: value("finish"), priceCents: Math.round(Number(value("price")) * 100), compareAtCents: value("compareAt") ? Math.round(Number(value("compareAt")) * 100) : null, stock: Number(value("stock")) };
    });
  }
  renderImages();
  renderVariants();
  const imageUrl = el("input", { type: "url", placeholder: "https://\u2026", "aria-label": "Endere\xE7o da imagem" });
  const imageKind = el("select", { "aria-label": "Tipo da imagem" }, el("option", { value: "actual" }, "Foto real"), el("option", { value: "reference" }, "Imagem de refer\xEAncia"));
  const addImage = () => {
    const url = safeImage(imageUrl.value);
    if (!url) {
      toast("Informe um endere\xE7o HTTP ou HTTPS v\xE1lido.");
      return;
    }
    imageValues.push({ url, kind: imageKind.value });
    imageUrl.value = "";
    renderImages();
  };
  const upload = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp", "aria-label": "Enviar foto real do produto", onChange: async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast("Escolha uma imagem com at\xE9 8 MB.");
      return;
    }
    event.target.disabled = true;
    try {
      const payload = await prepareImageUpload(file);
      const result = await api("/admin/uploads", { method: "POST", body: payload });
      imageValues.push({ url: result.url, kind: result.kind || "actual" });
      renderImages();
      toast("Imagem enviada.");
    } catch (error) {
      toast(displayError(error));
    } finally {
      event.target.disabled = false;
      event.target.value = "";
    }
  } });
  const form = el("form", { class: "shop-product-form", onSubmit: async (event) => {
    event.preventDefault();
    captureVariants();
    const values = Object.fromEntries(new FormData(form));
    if (values.kind === "SINGLE" && !cardMetadata) {
      status.replaceChildren(message("Busque e confirme a carta, ou use o cadastro manual, antes de salvar.", "error"));
      return;
    }
    if (!imageValues.length) {
      status.replaceChildren(message("Adicione uma imagem de refer\xEAncia ou uma foto real do produto.", "error"));
      return;
    }
    const payload = { kind: values.kind, name: values.name.trim(), slug: values.slug.trim() || void 0, description: values.description.trim(), sku: values.sku.trim(), setId: values.setId.trim(), setName: values.setName.trim(), tcg: values.tcg, images: imageValues, card: values.kind === "SINGLE" ? cardMetadata : null, variants: variantValues, published: values.published === "on", featured: values.featured === "on", attributes:{...product.attributes,category:values.productCategory.trim(),manufacturer:values.manufacturer.trim(),contents:values.contents.trim(),specifications:values.specifications.trim(),sellerNotes:values.sellerNotes.trim(),weightGrams:Number(values.weightGrams)||null,widthCm:Number(values.widthCm)||null,heightCm:Number(values.heightCm)||null,lengthCm:Number(values.lengthCm)||null} };
    const submit = form.querySelector("[type=submit]");
    submit.disabled = true;
    status.replaceChildren();
    try {
      const result = await api(`/admin/products${id ? `/${encodeURIComponent(id)}` : ""}`, { method: id ? "PUT" : "POST", body: payload });
      toast(id ? "Produto atualizado." : "Produto cadastrado.");
      navigate(`/admin/produtos/${encodeURIComponent((result.product || result).id || id)}`, { replace: true });
    } catch (error) {
      status.replaceChildren(message(displayError(error), "error"));
      submit.disabled = false;
    }
  } }, el("div", { class: "shop-section-top" }, el("h2", {}, id ? "Editar produto" : "Novo produto"), link("\u2190 Produtos", "/admin/produtos", "shop-text-link")), el("section", { class: "shop-admin-section" }, el("h3", {}, "Informa\xE7\xF5es do produto"), el("div", { class: "shop-form-grid" }, kind, selectField("TCG", "tcg", [["pokemon", "Pok\xE9mon TCG"]], product.tcg || "pokemon"), name, field("SKU interno", "sku", "text", product.sku || "", { required: true }), field("Endere\xE7o do produto", "slug", "text", product.slug || "", { placeholder: "Gerado a partir do nome" }))), cardSearch, manualSection, el("section",{class:"shop-admin-section"},el("h3",{},"Características e envio"),el("div",{class:"shop-form-grid"},field("Categoria","productCategory","text",product.attributes?.category||"",{placeholder:"Ex.: Booster, ETB, Box, Carta avulsa",maxlength:"100"}),field("Fabricante","manufacturer","text",product.attributes?.manufacturer||"",{maxlength:"100"}),field("Peso (g)","weightGrams","number",product.attributes?.weightGrams||"",{min:"0",step:"1"}),field("Largura (cm)","widthCm","number",product.attributes?.widthCm||"",{min:"0",step:".1"}),field("Altura (cm)","heightCm","number",product.attributes?.heightCm||"",{min:"0",step:".1"}),field("Comprimento (cm)","lengthCm","number",product.attributes?.lengthCm||"",{min:"0",step:".1"})),field("Conteúdo","contents","textarea",product.attributes?.contents||"",{rows:"3",maxlength:"2000"}),field("Especificações","specifications","textarea",product.attributes?.specifications||"",{rows:"3",maxlength:"2000"}),field("Observações do anúncio","sellerNotes","textarea",product.attributes?.sellerNotes||"",{rows:"3",maxlength:"2000"})), el("section", { class: "shop-admin-section" }, el("h3", {}, "Cole\xE7\xE3o e descri\xE7\xE3o"), el("div", { class: "shop-form-grid" }, setId, setName), description), el("section", { class: "shop-admin-section" }, el("div", { class: "shop-section-top" }, el("h3", {}, "Imagens"), el("span", { class: "shop-fine" }, "Refer\xEAncia e foto real identificadas")), imageList, el("div", { class: "shop-inline-form" }, imageUrl, imageKind, button("Adicionar URL", addImage, "shop-button secondary")), el("label", { class: "shop-field" }, el("span", {}, "Enviar foto real (PNG, JPEG ou WebP, at\xE9 8 MB)"), upload)), el("section", { class: "shop-admin-section" }, el("div", { class: "shop-section-top" }, el("h3", {}, "Vers\xF5es, pre\xE7o e estoque"), button("Adicionar vers\xE3o +", () => {
    captureVariants();
    variantValues.push({ language: "pt", condition: kind.querySelector("select").value === "SINGLE" ? "NM" : "SEALED", finish: "NORMAL", priceCents: 0, stock: 0 });
    renderVariants();
  }, "shop-button secondary")), el("p", { class: "shop-fine" }, "Cada combina\xE7\xE3o de idioma, condi\xE7\xE3o e acabamento tem estoque e pre\xE7o pr\xF3prios. Valores em reais."), variantList), el("section", { class: "shop-admin-section" }, el("h3", {}, "Publica\xE7\xE3o"), checkbox("Publicar na loja", "published", product.published), checkbox("Exibir nos destaques da p\xE1gina inicial", "featured", product.featured)), status, el("div", { class: "shop-actions" }, el("button", { type: "submit", class: "shop-button" }, "Salvar produto"), link("Voltar \xE0 lista", "/admin/produtos", "shop-button secondary"),id&&product.published?link("Ver anúncio ↗",`/produto/${encodeURIComponent(product.slug)}`,"shop-button secondary"):null,id?button("Arquivar produto",()=>{const confirm=button("Confirmar arquivamento",async()=>{confirm.disabled=true;try{await api(`/admin/products/${encodeURIComponent(id)}`,{method:"DELETE"});toast("Produto arquivado e removido do catálogo público.");navigate("/admin/produtos");}catch(error){status.replaceChildren(message(displayError(error),"error"));}},"shop-button secondary");setChildren(status,message("Arquivar remove o anúncio da loja e preserva seu histórico. Deseja continuar?"),confirm,button("Manter produto",()=>status.replaceChildren(),"shop-text-link"));confirm.focus();},"shop-text-link"):null));
  kind.querySelector("select").addEventListener("change", () => {
    captureVariants();
    const sealed=kind.querySelector("select").value==="SEALED";
    variantValues=variantValues.map(variant=>({...variant,condition:sealed?"SEALED":variant.condition==="SEALED"?"NM":variant.condition}));
    renderVariants();
    renderCardSearch();
  });
  async function renderCardSearch() {
    const isSingle = kind.querySelector("select").value === "SINGLE";
    cardSearch.hidden = !isSingle;
    manualSection.hidden = !isSingle;
    if (!isSingle) return;
    const body = el("div", {}, loading("Carregando cole\xE7\xF5es\u2026"));
    cardSearch.replaceChildren(el("h3", {}, "Identifique a carta"), el("p", { class: "shop-fine" }, "Selecione a cole\xE7\xE3o, informe o n\xFAmero e confirme o resultado. Os dados do cat\xE1logo preenchem a ficha; pre\xE7o e estoque s\xE3o definidos por voc\xEA."), body);
    try {
      let showSelected = function() {
        setChildren(chosen,cardMetadata ? message(`Dados confirmados: ${cardMetadata.name || name.querySelector("input").value} \xB7 ${cardMetadata.number || ""}.`, "success") : null);
      };
      const sets = await api("/catalog/sets?language=pt");
      const lang = selectField("Idioma de refer\xEAncia", "catalogLanguage", [["pt", "Portugu\xEAs"], ["en", "Ingl\xEAs"], ["ja", "Japon\xEAs"]], "pt");
      const set = selectField("Cole\xE7\xE3o", "catalogSet", [["", "Selecione a cole\xE7\xE3o"], ...asArray(sets.items || sets.sets).map((s) => [s.id, s.name])], product.setId || "");
      const number = field("N\xFAmero da carta", "catalogNumber", "text", cardMetadata?.number || "", { placeholder: "Ex.: 276" });
      const results = el("div", { "aria-live": "polite" });
      const chosen = el("div");
      showSelected();
      lang.querySelector("select").addEventListener("change", async (event) => {
        set.querySelector("select").replaceChildren(el("option", { value: "" }, "Carregando\u2026"));
        try {
          const next = await api(`/catalog/sets?language=${encodeURIComponent(event.target.value)}`);
          set.querySelector("select").replaceChildren(el("option", { value: "" }, "Selecione a cole\xE7\xE3o"), ...asArray(next.items || next.sets).map((s) => el("option", { value: s.id }, s.name)));
        } catch (error) {
          results.replaceChildren(message(displayError(error), "error"));
        }
      });
      const searchButton = button("Buscar carta", async () => {
        const collection = set.querySelector("select").value;
        const cardNumber = number.querySelector("input").value.trim();
        if (!collection || !cardNumber) {
          results.replaceChildren(message("Escolha uma cole\xE7\xE3o e informe o n\xFAmero da carta.", "error"));
          return;
        }
        searchButton.disabled = true;
        results.replaceChildren(loading("Consultando o cat\xE1logo de cartas\u2026"));
        try {
          const response = await api(`/catalog/search?set=${encodeURIComponent(collection)}&number=${encodeURIComponent(cardNumber)}&language=${encodeURIComponent(lang.querySelector("select").value)}`);
          const cards = asArray(response.items || response.cards || response.results);
          results.replaceChildren(cards.length ? el("div", { class: "shop-catalog-choices" }, cards.map((card) => el("article", { class: "shop-catalog-choice" }, image(card.image || card.imageUrl || card.images?.large || card.images?.[0]?.url, card.name), el("div", {}, el("h4", {}, card.name), el("p", {}, `${card.number} \xB7 ${card.setName || set.querySelector("select").selectedOptions[0]?.textContent || ""}`), el("p", { class: "shop-fine" }, [card.rarity, card.artist].filter(Boolean).join(" \xB7 ")), button("Confirmar esta carta", () => {
            cardMetadata = { ...card, number: String(card.number), name: card.name, provider: card.provider || response.provider };
            name.querySelector("input").value = card.name;
            setId.querySelector("input").value = card.setId || collection;
            setName.querySelector("input").value = card.setName || set.querySelector("select").selectedOptions[0]?.textContent || "";
            const url = card.image || card.imageUrl || card.images?.large || card.images?.[0]?.url;
            if (safeImage(url) && !imageValues.some((img) => img.url === url)) {
              imageValues.push({ url, kind: "reference" });
              renderImages();
            }
            showSelected();
            results.replaceChildren();
            toast("Dados da carta preenchidos. Confira as vers\xF5es comerciais abaixo.");
          }))))) : message("Nenhuma carta encontrada. Confira cole\xE7\xE3o, idioma e n\xFAmero."));
        } catch (error) {
          results.replaceChildren(message(displayError(error), "error"));
        } finally {
          searchButton.disabled = false;
        }
      }, "shop-button secondary");
      body.replaceChildren(el("div", { class: "shop-form-grid" }, lang, set, number), searchButton, chosen, results);
    } catch (error) {
      body.replaceChildren(message(displayError(error), "error"), button("Tentar carregar cole\xE7\xF5es", () => renderCardSearch(), "shop-button secondary"));
    }
  }
  renderCardSearch();
  return form;
}
async function adminSettings() {
  const response=await api("/admin/settings"),settings=response.settings||response,shipping=settings.shipping||{},status=el("div",{"aria-live":"polite"});
  let banners=asArray(settings.banners).map(item=>({...item}));
  const bannerList=el("div",{class:"shop-banner-editor"});
  function captureBanners(){banners=[...bannerList.children].map((row,index)=>({...banners[index],title:row.querySelector("[name=bannerTitle]").value.trim(),subtitle:row.querySelector("[name=bannerSubtitle]").value.trim(),image:row.querySelector("[name=bannerImage]").value.trim(),url:row.querySelector("[name=bannerUrl]").value.trim(),active:row.querySelector("[name=bannerActive]").checked}));}
  function renderBanners(){setChildren(bannerList,banners.map((item,index)=>{const preview=el("div",{class:"shop-banner-preview"},item.image?image(item.image,item.title||"Banner"):null),imageField=field("URL da imagem","bannerImage","url",item.image||"",{placeholder:"https://…"});imageField.querySelector("input").addEventListener("change",event=>setChildren(preview,safeImage(event.target.value)?image(event.target.value,item.title||"Banner"):null));
    const upload=el("input",{type:"file",accept:"image/png,image/jpeg,image/webp","aria-label":`Enviar imagem do banner ${index+1}`,onChange:async event=>{const file=event.target.files[0];if(!file)return;if(file.size>8*1024*1024){toast("Escolha uma imagem com até 8 MB.");return;}event.target.disabled=true;try{const payload=await prepareImageUpload(file);const result=await api("/admin/uploads",{method:"POST",body:payload});imageField.querySelector("input").value=result.url;setChildren(preview,image(result.url,item.title||"Banner"));toast("Imagem do banner enviada.");}catch(error){toast(displayError(error));}finally{event.target.disabled=false;event.target.value="";}}});
    return el("fieldset",{class:"shop-banner-row"},el("legend",{},`Banner ${index+1}`),preview,el("div",{class:"shop-form-grid"},field("Título","bannerTitle","text",item.title||"",{required:true,maxlength:"150"}),field("Subtítulo","bannerSubtitle","text",item.subtitle||"",{maxlength:"300"}),imageField,field("Destino dentro da loja","bannerUrl","text",item.url||"",{placeholder:"Ex.: /cartas?set=sv09",pattern:"/[^]*",maxlength:"300"})),el("label",{class:"shop-field"},el("span",{},"Enviar imagem (até 8 MB)"),upload),checkbox("Exibir este banner","bannerActive",item.active!==false),button("Remover banner",()=>{captureBanners();banners.splice(index,1);renderBanners();},"shop-text-link"));}));}
  renderBanners();
  const form=el("form",{class:"shop-settings-form",onSubmit:async event=>{event.preventDefault();const values=Object.fromEntries(new FormData(form)),submit=form.querySelector("[type=submit]");submit.disabled=true;status.replaceChildren();try{captureBanners();if(banners.some(item=>item.url&&(!item.url.startsWith("/")||item.url.startsWith("//"))))throw new Error("O destino dos banners deve ser um endereço interno, como /cartas.");const payload={...settings,storeName:values.storeName.trim(),contactEmail:values.contactEmail.trim(),whatsapp:values.whatsapp.trim(),instagram:values.instagram.trim(),companyName:values.companyName.trim(),cnpj:values.cnpj.trim(),address:values.address.trim(),about:values.about.trim(),privacyPolicy:values.privacyPolicy.trim(),shippingPolicy:values.shippingPolicy.trim(),returnsPolicy:values.returnsPolicy.trim(),terms:values.terms.trim(),categories:values.categories.split(",").map(item=>item.trim()).filter(Boolean),banners,shipping:{...shipping,enabled:values.shippingEnabled==="on",flatRateCents:Math.round(Number(values.flatRate)*100),estimatedDays:Number(values.estimatedDays),freeShippingEnabled:values.freeShippingEnabled==="on",freeShippingThresholdCents:Number(values.freeShippingThreshold)>0?Math.round(Number(values.freeShippingThreshold)*100):null,regions:String(values.regions||"").split(",").map(value=>value.trim()).filter(Boolean).map(value=>{const[start,end]=value.split(":").map(item=>item.replace(/\D/g,""));if(start?.length!==8||end?.length!==8||start>end)throw new Error("Informe faixas de CEP como 01000000:09999999.");return{start,end};})}};await api("/admin/settings",{method:"PUT",body:payload});const config=await api("/config");state.config=config.config||config;renderNav();status.replaceChildren(message("Configurações salvas.","success"));toast("Configurações atualizadas.");}catch(error){status.replaceChildren(message(displayError(error),"error"));}finally{submit.disabled=false;}}},el("h2",{},"Configurações da loja"),el("section",{class:"shop-admin-section"},el("h3",{},"Informações e contato"),el("div",{class:"shop-form-grid"},field("Nome da loja","storeName","text",settings.storeName||"BKM TCG",{required:true}),field("E-mail de atendimento","contactEmail","email",settings.contactEmail||""),field("WhatsApp com DDD","whatsapp","tel",settings.whatsapp||""),field("Instagram","instagram","text",settings.instagram||""),field("Razão social","companyName","text",settings.companyName||""),field("CNPJ","cnpj","text",settings.cnpj||""),field("Endereço comercial","address","text",settings.address||"")),field("Categorias (separadas por vírgula)","categories","text",asArray(settings.categories).join(", "),{placeholder:"Booster, ETB, Box, Blister, Carta avulsa"})),el("section",{class:"shop-admin-section"},el("h3",{},isDemo()?"Entrega de demonstração":"Entrega"),el("p",{class:"shop-fine"},isDemo()?"Taxa e prazo ilustrativos, sem contratação de entrega real. As faixas de CEP definem a elegibilidade inclusive para frete grátis.":"Defina a taxa, o prazo e a cobertura da modalidade disponível."),checkbox("Ativar cálculo de entrega","shippingEnabled",shipping.enabled),el("div",{class:"shop-form-grid"},field("Taxa de entrega (R$)","flatRate","number",((shipping.flatRateCents||0)/100).toFixed(2),{min:"0",step:".01",required:true}),field("Estimativa em dias úteis","estimatedDays","number",shipping.estimatedDays||7,{min:"1",max:"90",required:true}),field("Faixas de CEP atendidas","regions","text",asArray(shipping.regions).map(region=>`${region.start}:${region.end}`).join(", "),{placeholder:"01000000:09999999, 20000000:28999999"})),checkbox("Oferecer frete grátis a partir de um valor","freeShippingEnabled",shipping.freeShippingEnabled),field("Valor mínimo para frete grátis (R$)","freeShippingThreshold","number",((shipping.freeShippingThresholdCents||0)/100).toFixed(2),{min:"0",step:".01"})),el("section",{class:"shop-admin-section"},el("div",{class:"shop-section-top"},el("h3",{},"Banners da home"),button("Adicionar banner +",()=>{captureBanners();banners.push({title:"",subtitle:"",image:"",url:"/busca",active:true});renderBanners();},"shop-button secondary")),bannerList),el("section",{class:"shop-admin-section"},el("h3",{},"Pagamentos"),message(isDemo()?"Provedor de demonstração: simule resultados no checkout. Cobranças reais estão desativadas.":state.config.payments?.reason||"O provedor real deve ser configurado e validado antes da abertura comercial."),el("p",{class:"shop-fine"},"As credenciais permanecem no ambiente seguro do servidor e nunca são solicitadas neste painel.")),el("section",{class:"shop-admin-section"},el("h3",{},"Sobre e políticas da loja"),field("Sobre a BKM","about","textarea",settings.about||"",{rows:"4"}),field("Política de privacidade","privacyPolicy","textarea",settings.privacyPolicy||"",{rows:"5"}),field("Política de envio","shippingPolicy","textarea",settings.shippingPolicy||"",{rows:"5"}),field("Trocas e devoluções","returnsPolicy","textarea",settings.returnsPolicy||"",{rows:"5"}),field("Termos de uso","terms","textarea",settings.terms||"",{rows:"5"})),status,el("button",{type:"submit",class:"shop-button"},"Salvar configurações"));
  return form;
}
async function adminCoupons() {
  const response=await api("/admin/coupons"),items=asArray(response.items||response.coupons),editing=items.find(item=>item.id===new URLSearchParams(location.search).get("edit")),status=el("div",{"aria-live":"polite"});
  const form=el("form",{class:"shop-coupon-editor",onSubmit:async event=>{event.preventDefault();const values=Object.fromEntries(new FormData(form)),submit=form.querySelector("[type=submit]");submit.disabled=true;try{const amount=Number(values.value),payload={code:values.code.trim().toUpperCase(),type:values.type,value:values.type==="PERCENT"?amount:Math.round(amount*100),minimumCents:Math.round(Number(values.minimum||0)*100),startsAt:editing?.startsAt||null,maxUses:values.maxUses?Number(values.maxUses):null,endsAt:values.expiresAt?new Date(`${values.expiresAt}T23:59:59-03:00`).toISOString():null,active:values.active==="on"};await api(`/admin/coupons${editing?`/${encodeURIComponent(editing.id)}`:""}`,{method:editing?"PUT":"POST",body:payload});toast(editing?"Cupom atualizado.":"Cupom criado.");navigate("/admin/cupons",{replace:true});}catch(error){status.replaceChildren(message(displayError(error),"error"));submit.disabled=false;}}},el("h3",{},editing?"Editar cupom":"Criar cupom"),el("div",{class:"shop-form-grid"},field("Código","code","text",editing?.code||"",{required:true,pattern:"[A-Za-z0-9_-]{3,40}",placeholder:"Ex.: BKMDEMO"}),selectField("Tipo","type",[["PERCENT","Percentual (%)"],["FIXED","Valor fixo (R$)"]],editing?.type||"PERCENT"),field("Desconto","value","number",editing?(editing.type==="PERCENT"?editing.value:editing.value/100):"",{required:true,min:".01",step:".01"}),field("Compra mínima (R$)","minimum","number",((editing?.minimumCents||0)/100).toFixed(2),{min:"0",step:".01"}),field("Limite de usos","maxUses","number",editing?.maxUses||"",{min:"1",step:"1",placeholder:"Sem limite"}),field("Válido até","expiresAt","date",editing?.endsAt?.slice(0,10)||"")),checkbox("Ativar cupom","active",editing?editing.active:true),status,el("div",{class:"shop-actions"},el("button",{type:"submit",class:"shop-button"},editing?"Salvar cupom":"Criar cupom"),editing?link("Cancelar edição","/admin/cupons","shop-button secondary"):null));
  return el("section",{},el("h2",{},"Cupons e promoções"),items.length?el("div",{class:"shop-table-wrap"},el("table",{class:"shop-table"},el("thead",{},el("tr",{},["Código","Desconto","Usos","Status","Validade",""].map(text=>el("th",{},text)))),el("tbody",{},items.map(coupon=>el("tr",{},el("td",{},coupon.code),el("td",{},coupon.type==="PERCENT"?`${coupon.value}%`:money(coupon.value)),el("td",{},`${coupon.usedCount||0}${coupon.maxUses?` / ${coupon.maxUses}`:""}`),el("td",{},coupon.active?"Ativo":"Inativo"),el("td",{},coupon.endsAt?new Date(coupon.endsAt).toLocaleDateString("pt-BR"):"Sem prazo"),el("td",{},link("Editar ↗",`/admin/cupons?edit=${encodeURIComponent(coupon.id)}`,"shop-text-link"))))))):message("Nenhum cupom cadastrado."),form);
}
async function adminEmails(){
  const response=await api("/admin/emails"),items=asArray(response.items),status=el("div",{"aria-live":"polite"});
  return el("section",{},el("div",{class:"shop-section-top"},el("h2",{},"E-mails transacionais"),button("Atualizar",()=>renderRoute(),"shop-button secondary")),isDemo()?message("Prévia de demonstração: estas mensagens não são enviadas a endereços externos. Dados sensíveis e links de recuperação são ocultados."):null,status,items.length?el("div",{class:"shop-email-list"},items.map(item=>el("details",{class:"shop-admin-section shop-email-preview"},el("summary",{},el("span",{},el("strong",{},item.subject),el("small",{},`${item.to||"Destinatário protegido"} · ${item.createdAt?new Date(item.createdAt).toLocaleString("pt-BR"):""}`)),badge(item.status||"Prévia")),el("pre",{},item.text||"Prévia de texto indisponível."),button(isDemo()?"Reprocessar prévia":"Reprocessar mensagem",async event=>{const trigger=event.currentTarget;trigger.disabled=true;try{await api(`/admin/emails/${encodeURIComponent(item.id)}/retry`,{method:"POST",body:{}});toast(isDemo()?"Prévia reprocessada, sem envio externo.":"Mensagem reencaminhada para processamento.");renderRoute();}catch(error){status.replaceChildren(message(displayError(error),"error"));trigger.disabled=false;}},"shop-button secondary")))):empty("Nenhuma mensagem neste ambiente.","Ao criar uma conta ou simular pedidos, as prévias transacionais aparecerão aqui."));
}
async function adminCollections(){
  const response=await api("/admin/collections"),items=asArray(response.items),query=new URLSearchParams(location.search),editing=items.find(item=>item.id===query.get("edit")),status=el("div",{"aria-live":"polite"});
  let providerMetadata=editing?.metadata||null;
  const collectionId=field("ID da coleção","collectionId","text",editing?.id||"",{required:true,maxlength:"100",readonly:!!editing,placeholder:"Ex.: sv09"}),collectionName=field("Nome da coleção","collectionName","text",editing?.name||"",{required:true,maxlength:"200"}),collectionImage=field("Imagem / logotipo da coleção","collectionImage","url",editing?.image||"",{placeholder:"https://…"});
  const form=el("form",{class:"shop-admin-section",onSubmit:async event=>{event.preventDefault();const values=Object.fromEntries(new FormData(form)),submit=form.querySelector("[type=submit]");submit.disabled=true;try{const payload={id:values.collectionId.trim(),name:values.collectionName.trim(),description:values.collectionDescription.trim(),image:values.collectionImage.trim(),aliases:values.collectionAliases.split(",").map(value=>value.trim()).filter(Boolean),featured:values.collectionFeatured==="on",provider:providerMetadata?"tcgdex":"manual",metadata:providerMetadata||{}};await api(`/admin/collections${editing?`/${encodeURIComponent(editing.id)}`:""}`,{method:editing?"PUT":"POST",body:payload});toast("Coleção salva.");navigate("/admin/colecoes",{replace:true});}catch(error){status.replaceChildren(message(displayError(error),"error"));submit.disabled=false;}}},el("h3",{},editing?"Editar coleção":"Cadastrar coleção"),el("div",{class:"shop-form-grid"},collectionId,collectionName,collectionImage,field("Aliases (separados por vírgula)","collectionAliases","text",asArray(editing?.aliases).join(", "),{placeholder:"Nome alternativo, abreviação"})),field("Descrição","collectionDescription","textarea",editing?.description||"",{rows:"3",maxlength:"2000"}),checkbox("Destacar esta coleção na home","collectionFeatured",!!editing?.featured),status,el("div",{class:"shop-actions"},el("button",{type:"submit",class:"shop-button"},"Salvar coleção"),editing?link("Cancelar edição","/admin/colecoes","shop-button secondary"):null));
  const providerStatus=el("div",{"aria-live":"polite"}),providerList=el("div"),providerLanguage=selectField("Idioma dos metadados","providerLanguage",[["pt","Português"],["en","Inglês"],["ja","Japonês"]],"pt");
  const load=button("Consultar coleções TCGdex",async event=>{const trigger=event.currentTarget;trigger.disabled=true;setChildren(providerStatus,loading("Consultando coleções…"));try{const data=await api(`/catalog/sets?language=${encodeURIComponent(providerLanguage.querySelector("select").value)}`),sets=asArray(data.items||data.sets);let selected=sets[0];const select=selectField("Coleção para importar","providerCollection",sets.map(item=>[item.id,`${item.name} (${item.id})`]),selected?.id||"");select.querySelector("select").addEventListener("change",event=>selected=sets.find(item=>item.id===event.target.value));setChildren(providerList,select,button("Preencher ficha com metadados",()=>{if(!selected)return;if(editing&&selected.id!==editing.id){toast("Para importar outra coleção, abra o cadastro de nova coleção.");return;}providerMetadata=selected;collectionId.querySelector("input").value=selected.id;collectionName.querySelector("input").value=selected.name;if(selected.logo||selected.image)collectionImage.querySelector("input").value=selected.logo||selected.image;form.scrollIntoView({behavior:"smooth",block:"start"});collectionName.querySelector("input").focus({preventScroll:true});toast("Metadados importados para a ficha. Confira os dados e salve a coleção.");},"shop-button secondary"));providerStatus.replaceChildren();}catch(error){providerStatus.replaceChildren(message(displayError(error),"error"));}finally{trigger.disabled=false;}},"shop-button secondary");
  const search=el("input",{type:"search",placeholder:"Pesquisar nome, ID ou alias","aria-label":"Pesquisar coleções"}),table=el("div"),render=()=>{const term=search.value.toLocaleLowerCase("pt-BR"),filtered=items.filter(item=>[item.id,item.name,...asArray(item.aliases)].join(" ").toLocaleLowerCase("pt-BR").includes(term));setChildren(table,filtered.length?el("div",{class:"shop-table-wrap"},el("table",{class:"shop-table"},el("thead",{},el("tr",{},["Coleção","ID","Aliases","Destaque",""].map(text=>el("th",{},text)))),el("tbody",{},filtered.map(item=>el("tr",{},el("td",{},item.name),el("td",{},item.id),el("td",{},asArray(item.aliases).join(", ")||"—"),el("td",{},item.featured?"Sim":"Não"),el("td",{},link("Editar ↗",`/admin/colecoes?edit=${encodeURIComponent(item.id)}`,"shop-text-link"))))))):message("Nenhuma coleção encontrada."));};search.addEventListener("input",render);render();
  return el("section",{},el("div",{class:"shop-section-top"},el("h2",{},"Coleções"),editing?link("Nova coleção +","/admin/colecoes","shop-button secondary"):null),search,table,el("section",{class:"shop-admin-section shop-collection-import"},el("h3",{},"Importar metadados"),el("p",{class:"shop-fine"},"A consulta traz nomes e identificadores da TCGdex. Revise a ficha antes de salvar; preços e estoque pertencem aos anúncios."),providerLanguage,load,providerStatus,providerList),form);
}
async function adminOrders() {
  const data=await api("/admin/orders"),items=asArray(data.items||data.orders);
  return el("section",{},el("div",{class:"shop-section-top"},el("h2",{},isDemo()?"Pedidos de demonstração":"Pedidos"),button("Atualizar",()=>renderRoute(),"shop-button secondary")),demoNotice(),items.length?ordersList(items,true):empty("Nenhum pedido neste ambiente.","Simule uma compra pelo catálogo para acompanhar o pedido e seu histórico aqui.",link("Explorar a loja","/busca","shop-button secondary")));
}
function infoPage(path) {
  const data = {
    "/sobre": ["A BKM TCG.", "Uma nova descoberta para quem coleciona.", ["A BKM TCG nasce da emo\xE7\xE3o de abrir um pacote e encontrar uma carta que muda a cole\xE7\xE3o. Nossa loja re\xFAne produtos lacrados e cartas avulsas de Pok\xE9mon TCG.", "Estamos preparando nosso cat\xE1logo e nossa opera\xE7\xE3o. As informa\xE7\xF5es de disponibilidade, idioma e condi\xE7\xE3o de cada produto ser\xE3o apresentadas na pr\xF3pria p\xE1gina."]],
    "/contato": ["Vamos conversar.", "Atendimento BKM TCG.", []],
    "/perguntas-frequentes": ["Suas d\xFAvidas.", "Perguntas frequentes.", []],
    "/privacidade": ["Privacidade.", "Seus dados, com clareza.", ["Nesta loja, dados de conta, contato, endere\xE7o e pedido s\xE3o utilizados para autentica\xE7\xE3o, atendimento, entrega e acompanhamento de compras.", "Carrinho e favoritos s\xE3o armazenados neste navegador. A sess\xE3o da conta \xE9 mantida por um cookie de autentica\xE7\xE3o. N\xE3o armazenamos dados de cart\xE3o de cr\xE9dito neste site.", "Os dados permanecem no servidor da loja. Integra\xE7\xF5es de pagamento e entrega dever\xE3o ser identificadas nesta pol\xEDtica antes da abertura comercial. Para solicitar acesso, corre\xE7\xE3o ou exclus\xE3o de dados, utilize o atendimento da loja."]],
    "/trocas": ["Trocas e devolu\xE7\xF5es.", "Cuidado em cada etapa.", ["A pol\xEDtica operacional de trocas e devolu\xE7\xF5es est\xE1 em prepara\xE7\xE3o. Antes da abertura para vendas, a BKM publicar\xE1 os prazos, condi\xE7\xF5es, canais de solicita\xE7\xE3o e procedimentos aplic\xE1veis.", "Para informa\xE7\xF5es sobre um produto ou pedido, entre em contato com o atendimento. Preserve embalagem, itens e comprovantes at\xE9 receber as orienta\xE7\xF5es."]],
    "/envio": ["Envio e entrega.", "Da nossa sele\xE7\xE3o para sua cole\xE7\xE3o.", ["O valor do frete \xE9 calculado no carrinho a partir do CEP e das condi\xE7\xF5es configuradas pela loja. O prazo exibido \xE9 uma estimativa em dias \xFAteis.", "A opera\xE7\xE3o de envio e as regi\xF5es atendidas ser\xE3o informadas antes da abertura comercial. N\xE3o h\xE1 promessa de despacho ou prazo adicional sem confirma\xE7\xE3o no pedido."]],
    "/termos": ["Termos de uso.", "Transpar\xEAncia para colecionar.", ["Os produtos publicados apresentam pre\xE7o, estoque, idioma, condi\xE7\xE3o e acabamento quando aplic\xE1vel. Imagens de refer\xEAncia s\xE3o identificadas e podem variar em rela\xE7\xE3o ao item f\xEDsico.", "Disponibilidade e valores s\xE3o novamente conferidos pelo servidor na finaliza\xE7\xE3o. Uma a\xE7\xE3o no carrinho ou no cadastro n\xE3o confirma uma compra nem gera uma cobran\xE7a.", "A opera\xE7\xE3o comercial depende da configura\xE7\xE3o e valida\xE7\xE3o de pagamento e entrega. Estes termos devem ser complementados com os dados legais e a pol\xEDtica comercial definitiva antes da abertura da loja."]]
  };
  const page = data[path];
  if (!page) return el("div", { class: "shop-shell" }, heading("BKM TCG", "Essa p\xE1gina saiu da cole\xE7\xE3o."), message("O endere\xE7o n\xE3o foi encontrado."), link("Voltar ao in\xEDcio", "/", "shop-button"));
  const policyKey={"/sobre":"about","/privacidade":"privacyPolicy","/envio":"shippingPolicy","/trocas":"returnsPolicy","/termos":"terms"}[path];
  const configuredPolicy=policyKey&&state.config[policyKey];
  const paragraphs=configuredPolicy?configuredPolicy.split(/\n+/).filter(Boolean):page[2];
  const content = el("div", { class: "shop-prose" }, paragraphs.map((text) => el("p", {}, text)));
  if (path === "/contato") {
    const email = state.config.contactEmail;
    const whatsapp = String(state.config.whatsapp || "").replace(/\D/g, "");
    content.append(email ? el("p", {}, el("a", { href: `mailto:${email}`, class: "shop-text-link" }, email)) : message("O canal de e-mail ser\xE1 informado assim que o atendimento estiver configurado."), whatsapp ? el("p", {}, el("a", { href: `https://wa.me/${whatsapp}`, class: "shop-button secondary", target: "_blank", rel: "noopener noreferrer" }, "Conversar pelo WhatsApp \u2197")) : null, state.config.companyName ? el("p", {}, state.config.companyName) : null, state.config.cnpj ? el("p", {}, `CNPJ: ${state.config.cnpj}`) : null, state.config.address ? el("p", {}, state.config.address) : null);
  }
  if (path === "/perguntas-frequentes") {
    [["Como encontro uma carta?", "Use a busca e os filtros de cole\xE7\xE3o, idioma e condi\xE7\xE3o. Na p\xE1gina do produto, escolha a vers\xE3o antes de adicionar ao carrinho."], ["A foto \xE9 do produto real?", "As imagens s\xE3o identificadas como refer\xEAncia ou foto real. Confira a galeria e a descri\xE7\xE3o do produto."], ["Como o estoque funciona?", "Cada vers\xE3o possui seu pr\xF3prio estoque. A quantidade e o pre\xE7o s\xE3o conferidos no servidor antes da finaliza\xE7\xE3o."], ["Posso finalizar uma compra agora?", state.config.paymentConfigured ? "A disponibilidade de pagamento \xE9 informada no checkout." : "O pagamento ainda n\xE3o foi configurado. Voc\xEA pode explorar os produtos e preparar seu carrinho."], ["Como acompanho meu pedido?", "Entre na sua conta para consultar seus pedidos."]].forEach(([q, a]) => content.append(el("details", { class: "shop-faq" }, el("summary", {}, q), el("p", {}, a))));
  }
  return el("div", { class: "shop-shell shop-info" }, heading("BKM TCG", page[0], page[1]), content, path != "/contato" ? link("Fale com a BKM \u2197", "/contato", "shop-text-link") : null);
}
async function initialize() {
  try {
    const [session, config] = await Promise.all([api("/session"), api("/config")]);
    state.user = session.user;
    state.csrfToken = session.csrfToken;
    state.config = config.config || config;
    state.apiReady = true;
    if(state.user)await syncAccount();else await reconcileCart();
  } catch {
    state.apiReady = false;
  }
  renderNav();
}
if (navMount && mount && overlay) {
  renderNav();
  await initialize();
  await renderRoute();
}
