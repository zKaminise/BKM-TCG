const fs = require("node:fs"), path = require("node:path"), { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
let failed = false;
for (const dir of ["", "server", "scripts", "tests"]) for (const name of fs.readdirSync(path.join(root, dir))) if (/\.(?:js|cjs)$/.test(name)) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, dir, name)], { stdio: "inherit" });
  if (result.status !== 0) failed = true;
}
process.exitCode = failed ? 1 : 0;
