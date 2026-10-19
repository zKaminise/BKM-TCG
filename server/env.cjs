const fs = require('node:fs');

function loadProjectEnvFile(filename) {
  // Unit/integration tests must never inherit a developer's live database or keys.
  if (process.env.BKM_SKIP_DOTENV === 'true' || process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT) return false;
  if (!fs.existsSync(filename) || !process.loadEnvFile) return false;
  process.loadEnvFile(filename);
  return true;
}

module.exports = { loadProjectEnvFile };
