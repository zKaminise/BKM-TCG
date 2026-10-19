const path = require("node:path");
const crypto = require("node:crypto");
const readline = require("node:readline");
const fs = require('node:fs');
require('../server/env.cjs').loadProjectEnvFile(path.resolve(__dirname,'../.env'));
const { openStore } = require("../server/store.cjs");
const { hashPassword } = require("../server/auth.cjs");
async function readVisible(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise((resolve) => rl.question(prompt, resolve));
  } finally {
    rl.close();
  }
}
async function readSecret(prompt) {
  if (!process.stdin.isTTY) {
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 300) throw new Error("Senha acima do limite.");
    }
    return input.replace(/\r?\n$/, "");
  }
  process.stdout.write(prompt);
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const onKey = (str, key = {}) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Operação cancelada."));
      } else if (key.name === "return") {
        cleanup();
        resolve(value);
      } else if (key.name === "backspace") value = value.slice(0, -1);
      else if (str && !key.ctrl && !key.meta && value.length < 129) value += str;
    };
    const cleanup = () => {
      process.stdin.off("keypress", onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    process.stdin.on("keypress", onKey);
  });
}
(async () => {
  const args = process.argv.slice(2), get = (key) => args[args.indexOf(key) + 1];
  let email = (args.includes("--email") ? get("--email") : "").trim().toLowerCase(), name = (args.includes("--name") ? get("--name") : "").trim();
  if (process.stdin.isTTY) {
    if (!name) name = (await readVisible("Seu nome: ")).trim();
    if (!email) email = (await readVisible("E-mail administrativo: ")).trim().toLowerCase();
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !name || name.length > 120) throw new Error('Uso: npm run admin:create -- --email seu@email.com --name "Seu nome". A senha será solicitada sem exibição.');
  const demo = args.includes('--demo');
  if (demo && process.env.BKM_ENVIRONMENT !== 'demo') throw new Error('--demo exige BKM_ENVIRONMENT=demo em um banco dedicado de demonstração.');
  const minimum = demo ? 8 : 12;
  const password = await readSecret(`Senha do administrador (mínimo ${minimum} caracteres): `);
  if (password.length < minimum || password.length > 128) throw new Error(`A senha deve ter entre ${minimum} e 128 caracteres.`);
  if (process.stdin.isTTY) {
    const confirmation = await readSecret("Confirme a senha: ");
    if (confirmation !== password) throw new Error("As senhas não coincidem.");
  }
  const passwordHash = await hashPassword(password);
  const db = openStore({dbPath:process.env.BKM_DB_PATH || path.resolve(__dirname, "../data/bkm.sqlite")});
  await db.ready;
  try {
    await db.transaction(async()=>{
      if(db.engine==='postgres') await db.prepare('SELECT pg_advisory_xact_lock(164732092)').get();
      if ((await db.prepare("SELECT COUNT(*) count FROM users WHERE role='ADMIN'").get()).count > 0) throw new Error("Já existe um administrador. Este comando cria somente o primeiro administrador.");
      if (await db.prepare("SELECT id FROM users WHERE email=?").get(email)) throw new Error("O e-mail já está cadastrado. Nenhuma conta foi alterada.");
      const id = crypto.randomUUID(), stamp = (/* @__PURE__ */ new Date()).toISOString();
      await db.prepare("INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,'ADMIN',?)").run(id, email, name, passwordHash, stamp);
    });
    console.log("Primeiro administrador criado. Entre no site com seu e-mail e senha.");
  } finally {
    await db.close();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
