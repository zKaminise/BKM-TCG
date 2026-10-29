const operatingSystemKeys = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR',
  'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'HOMEDRIVE', 'HOMEPATH',
  'TZ', 'LANG', 'LC_ALL', 'CI', 'GITHUB_ACTIONS'
]);

function testEnvironment(source = process.env, overrides = {}) {
  const clean = Object.fromEntries(Object.entries(source).filter(([key]) => operatingSystemKeys.has(key.toUpperCase())));
  return { ...clean, NODE_ENV: 'test', BKM_SKIP_DOTENV: 'true', BKM_ENVIRONMENT: 'demo', HOSTING_DEMO_ONLY: 'true', PAYMENT_PROVIDER: 'disabled', EMAIL_PROVIDER: 'development', MYP_CARDS_ENABLED: 'false', ...overrides };
}

module.exports = { testEnvironment };
