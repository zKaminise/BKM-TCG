const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const envFile = path.join(__dirname, '.env');
if (require.main === module) require('./server/env.cjs').loadProjectEnvFile(envFile);
const { createApi } = require("./server/api.cjs");
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8" };
function createServer(options = {}) {
  const root = options.root || __dirname;
  const api = createApi({ ...options, root });
  const publicFiles = /* @__PURE__ */ new Set(["index.html", "styles.css", "app.js", "store.js", "personal-ui.js", "collection-ui.js", "collection-domain.js", "collection.css", "password-ui.js", "password-ui.css", "shipping-admin-ui.js", "shipping-admin.css", "admin-product-ui.js", "admin-product.css", "product-labels.js", "store.css", "ABRIR.html", "favicon.ico", "robots.txt", "sitemap.xml"]);
  const server = http.createServer(async (req, res) => {
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$/.test(req.headers.host || "")) {
      res.writeHead(400);
      return res.end("Host inválido.");
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      res.writeHead(400);
      return res.end("Requisição inválida.");
    }
    if (pathname.startsWith("/api/") || pathname === "/api") return api.handle(req, res, pathname);
    if (pathname === '/ABRIR.html') {
      res.writeHead(302, { Location: '/', 'Cache-Control': 'no-store' });
      return res.end();
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      res.writeHead(405, { "Allow": "GET, HEAD" });
      return res.end();
    }
    const relative = pathname.replace(/^\/+/, "");
    const segments = relative.split("/");
    if (segments.some((s) => s === ".." || s.startsWith(".") || s.includes("\\") || s.includes("\0"))) {
      res.writeHead(404);
      return res.end("Página não encontrada.");
    }
    if (["data", "server", "scripts", "tests", "node_modules"].includes(segments[0])) {
      res.writeHead(404);
      return res.end("Arquivo não encontrado.");
    }
    const asset = ["assets", "vendor", "uploads"].includes(segments[0]);
    let file;
    if (publicFiles.has(relative) || asset) file = path.resolve(root, relative);
    else if (!path.extname(relative)) file = path.join(root, "index.html");
    else {
      res.writeHead(404);
      return res.end("Arquivo não encontrado.");
    }
    if (!file.startsWith(path.resolve(root) + path.sep)) {
      res.writeHead(404);
      return res.end();
    }
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile()) throw new Error("not a file");
      const type = mime[path.extname(file).toLowerCase()];
      if (!type || segments[0] === "uploads" && ![".png", ".jpg", ".jpeg", ".webp"].includes(path.extname(file).toLowerCase())) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { "Content-Type": type, "Content-Length": stat.size, "Cache-Control": asset ? "public, max-age=3600" : "no-cache" });
      if (req.method === "HEAD") return res.end();
      fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
    } catch {
      res.writeHead(404);
      res.end("Arquivo não encontrado.");
    }
  });
  server.on("close", () => api.close());
  server.api = api;
  return server;
}
if (require.main === module) {
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT inválida.");
  const server = createServer({publicUrl:`http://localhost:${port}`,allowedOrigins:[`http://127.0.0.1:${port}`]});
  server.on("error", (e) => {
    console.error(e.code === "EADDRINUSE" ? `A porta ${port} já está em uso. Encerre a prévia anterior ou configure PORT.` : e.message);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => console.log(`BKM TCG: http://127.0.0.1:${port}
Acesso restrito a este computador. Ctrl+C para encerrar.`));
  process.on("SIGINT", () => server.close(() => process.exit(0)));
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
}
module.exports = { createServer };
