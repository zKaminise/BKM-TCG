async function accountList(db, user, pathname, method, data, serializeProduct) {
  const kind = pathname.endsWith("/cart") ? "cart" : "favorites";
  async function hydrate(items) {
    const keys = kind === "cart" ? items.map((item) => item.variantId) : items;
    if (!keys.length) return { items: [], products: [] };
    const marks = keys.map(() => "?").join(",");
    const rows = kind === "cart"
      ? await db.prepare(`SELECT DISTINCT p.* FROM products p JOIN variants v ON v.product_id=p.id WHERE v.id IN(${marks}) AND v.active=1 AND p.published=1 AND p.archived=0`).all(...keys)
      : await db.prepare(`SELECT p.* FROM products p WHERE p.id IN(${marks}) AND p.published=1 AND p.archived=0`).all(...keys);
    const products = await Promise.all(rows.map((row) => serializeProduct(row)));
    const validIds = new Set(kind === "cart" ? products.flatMap((p) => p.variants.map((v) => v.id)) : products.map((p) => p.id));
    return { items: items.filter((value) => validIds.has(kind === "cart" ? value.variantId : value)), products };
  }
  if (method === "GET") {
    const row = await db.prepare("SELECT items_json FROM account_lists WHERE user_id=? AND kind=?").get(user.id, kind);
    return hydrate(row ? JSON.parse(row.items_json) : []);
  }
  if (method !== "PUT") return null;
  const bad = (message) => {
    const error = new Error(message);
    error.status = 422;
    error.code = "VALIDATION";
    throw error;
  };
  if (!Array.isArray(data.items) || data.items.length > 100) bad("Envie até 100 itens.");
  let items;
  if (kind === "cart") {
    const counts = /* @__PURE__ */ new Map();
    for (const value of data.items) {
      if (!value || typeof value !== "object" || Array.isArray(value)) bad("Item de carrinho inválido.");
      if (typeof value.variantId !== "string" || !Number.isSafeInteger(value.quantity) || value.quantity < 1 || value.quantity > 1e3) bad("Quantidade ou variante inválida.");
      counts.set(value.variantId, (counts.get(value.variantId) || 0) + value.quantity);
    }
    items = await Promise.all([...counts].map(async ([variantId, quantity]) => {
      const row = await db.prepare("SELECT v.stock,(SELECT COALESCE(SUM(r.quantity),0) FROM inventory_reservations r WHERE r.variant_id=v.id AND r.status='ACTIVE' AND r.expires_at>?) reserved FROM variants v JOIN products p ON p.id=v.product_id WHERE v.id=? AND v.active=1 AND p.published=1 AND p.archived=0").get(Date.now(),variantId);
      if (!row) bad("Um produto do carrinho não está mais disponível.");
      if (quantity > Math.max(0,row.stock-Number(row.reserved))) bad("Quantidade maior que o estoque disponível.");
      return { variantId, quantity };
    }));
  } else {
    items = [...new Set(data.items.map((value) => typeof value === "string" ? value : value?.productId))];
    for (const id of items) if (typeof id !== "string" || !(await db.prepare("SELECT id FROM products WHERE id=? AND published=1 AND archived=0").get(id))) bad("Produto favorito não encontrado.");
  }
  await db.prepare("INSERT INTO account_lists VALUES(?,?,?,?) ON CONFLICT(user_id,kind) DO UPDATE SET items_json=excluded.items_json,updated_at=excluded.updated_at").run(user.id, kind, JSON.stringify(items), (/* @__PURE__ */ new Date()).toISOString());
  return hydrate(items);
}
module.exports = { accountList };
