const navMount = document.querySelector("#store-nav");
const mount = document.querySelector("#storefront");
const overlay = document.querySelector("#store-overlay");
const experience = document.querySelector(".experience");
const money = (value) => Number.isFinite(value) ? (value / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "A calcular";
const asArray = (value) => Array.isArray(value) ? value : [];
const languages = { pt: "Portugu\xEAs", en: "Ingl\xEAs", ja: "Japon\xEAs", es: "Espanhol", fr: "Franc\xEAs", de: "Alem\xE3o", it: "Italiano", ko: "Coreano", zh: "Chin\xEAs" };
const conditions = { NM: "Near Mint", LP: "Levemente jogada", MP: "Moderadamente jogada", HP: "Muito jogada", DMG: "Danificada", SEALED: "Lacrado" };
const finishes = { NORMAL: "Normal", HOLO: "Holo", REVERSE: "Reverse holo", FOIL: "Foil" };
const icons = { search: "\u2315", heart: "\u2661", bag: "\u25B1", user: "\u25EF", menu: "\u2630", close: "\xD7", arrow: "\u2197", plus: "+", minus: "\u2212" };
let pageVersion = 0;
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
  const links = el("nav", { class: "shop-navigation", "aria-label": "Navega\xE7\xE3o da loja" }, link("Lacrados", "/lacrados"), link("Cartas avulsas", "/cartas"), link("A experi\xEAncia", "/"), link("Sobre a BKM", "/sobre"));
  const actions = el("div", { class: "shop-nav-actions" }, link(el("span", { "aria-hidden": true }, icons.heart), "/favoritos", "shop-icon"), link(el("span", { "aria-hidden": true }, icons.user), state.user ? "/conta" : "/entrar", "shop-icon"), button([el("span", { "aria-hidden": true }, icons.bag), el("span", { class: "shop-cart-count" }, count)], () => openCart(), "shop-icon", { "aria-label": `Abrir carrinho, ${count} ${count === 1 ? "item" : "itens"}` }));
  actions.children[0].setAttribute("aria-label", "Meus favoritos");
  actions.children[1].setAttribute("aria-label", state.user ? "Minha conta" : "Entrar na conta");
  navMount.replaceChildren(el("div", { class: "shop-nav-content" }, button(icons.menu, () => {
    const open = links.classList.toggle("is-open");
    navMount.querySelector(".shop-menu-toggle")?.setAttribute("aria-expanded", String(open));
  }, "shop-icon shop-menu-toggle", { "aria-label": "Abrir menu", "aria-expanded": "false" }), links, form, actions));
  setupSearchSuggestions(form);
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
      mount.replaceChildren(el("div", { class: "shop-shell" }, empty("Vamos conectar sua loja.", "A experi\xEAncia visual est\xE1 dispon\xEDvel. Para usar cat\xE1logo, estoque e conta, abra a loja pelo servidor local.", el("div", { class: "shop-actions" }, button("Tentar conectar", async () => {
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
    else if (path === "/conta") node = await accountPage();
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
  const data = await api("/products?featured=true&pageSize=8");
  return el("div", { class: "shop-shell shop-home-content" }, el("div", { class: "shop-section-top" }, el("div", {}, el("p", { class: "shop-kicker" }, "BKM TCG / COLECIONE O EXTRAORDIN\xC1RIO"), el("h2", {}, "O pr\xF3ximo cap\xEDtulo \xE9 seu.")), link("Explorar cat\xE1logo \u2197", "/busca", "shop-text-link")), el("div", { class: "shop-categories" }, link([el("span", { class: "shop-category-no" }, "01"), el("h3", {}, "O come\xE7o da surpresa."), el("p", {}, "Boosters, boxes e produtos lacrados."), el("span", { class: "shop-text-link" }, "Explorar lacrados \u2197")], "/lacrados", "shop-category"), link([el("span", { class: "shop-category-no" }, "02"), el("h3", {}, "A carta que faltava."), el("p", {}, "Encontre o pr\xF3ximo destaque da sua cole\xE7\xE3o."), el("span", { class: "shop-text-link" }, "Explorar cartas \u2197")], "/cartas", "shop-category cyan")), el("section", { class: "shop-section", "aria-label": "Produtos em destaque" }, el("div", { class: "shop-section-top" }, el("div", {}, el("p", { class: "shop-kicker" }, "SELE\xC7\xC3O BKM"), el("h2", {}, "Em destaque.")), link("Ver todos \u2197", "/busca", "shop-text-link")), data.items?.length ? productGrid(data.items) : empty("Uma nova cole\xE7\xE3o est\xE1 chegando.", "Nosso cat\xE1logo est\xE1 sendo preparado. Explore a experi\xEAncia enquanto selecionamos os primeiros produtos.", el("div", { class: "shop-actions" }, button("Rever a abertura", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.querySelector("#replay")?.click();
  }, "shop-button secondary"), state.user?.role === "ADMIN" ? link("Cadastrar primeiro produto", "/admin/produtos/novo", "shop-button") : link("Conhe\xE7a a BKM", "/sobre", "shop-text-link")))), el("div", { class: "shop-editorial" }, el("p", { class: "shop-kicker" }, "CADA CARTA TEM UMA HIST\xD3RIA"), el("h2", {}, "A sua cole\xE7\xE3o merece\numa nova descoberta."), el("p", {}, "Lacrados e cartas avulsas em um s\xF3 lugar. A identidade BKM, do primeiro pacote ao pr\xF3ximo encontro.")));
}
function productGrid(products) {
  return el("div", { class: "shop-grid" }, products.map(productCard));
}
function productCard(product) {
  catalogCache.set(product.id, product);
  const favorited = state.favorites.some((f) => f.id === product.id);
  const photo = productImage(product);
  return el("article", { class: "shop-product-card" }, el("div", { class: "shop-product-picture" }, link(image(photo.url, product.name), `/produto/${encodeURIComponent(product.slug)}`), button(favorited ? "\u2665" : "\u2661", (event) => toggleFavorite(product, event.currentTarget), "shop-favorite", { "aria-label": `${favorited ? "Remover" : "Adicionar"} ${product.name} ${favorited ? "dos" : "aos"} favoritos`, "aria-pressed": String(favorited) }), !available(product) ? badge("Indispon\xEDvel") : null), el("div", { class: "shop-product-meta" }, el("p", { class: "shop-product-set" }, product.setName || "Pok\xE9mon TCG"), link(el("h3", {}, product.name), `/produto/${encodeURIComponent(product.slug)}`), el("p", { class: "shop-product-detail" }, product.kind === "SINGLE" ? [product.card?.number, asArray(product.variants).map((v) => languages[v.language] || v.language).filter((v, i, a) => a.indexOf(v) === i).join(" \xB7 ")].filter(Boolean).join(" \xB7 ") : "Produto lacrado"), el("p", { class: "shop-price" }, asArray(product.variants).length > 1 ? el("span", {}, "A partir de ") : null, money(lowest(product))), link(available(product) ? "Escolher op\xE7\xE3o \u2197" : "Ver detalhes \u2197", `/produto/${encodeURIComponent(product.slug)}`, "shop-product-action")));
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
  if (path === "/cartas") search.set("kind", "SINGLE");
  if (path === "/lacrados") search.set("kind", "SEALED");
  search.set("pageSize", "12");
  const data = await api(`/products?${search}`);
  const setsData = {items: data.facets?.sets || []};
  const title = path === "/cartas" ? "Cartas avulsas." : path === "/lacrados" ? "Lacrados." : search.get("q") ? `Resultados para \u201C${search.get("q")}\u201D.` : "Encontre sua pr\xF3xima carta.";
  const filters = el("form", { class: "shop-filters", onSubmit: (e) => {
    e.preventDefault();
    applyFilters(filters, path);
  } }, field("Buscar", "q", "search", search.get("q") || "", { placeholder: "Nome, n\xFAmero ou cole\xE7\xE3o" }), selectField("Cole\xE7\xE3o", "set", [["", "Todas as cole\xE7\xF5es"], ...asArray(setsData.items || setsData.sets).map((set) => [set.id, set.name])], search.get("set") || ""), selectField("Idioma", "language", [["", "Todos os idiomas"], ...Object.entries(languages)], search.get("language") || ""), selectField("Condi\xE7\xE3o", "condition", [["", "Todas as condi\xE7\xF5es"], ...Object.entries(conditions)], search.get("condition") || ""), checkbox("Somente dispon\xEDveis", "available", search.get("available") === "true"), button("Aplicar filtros", () => filters.requestSubmit(), "shop-button secondary"), link("Limpar filtros", path, "shop-text-link"));
  const sort = selectField("Ordenar por", "sort", [["newest", "Mais recentes"], ["price_asc", "Menor pre\xE7o"], ["price_desc", "Maior pre\xE7o"], ["name", "Nome: A a Z"]], search.get("sort") || "newest");
  sort.querySelector("select").addEventListener("change", (event) => {
    const params = new URLSearchParams(location.search);
    params.set("sort", event.target.value);
    params.delete("page");
    navigate(`${path}?${params}`);
  });
  const pagination = data.pagination || {};
  const total = pagination.total ?? data.total ?? data.items.length;
  const pages = pagination.pages ?? pagination.totalPages ?? Math.ceil(total / 12);
  const current = Number(search.get("page")) || 1;
  return el("div", { class: "shop-shell" }, heading("CAT\xC1LOGO POK\xC9MON TCG", title, "Escolha o idioma, a condi\xE7\xE3o e os detalhes que fazem sentido para sua cole\xE7\xE3o."), el("div", { class: "shop-catalog-layout" }, el("aside", { "aria-label": "Filtros do cat\xE1logo" }, filters), el("div", {}, el("div", { class: "shop-results-bar" }, el("p", {}, `${total} ${total === 1 ? "produto encontrado" : "produtos encontrados"}`), sort), data.items.length ? productGrid(data.items) : empty("Nenhum produto por aqui ainda.", location.search ? "Tente remover os filtros ou buscar por outro termo." : "Assim que os produtos forem cadastrados e publicados, eles aparecer\xE3o aqui.", link("Ver cat\xE1logo completo", "/busca", "shop-button secondary")), pages > 1 ? el("nav", { class: "shop-pagination", "aria-label": "Pagina\xE7\xE3o" }, button("\u2190 Anterior", () => goPage(path, current - 1), "shop-button secondary", { disabled: current <= 1 }), el("span", {}, `P\xE1gina ${current} de ${pages}`), button("Pr\xF3xima \u2192", () => goPage(path, current + 1), "shop-button secondary", { disabled: current >= pages })) : null)));
}
function applyFilters(form, path) {
  const params = new URLSearchParams();
  for (const [key, value] of new FormData(form)) {
    if (value) params.set(key, key === "available" ? "true" : value);
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
  const media = el("div", { class: "shop-product-main-image" }, image(productImage(product).url, product.name));
  const mainPrice = el("p", { class: "shop-detail-price" });
  const stock = el("p", { class: "shop-stock" });
  const qtyInput = el("input", { type: "number", name: "quantity", min: "1", value: "1", "aria-label": "Quantidade", onChange: (event) => {
    quantity = Math.max(1, Math.min(chosen?.stock || 1, Number(event.target.value) || 1));
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
  return el("div", { class: "shop-shell" }, el("nav", { class: "shop-breadcrumb", "aria-label": "Localiza\xE7\xE3o" }, link("In\xEDcio", "/"), el("span", {}, "/"), link(product.kind === "SINGLE" ? "Cartas avulsas" : "Lacrados", product.kind === "SINGLE" ? "/cartas" : "/lacrados"), el("span", {}, "/"), el("span", {}, product.name)), el("div", { class: "shop-detail-layout" }, el("div", { class: "shop-gallery" }, media, asArray(product.images).length > 1 ? el("div", { class: "shop-thumbnails" }, product.images.map((img, i) => button(image(img.url, `${product.name}, imagem ${i + 1}`), () => {
    media.replaceChildren(image(img.url, product.name));
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
let overlayReturnFocus=null;
function closeOverlay() {
  overlay?.replaceChildren();
  document.body.classList.remove("shop-overlay-open");
  document.querySelector("main")?.removeAttribute("inert");document.querySelector(".header")?.removeAttribute("inert");
  state.drawer = false;
  document.removeEventListener("keydown", overlayKeys);
  if(overlayReturnFocus){const target=overlayReturnFocus.isConnected?overlayReturnFocus:document.querySelector('[aria-label^="Abrir carrinho"]');target?.focus({preventScroll:true});}
  overlayReturnFocus=null;
}
function overlayKeys(event) {
  if (event.key === "Escape") closeOverlay();
  if (event.key === "Tab" && overlay?.firstChild) {
    const nodes = [...overlay.querySelectorAll('a,button,input,select,[tabindex="0"]')].filter((node) => !node.disabled);
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
  document.querySelector("main")?.setAttribute("inert","");document.querySelector(".header")?.setAttribute("inert","");
  const content = el("div", { class: "shop-drawer-body" }, loading("Conferindo seu carrinho\u2026"));
  const close = button("\xD7", () => closeOverlay(), "shop-close", { "aria-label": "Fechar carrinho" });
  overlay.replaceChildren(el("div", { class: "shop-overlay-backdrop", onClick: (event) => {
    if (event.target === event.currentTarget) closeOverlay();
  } }, el("section", { class: "shop-drawer", role: "dialog", "aria-modal": "true", "aria-labelledby": "shop-cart-title" }, el("div", { class: "shop-drawer-heading" }, el("h2", { id: "shop-cart-title" }, "Seu carrinho."), close), content)));
  document.addEventListener("keydown", overlayKeys);
  close.focus();
  await reconcileCart();
  if (!state.drawer) return;
  content.replaceChildren(await cartContent(true));
}
async function reconcileCart() {
  if (!state.cart.length || !state.apiReady) return;
  const products = await Promise.all(state.cart.map((item) => api(`/products/${encodeURIComponent(item.slug)}`).catch(() => null)));
  let changed = false;
  state.cart = state.cart.filter((item, i) => {
    const product = products[i]?.product || products[i];
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
  return el("div", { class: "shop-cart-items" }, state.cart.map((item) => el("article", { class: "shop-cart-item" }, link(image(item.image, item.name), `/produto/${encodeURIComponent(item.slug)}`, "shop-cart-image"), el("div", { class: "shop-cart-item-info" }, link(el("h3", {}, item.name), `/produto/${encodeURIComponent(item.slug)}`), el("p", {}, `${languages[item.language] || item.language} \xB7 ${conditions[item.condition] || item.condition}`), el("strong", {}, money(item.priceCents)), el("div", { class: "shop-cart-quantity" }, button("\u2212", () => updateQuantity(item.variantId, item.quantity - 1, onUpdate), "shop-quantity-button", { "aria-label": `Diminuir quantidade de ${item.name}` }), el("span", {}, item.quantity), button("+", () => updateQuantity(item.variantId, item.quantity + 1, onUpdate), "shop-quantity-button", { "aria-label": `Aumentar quantidade de ${item.name}`, disabled: item.quantity >= item.stock }), button("Remover", () => updateQuantity(item.variantId, 0, onUpdate), "shop-remove"))))));
}
async function updateQuantity(id, quantity, callback) {
  const item = state.cart.find((v) => v.variantId === id);
  if (!item) return;
  if (quantity <= 0) state.cart = state.cart.filter((v) => v.variantId !== id);
  else item.quantity = Math.min(item.stock, quantity);
  persist();
  renderNav();
  await callback();
}
async function cartContent(drawer = false) {
  if (!state.cart.length) return empty("Seu carrinho espera uma descoberta.", "Explore o cat\xE1logo e escolha o pr\xF3ximo destaque da sua cole\xE7\xE3o.", link("Explorar produtos", "/busca", "shop-button"));
  const content = el("div", { class: drawer ? "" : "shop-cart-layout" });
  const rerender = async () => {
    if (drawer) {
      content.replaceWith(await cartContent(true));
    } else renderRoute();
  };
  const subtotal = state.cart.reduce((n, item) => n + item.priceCents * item.quantity, 0);
  const threshold = state.config.shipping?.freeShippingEnabled ? state.config.shipping?.freeShippingThresholdCents || state.config.freeShippingThresholdCents : 0;
  const progress = threshold ? el("div", { class: "shop-free-shipping" }, el("p", {}, subtotal >= threshold ? "Voc\xEA atingiu o valor para frete gr\xE1tis. Consulte seu CEP." : `Faltam ${money(threshold - subtotal)} para o frete gr\xE1tis.`), el("progress", { max: threshold, value: Math.min(subtotal, threshold), "aria-label": "Progresso para frete gr\xE1tis" })) : null;
  const summary = el("aside", { class: "shop-summary" }, el("h2", {}, "Resumo do pedido"), el("div", { class: "shop-summary-row" }, el("span", {}, "Subtotal dos produtos"), el("strong", {}, money(subtotal))), progress, shippingForm(), el("p", { class: "shop-fine" }, "Pre\xE7o, estoque, cupom e frete ser\xE3o conferidos pelo servidor antes da finaliza\xE7\xE3o."), link("Continuar para checkout \u2197", "/checkout", "shop-button"), drawer ? link("Ver carrinho completo", "/carrinho", "shop-text-link") : link("Continuar comprando", "/busca", "shop-text-link"));
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
      result.replaceChildren(message(quote.shipping?.available ? `${money(quote.shippingCents)}${quote.shipping?.estimatedDays ? ` \xB7 estimativa de ${quote.shipping.estimatedDays} dias \xFAteis` : ""}` : quote.reason || quote.shipping?.reason || "Entrega indispon\xEDvel para este CEP."));
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
  return el("div", { class: "shop-shell" }, heading("GUARDE SUAS DESCOBERTAS", "Seus favoritos.", "Os produtos salvos ficam neste navegador. A disponibilidade \xE9 conferida ao abrir a p\xE1gina."), results.filter(Boolean).length ? productGrid(results.filter(Boolean)) : empty("Um espa\xE7o para suas pr\xF3ximas escolhas.", "Toque no cora\xE7\xE3o de um produto para salv\xE1-lo aqui.", link("Explorar o cat\xE1logo", "/busca", "shop-button")), results.some((result) => !result) ? message("Alguns produtos salvos n\xE3o est\xE3o mais publicados.") : null);
}
async function checkoutPage() {
  await reconcileCart();
  if (!state.cart.length) return el("div", { class: "shop-shell" }, heading("FINALIZAR PEDIDO", "Checkout."), empty("Seu carrinho est\xE1 vazio.", "Escolha um produto para continuar.", link("Explorar o cat\xE1logo", "/busca", "shop-button")));
  const status = el("div", { "aria-live": "polite" });
  const summary = el("aside", { class: "shop-summary" }, loading("Calculando o pedido\u2026"));
  let currentQuote = null;
  const submit = button("Pagamento indispon\xEDvel", () => checkoutForm.requestSubmit(), "shop-button", { disabled: true, type: "submit" });
  const checkoutForm = el("form", { class: "shop-checkout-form", onSubmit: async (event) => {
    event.preventDefault();
    if (!currentQuote?.paymentAvailable) {
      status.replaceChildren(message(currentQuote?.reason || "O pagamento ainda n\xE3o foi configurado.", "error"));
      return;
    }
    submit.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(checkoutForm));
      const result = await api("/checkout", { method: "POST", body: { items: state.cart.map((i) => ({ variantId: i.variantId, quantity: i.quantity })), coupon: values.coupon || null, cep: values.cep.replace(/\D/g, ""), address: { name: values.name, phone: values.phone, street: values.street, number: values.number, complement: values.complement, district: values.district, city: values.city, state: values.state }, email: values.email } });
      if (result.paymentUrl) {
        const url = new URL(result.paymentUrl);
        if (url.protocol !== "https:") throw new Error("O servidor retornou um endere\xE7o de pagamento inv\xE1lido.");
        location.assign(url.href);
      } else status.replaceChildren(message("O servidor ainda n\xE3o disponibilizou um endere\xE7o de pagamento. Nenhuma cobran\xE7a foi feita.", "error"));
    } catch (error) {
      status.replaceChildren(message(displayError(error), "error"));
    } finally {
      submit.disabled = !currentQuote?.paymentAvailable;
    }
  } }, el("h2", {}, "Contato e entrega"), !state.user ? el("p", { class: "shop-muted" }, "J\xE1 tem uma conta? ", link("Entre para acompanhar seus pedidos", "/entrar?next=%2Fcheckout", "shop-text-link")) : null, el("div", { class: "shop-form-grid" }, field("Nome completo", "name", "text", state.user?.name || "", { required: true, autocomplete: "name" }), field("E-mail", "email", "email", state.user?.email || "", { required: true, autocomplete: "email" }), field("Celular", "phone", "tel", "", { required: true, autocomplete: "tel" }), field("CEP", "cep", "text", localStorage.getItem("bkm-cep") || "", { required: true, inputmode: "numeric", pattern: "[0-9]{5}-?[0-9]{3}", autocomplete: "postal-code" }), field("Rua / avenida", "street", "text", "", { required: true, autocomplete: "address-line1" }), field("N\xFAmero", "number", "text", "", { required: true }), field("Complemento", "complement", "text", "", { autocomplete: "address-line2" }), field("Bairro", "district", "text", "", { required: true }), field("Cidade", "city", "text", "", { required: true, autocomplete: "address-level2" }), selectField("Estado", "state", [["", "Selecione"], ..."AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ").map((uf) => [uf, uf])], "", { required: true })), el("div", { class: "shop-coupon-form" }, field("Cupom de desconto", "coupon", "text", "", { placeholder: "Se voc\xEA tiver um cupom" }), button("Atualizar valores", () => quote(), "shop-button secondary")), status, submit, el("p", { class: "shop-fine" }, "A BKM s\xF3 libera o pagamento ap\xF3s configura\xE7\xE3o do provedor. A anima\xE7\xE3o e o cadastro n\xE3o geram cobran\xE7as."));
  async function quote() {
    const data = new FormData(checkoutForm);
    const cep = String(data.get("cep") || "").replace(/\D/g, "");
    setChildren(summary,loading("Conferindo valores\u2026"));
    try {
      currentQuote = await api("/checkout/quote", { method: "POST", body: { items: state.cart.map((item) => ({ variantId: item.variantId, quantity: item.quantity })), coupon: String(data.get("coupon") || "").trim() || null, cep } });
      setChildren(summary,el("h2", {}, "Seu pedido"), state.cart.map((item) => el("div", { class: "shop-summary-row" }, el("span", {}, `${item.quantity} \xD7 ${item.name}`), el("span", {}, money(item.priceCents * item.quantity)))), el("hr"), summaryRow("Subtotal", currentQuote.subtotalCents), currentQuote.discountCents ? summaryRow("Desconto", -currentQuote.discountCents) : null, summaryRow("Frete", currentQuote.shipping?.available ? currentQuote.shippingCents : null), el("div", { class: "shop-summary-total" }, el("span", {}, "Total"), el("strong", {}, money(currentQuote.totalCents))), !currentQuote.paymentAvailable ? message(currentQuote.reason || state.config.payments?.reason || "Pagamento ainda n\xE3o configurado.") : null, ...asArray(currentQuote.errors).map((error) => message(typeof error === "string" ? error : error.message, "error")));
      submit.disabled = !currentQuote.paymentAvailable;
      submit.textContent = currentQuote.paymentAvailable ? "Continuar para pagamento \u2197" : "Pagamento indispon\xEDvel";
    } catch (error) {
      currentQuote = null;
      setChildren(summary,message(displayError(error), "error"));
      submit.disabled = true;
      submit.textContent = "Pagamento indispon\xEDvel";
    }
  }
  checkoutForm.querySelector("[name=cep]").addEventListener("change", () => quote());
  await quote();
  return el("div", { class: "shop-shell" }, heading("UMA NOVA HIST\xD3RIA PARA SUA COLE\xC7\xC3O", "Checkout."), el("div", { class: "shop-checkout-layout" }, checkoutForm, summary));
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
  } }, register ? field("Seu nome", "name", "text", "", { required: true, autocomplete: "name", minlength: "2" }) : null, field("E-mail", "email", "email", "", { required: true, autocomplete: "email" }), field("Senha", "password", "password", "", { required: true, autocomplete: register ? "new-password" : "current-password", minlength: register ? "12" : void 0 }), register ? el("p", { class: "shop-fine" }, "Use pelo menos 12 caracteres. Ao criar uma conta, voc\xEA concorda com os ", link("termos de uso", "/termos", "shop-text-link"), " e a ", link("pol\xEDtica de privacidade", "/privacidade", "shop-text-link"), ".") : null, status, el("button", { type: "submit", class: "shop-button" }, register ? "Criar minha conta" : "Entrar"), el("p", { class: "shop-muted" }, register ? "J\xE1 tem uma conta? " : "Sua primeira visita? ", link(register ? "Entrar" : "Crie uma conta", register ? "/entrar" : "/cadastro", "shop-text-link")));
  return el("div", { class: "shop-shell shop-auth" }, heading("BEM-VINDO \xC0 BKM", register ? "Sua cole\xE7\xE3o.\nSua conta." : "Bom ter voc\xEA\npor aqui."), form);
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
function ordersList(orders) {
  return el("div", { class: "shop-table-wrap" }, el("table", { class: "shop-table" }, el("thead", {}, el("tr", {}, ["Pedido", "Data", "Status", "Total"].map((t) => el("th", {}, t)))), el("tbody", {}, orders.map((order) => el("tr", {}, el("td", {}, order.number || order.id), el("td", {}, order.createdAt ? new Date(order.createdAt).toLocaleDateString("pt-BR") : "\u2014"), el("td", {}, order.status || "Aguardando"), el("td", {}, money(order.totalCents)))))));
}
async function adminPage(path) {
  if (!state.user) {
    navigate(`/entrar?next=${encodeURIComponent(path)}`, { replace: true });
    return loading();
  }
  if (state.user.role !== "ADMIN") return el("div", { class: "shop-shell" }, heading("ACESSO RESTRITO", "Esta \xE1rea \xE9 da administra\xE7\xE3o."), message("Sua conta n\xE3o possui permiss\xE3o para gerenciar a loja."), link("Voltar \xE0 minha conta", "/conta", "shop-button"));
  const tabs = [["Painel", "/admin"], ["Produtos", "/admin/produtos"], ["Pedidos", "/admin/pedidos"], ["Cupons", "/admin/cupons"], ["Configura\xE7\xF5es", "/admin/configuracoes"]];
  let content;
  if (path === "/admin") content = await adminDashboard();
  else if (path === "/admin/produtos") content = await adminProducts();
  else if (path === "/admin/produtos/novo") content = await productEditor();
  else if (/^\/admin\/produtos\/[^/]+$/.test(path)) content = await productEditor(decodeURIComponent(path.split("/").at(-1)));
  else if (path === "/admin/configuracoes") content = await adminSettings();
  else if (path === "/admin/cupons") content = await adminCoupons();
  else if (path === "/admin/pedidos") content = await adminOrders();
  else content = empty("P\xE1gina n\xE3o encontrada.", "Escolha uma \xE1rea da administra\xE7\xE3o.", link("Ir para o painel", "/admin", "shop-button"));
  return el("div", { class: "shop-shell shop-admin" }, el("div", { class: "shop-admin-title" }, heading("BKM TCG / OPERA\xC7\xC3O", "Administra\xE7\xE3o."), link("Ver a loja \u2197", "/busca", "shop-text-link")), el("nav", { class: "shop-admin-nav", "aria-label": "Administra\xE7\xE3o" }, tabs.map(([label, href]) => link(label, href, path === href || href === "/admin/produtos" && path.startsWith("/admin/produtos/") ? "active" : ""))), content);
}
async function adminDashboard() {
  const [summary, coupons] = await Promise.all([api("/admin/summary"), api("/admin/coupons")]);
  return el("div", {}, el("div", { class: "shop-stat-grid" }, [["Produtos", summary.products], ["Publicados", summary.published], ["Unidades em estoque", summary.stockUnits], ["Pedidos", summary.orders]].map(([label, value]) => el("div", { class: "shop-stat" }, el("span", {}, label), el("strong", {}, value)))), el("div", { class: "shop-admin-welcome" }, el("div", {}, el("p", { class: "shop-kicker" }, "SEU CAT\xC1LOGO COME\xC7A AQUI"), el("h2", {}, summary.products ? "Tudo pronto para a pr\xF3xima descoberta." : "Vamos preparar a primeira cole\xE7\xE3o."), el("p", { class: "shop-muted" }, "Cadastre cartas e lacrados, defina suas vers\xF5es e publique quando pre\xE7o e estoque estiverem prontos.")), link("Cadastrar produto \u2197", "/admin/produtos/novo", "shop-button")), !state.config.paymentConfigured ? message("O pagamento est\xE1 indispon\xEDvel at\xE9 o provedor ser configurado e validado. O cat\xE1logo e o controle de estoque j\xE1 podem ser preparados.") : null, el("div", { class: "shop-admin-shortcuts" }, link("Configurar contato e entrega \u2197", "/admin/configuracoes", "shop-panel-link"), link(`Gerenciar ${asArray(coupons.items || coupons.coupons).length} cupons \u2197`, "/admin/cupons", "shop-panel-link")));
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
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("N\xE3o foi poss\xEDvel ler a imagem."));
        reader.readAsDataURL(file);
      });
      const result = await api("/admin/uploads", { method: "POST", body: { name: file.name, dataUrl } });
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
    const payload = { kind: values.kind, name: values.name.trim(), slug: values.slug.trim() || void 0, description: values.description.trim(), sku: values.sku.trim(), setId: values.setId.trim(), setName: values.setName.trim(), tcg: values.tcg, images: imageValues, card: values.kind === "SINGLE" ? cardMetadata : null, variants: variantValues, published: values.published === "on", featured: values.featured === "on" };
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
  } }, el("div", { class: "shop-section-top" }, el("h2", {}, id ? "Editar produto" : "Novo produto"), link("\u2190 Produtos", "/admin/produtos", "shop-text-link")), el("section", { class: "shop-admin-section" }, el("h3", {}, "Informa\xE7\xF5es do produto"), el("div", { class: "shop-form-grid" }, kind, selectField("TCG", "tcg", [["pokemon", "Pok\xE9mon TCG"]], product.tcg || "pokemon"), name, field("SKU interno", "sku", "text", product.sku || "", { required: true }), field("Endere\xE7o do produto", "slug", "text", product.slug || "", { placeholder: "Gerado a partir do nome" }))), cardSearch, manualSection, el("section", { class: "shop-admin-section" }, el("h3", {}, "Cole\xE7\xE3o e descri\xE7\xE3o"), el("div", { class: "shop-form-grid" }, setId, setName), description), el("section", { class: "shop-admin-section" }, el("div", { class: "shop-section-top" }, el("h3", {}, "Imagens"), el("span", { class: "shop-fine" }, "Refer\xEAncia e foto real identificadas")), imageList, el("div", { class: "shop-inline-form" }, imageUrl, imageKind, button("Adicionar URL", addImage, "shop-button secondary")), el("label", { class: "shop-field" }, el("span", {}, "Enviar foto real (PNG, JPEG ou WebP, at\xE9 8 MB)"), upload)), el("section", { class: "shop-admin-section" }, el("div", { class: "shop-section-top" }, el("h3", {}, "Vers\xF5es, pre\xE7o e estoque"), button("Adicionar vers\xE3o +", () => {
    captureVariants();
    variantValues.push({ language: "pt", condition: kind.querySelector("select").value === "SINGLE" ? "NM" : "SEALED", finish: "NORMAL", priceCents: 0, stock: 0 });
    renderVariants();
  }, "shop-button secondary")), el("p", { class: "shop-fine" }, "Cada combina\xE7\xE3o de idioma, condi\xE7\xE3o e acabamento tem estoque e pre\xE7o pr\xF3prios. Valores em reais."), variantList), el("section", { class: "shop-admin-section" }, el("h3", {}, "Publica\xE7\xE3o"), checkbox("Publicar na loja", "published", product.published), checkbox("Exibir nos destaques da p\xE1gina inicial", "featured", product.featured)), status, el("div", { class: "shop-actions" }, el("button", { type: "submit", class: "shop-button" }, "Salvar produto"), link("Voltar \xE0 lista", "/admin/produtos", "shop-button secondary")));
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
  const response = await api("/admin/settings");
  const settings = response.settings || response;
  const shipping = settings.shipping || {};
  const status = el("div", { "aria-live": "polite" });
  const form = el("form", { class: "shop-settings-form", onSubmit: async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const submit = form.querySelector("[type=submit]");
    submit.disabled = true;
    try {
      const payload = { ...settings, storeName: values.storeName.trim(), contactEmail: values.contactEmail.trim(), whatsapp: values.whatsapp.trim(), companyName: values.companyName.trim(), cnpj: values.cnpj.trim(), address: values.address.trim(), about: values.about.trim(), privacyPolicy: values.privacyPolicy.trim(), shippingPolicy: values.shippingPolicy.trim(), returnsPolicy: values.returnsPolicy.trim(), terms: values.terms.trim(), shipping: { ...shipping, enabled: values.shippingEnabled === "on", flatRateCents: Math.round(Number(values.flatRate) * 100), estimatedDays: Number(values.estimatedDays), freeShippingEnabled: values.freeShippingEnabled === "on", freeShippingThresholdCents: Number(values.freeShippingThreshold) > 0 ? Math.round(Number(values.freeShippingThreshold) * 100) : null, regions: String(values.regions || "").split(",").map(v => v.trim()).filter(Boolean).map(v => { const [start,end] = v.split(":").map(c => c.replace(/\D/g,"")); if(start?.length!==8 || end?.length!==8 || start>end) throw new Error("Informe faixas de CEP como 01000000:09999999."); return {start,end}; }) } };
      await api("/admin/settings", { method: "PUT", body: payload });
      const config = await api("/config");
      state.config = config.config || config;
      status.replaceChildren(message("Configura\xE7\xF5es salvas.", "success"));
      toast("Configura\xE7\xF5es atualizadas.");
    } catch (error) {
      status.replaceChildren(message(displayError(error), "error"));
    } finally {
      submit.disabled = false;
    }
  } }, el("h2", {}, "Configura\xE7\xF5es da loja"), el("section", { class: "shop-admin-section" }, el("h3", {}, "Informa\xE7\xF5es de contato"), el("div", { class: "shop-form-grid" }, field("Nome da loja", "storeName", "text", settings.storeName || "BKM TCG", { required: true }), field("E-mail de atendimento", "contactEmail", "email", settings.contactEmail || ""), field("WhatsApp com DDD", "whatsapp", "tel", settings.whatsapp || ""), field("Raz\xE3o social", "companyName", "text", settings.companyName || ""), field("CNPJ", "cnpj", "text", settings.cnpj || ""), field("Endere\xE7o comercial", "address", "text", settings.address || ""))), el("section", { class: "shop-admin-section" }, el("h3", {}, "Entrega"), el("p", { class: "shop-fine" }, "Esta opera\xE7\xE3o utiliza uma taxa fixa definida pela loja. Ative apenas quando seus valores e cobertura estiverem conferidos."), checkbox("Ativar c\xE1lculo de entrega", "shippingEnabled", shipping.enabled), el("div", { class: "shop-form-grid" }, field("Taxa de entrega (R$)", "flatRate", "number", ((shipping.flatRateCents || 0) / 100).toFixed(2), { min: "0", step: ".01", required: true }), field("Estimativa em dias \xFAteis", "estimatedDays", "number", shipping.estimatedDays || 7, { min: "1", max: "90", required: true }), field("Faixas de CEP atendidas", "regions", "text", asArray(shipping.regions).map(r => `${r.start}:${r.end}`).join(", "), { placeholder: "01000000:09999999, 20000000:28999999" })), checkbox("Oferecer frete gr\xE1tis a partir de um valor", "freeShippingEnabled", shipping.freeShippingEnabled), field("Valor m\xEDnimo para frete gr\xE1tis (R$)", "freeShippingThreshold", "number", ((shipping.freeShippingThresholdCents || 0) / 100).toFixed(2), { min: "0", step: ".01" })), el("section", { class: "shop-admin-section" }, el("h3", {}, "Pagamentos"), message("O provedor de pagamento ainda n\xE3o est\xE1 configurado. O bot\xE3o de pagamento permanece indispon\xEDvel no checkout."), el("p", { class: "shop-fine" }, "Credenciais de pagamento devem ficar no ambiente do servidor. Nenhum segredo \xE9 solicitado ou exibido neste painel.")), el("section",{class:"shop-admin-section"},el("h3",{},"Sobre e políticas da loja"),el("p",{class:"shop-fine"},"Preencha informações revisadas para a operação real. Campos vazios mantêm a indicação de preparação."),field("Sobre a BKM","about","textarea",settings.about||"",{rows:"4"}),field("Política de privacidade","privacyPolicy","textarea",settings.privacyPolicy||"",{rows:"5"}),field("Política de envio","shippingPolicy","textarea",settings.shippingPolicy||"",{rows:"5"}),field("Trocas e devoluções","returnsPolicy","textarea",settings.returnsPolicy||"",{rows:"5"}),field("Termos de uso","terms","textarea",settings.terms||"",{rows:"5"})), status, el("button", { type: "submit", class: "shop-button" }, "Salvar configura\xE7\xF5es"));
  return form;
}
async function adminCoupons() {
  const response = await api("/admin/coupons");
  const items = asArray(response.items || response.coupons);
  const status = el("div", { "aria-live": "polite" });
  const form = el("form", { class: "shop-coupon-editor", onSubmit: async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form));
    const submit = form.querySelector("[type=submit]");
    submit.disabled = true;
    try {
      const amount = Number(values.value);
      await api("/admin/coupons", { method: "POST", body: { code: values.code.trim().toUpperCase(), type: values.type, value: values.type === "PERCENT" ? amount : Math.round(amount * 100), valueCents: values.type === "FIXED" ? Math.round(amount * 100) : void 0, percent: values.type === "PERCENT" ? amount : void 0, minimumCents: Math.round(Number(values.minimum || 0) * 100), maxUses: values.maxUses ? Number(values.maxUses) : null, endsAt: values.expiresAt ? (/* @__PURE__ */ new Date(`${values.expiresAt}T23:59:59-03:00`)).toISOString() : null, active: values.active === "on" } });
      toast("Cupom criado.");
      renderRoute();
    } catch (error) {
      status.replaceChildren(message(displayError(error), "error"));
      submit.disabled = false;
    }
  } }, el("h3", {}, "Criar cupom"), el("div", { class: "shop-form-grid" }, field("C\xF3digo", "code", "text", "", { required: true, pattern: "[A-Za-z0-9_-]{3,40}", placeholder: "Ex.: BKM10" }), selectField("Tipo", "type", [["PERCENT", "Percentual (%)"], ["FIXED", "Valor fixo (R$)"]], "PERCENT"), field("Desconto", "value", "number", "", { required: true, min: ".01", step: ".01" }), field("Compra m\xEDnima (R$)", "minimum", "number", "0", { min: "0", step: ".01" }), field("Limite de usos", "maxUses", "number", "", { min: "1", step: "1", placeholder: "Sem limite" }), field("V\xE1lido at\xE9", "expiresAt", "date", "")), checkbox("Ativar cupom", "active", true), status, el("button", { type: "submit", class: "shop-button" }, "Criar cupom"));
  return el("section", {}, el("h2", {}, "Cupons"), items.length ? el("div", { class: "shop-table-wrap" }, el("table", { class: "shop-table" }, el("thead", {}, el("tr", {}, ["C\xF3digo", "Desconto", "Usos", "Status", "Validade"].map((text) => el("th", {}, text)))), el("tbody", {}, items.map((coupon) => el("tr", {}, el("td", {}, coupon.code), el("td", {}, coupon.type === "PERCENT" ? `${coupon.value ?? coupon.percent}%` : money(coupon.valueCents ?? coupon.value)), el("td", {}, `${coupon.usedCount || 0}${coupon.maxUses ? ` / ${coupon.maxUses}` : ""}`), el("td", {}, coupon.active ? "Ativo" : "Inativo"), el("td", {}, coupon.endsAt ? new Date(coupon.endsAt).toLocaleDateString("pt-BR") : "Sem prazo")))))) : message("Nenhum cupom cadastrado."), form);
}
async function adminOrders() {
  const data = await api("/admin/orders");
  const items = asArray(data.items || data.orders);
  return el("section", {}, el("h2", {}, "Pedidos"), items.length ? ordersList(items) : empty("Nenhum pedido recebido.", "Os pedidos aparecer\xE3o aqui quando o pagamento e a opera\xE7\xE3o comercial estiverem configurados.", link("Conferir configura\xE7\xF5es", "/admin/configuracoes", "shop-button secondary")));
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
  await initialize();
  await renderRoute();
}
