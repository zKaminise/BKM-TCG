const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');

const keys = ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_STORAGE_BUCKET', 'BKM_DB_POOL_SIZE'];
const usage = 'Uso: npm run db:configure -- --host aws-0-sa-east-1.pooler.supabase.com --project abcdefghijklmnopqrst. Sem argumentos, o assistente solicita esses dados.';

function parseArguments(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--help' || flag === '-h') { options.help = true; continue; }
    if (!['--host', '--project'].includes(flag) || options[flag.slice(2)] !== undefined || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(usage);
    options[flag.slice(2)] = args[++index];
  }
  return options;
}

function validateConnection({ host, project }) {
  if (typeof host !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.pooler\.supabase\.com$/.test(host)) throw new Error('Informe apenas o host do pooler Supabase, terminado em .pooler.supabase.com, sem protocolo, porta ou credenciais.');
  if (typeof project !== 'string' || !/^[a-z]{20}$/.test(project)) throw new Error('A referencia do projeto deve conter exatamente 20 letras minusculas.');
  return { host, project };
}

function buildSettings({ host, project, password }) {
  validateConnection({ host, project });
  if (typeof password !== 'string' || password.length < 1 || password.length > 1024 || /[\r\n\0]/.test(password)) throw new Error('Senha invalida. Digite a senha existente do banco sem quebras de linha.');
  let encoded;
  try { encoded = encodeURIComponent(password).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase()); }
  catch { throw new Error('Nao foi possivel codificar a senha. Digite novamente.'); }
  return {
    DATABASE_URL: `postgresql://postgres.${project}:${encoded}@${host}:6543/postgres`,
    SUPABASE_URL: `https://${project}.supabase.co`,
    SUPABASE_STORAGE_BUCKET: 'bkm-public',
    BKM_DB_POOL_SIZE: '1'
  };
}

function quoteClosed(value, quote) {
  let escaped = false;
  for (let index = 1; index < value.length; index++) {
    const char = value[index];
    if (char === quote && !escaped) return true;
    escaped = char === '\\' && !escaped;
  }
  return false;
}

// Preserve unrelated assignments, comments, newline style and quoted multiline
// values. Remove duplicate assignments only for the four explicitly owned keys.
function updateDotEnv(source, values) {
  if (typeof source !== 'string' || Object.keys(values).some(key => !keys.includes(key)) || keys.some(key => typeof values[key] !== 'string' || /[\r\n\0]/.test(values[key]))) throw new Error('Configuracao de ambiente invalida.');
  const bom = source.startsWith('\ufeff') ? '\ufeff' : '';
  const content = bom ? source.slice(1) : source;
  const newline = content.match(/\r\n|\n|\r/)?.[0] || '\n';
  const lines = content.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g).filter(Boolean);
  const seen = new Set();
  let result = '';
  for (let index = 0; index < lines.length; index++) {
    let record = lines[index];
    const assignment = record.match(/^[\t ]*(?:export[\t ]+)?([A-Za-z_][A-Za-z0-9_]*)[\t ]*=[\t ]*([^\r\n]*)/);
    if (assignment && ['"', "'", '`'].includes(assignment[2][0])) {
      const quote = assignment[2][0];
      let value = assignment[2];
      while (!quoteClosed(value, quote) && index + 1 < lines.length) {
        const next = lines[++index];
        record += next;
        value += '\n' + next;
      }
      if (!quoteClosed(value, quote)) throw new Error('O arquivo .env contem um valor entre aspas sem fechamento. Corrija-o antes de configurar o banco.');
    }
    const key = assignment?.[1];
    if (keys.includes(key)) {
      if (!seen.has(key)) result += `${key}=${values[key]}${record.match(/\r\n$|\n$|\r$/)?.[0] || newline}`;
      seen.add(key);
    } else result += record;
  }
  for (const key of keys) if (!seen.has(key)) {
    if (result && !/[\r\n]$/.test(result)) result += newline;
    result += `${key}=${values[key]}${newline}`;
  }
  return bom + result;
}

function atomicUpdateEnv(filename, values) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('O .env deve ser um arquivo local regular.');
  const source = fs.readFileSync(filename, 'utf8');
  const updated = updateDotEnv(source, values);
  const temporary = path.join(path.dirname(filename), `.env.${crypto.randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(descriptor, updated, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    if (fs.readFileSync(filename, 'utf8') !== source) throw new Error('O .env foi alterado durante a configuracao. Nenhum valor foi substituido; execute novamente.');
    fs.renameSync(temporary, filename);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

async function readVisible(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try { return await new Promise(resolve => rl.question(prompt, resolve)); }
  finally { rl.close(); }
}

async function readSecret(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Execute este assistente em um terminal interativo. Senhas por argumento, pipe ou arquivo nao sao aceitas.');
  process.stdout.write(prompt);
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      process.stdin.off('keypress', onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onKey = (str, key = {}) => {
      if (key.ctrl && key.name === 'c') { cleanup(); reject(new Error('Operacao cancelada.')); }
      else if (key.name === 'return') { cleanup(); resolve(value); }
      else if (key.name === 'backspace') value = Array.from(value).slice(0, -1).join('');
      else if (str && !key.ctrl && !key.meta && !/[\r\n\0]/.test(str) && value.length + str.length <= 1024) value += str;
    };
    process.stdin.on('keypress', onKey);
  });
}

async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) { console.log(usage); return; }
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Execute CONECTAR SUPABASE.cmd ou npm run db:configure em um terminal interativo. A senha deve ser digitada sem exibicao.');
  if (!options.host) options.host = (await readVisible('Host do pooler Supabase (sem porta): ')).trim();
  if (!options.project) options.project = (await readVisible('Referencia do projeto (20 letras minusculas): ')).trim();
  validateConnection(options);
  const filename = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(filename)) throw new Error('Crie primeiro o .env privado a partir de .env.example ou execute CONECTAR SUPABASE.cmd.');
  console.log('Digite a senha do banco ja criada no painel Supabase. A digitacao fica oculta.');
  let password = await readSecret('Senha existente do banco: ');
  let confirmation = await readSecret('Confirme a senha existente: ');
  if (password !== confirmation) throw new Error('As senhas nao coincidem. O .env nao foi alterado.');
  try { atomicUpdateEnv(filename, buildSettings({ ...options, password })); }
  finally { password = ''; confirmation = ''; }
  console.log('Conexao salva no .env privado, sem revelar credenciais. As outras configuracoes foram preservadas.');
  console.log('A chave de servico do Storage permanece separada. Reinicie a loja depois de concluir a configuracao.');
}

if (require.main === module) main().catch(error => {
  // Never include raw filesystem/connection errors, which can contain secrets.
  console.error(error.code ? 'Nao foi possivel atualizar o .env privado. Confira acesso ao arquivo e execute novamente.' : error.message);
  process.exitCode = 1;
});
module.exports = { parseArguments, validateConnection, buildSettings, updateDotEnv, atomicUpdateEnv };
