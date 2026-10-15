const path = require("node:path");
const { openDatabase } = require("../server/db.cjs");
const filename = process.env.BKM_DB_PATH || path.resolve(__dirname, "../data/bkm.sqlite");
const db = openDatabase(filename);
db.close();
console.log("Migrations concluídas. Nenhum produto ou usuário de exemplo foi criado.");
