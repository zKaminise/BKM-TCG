const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { testEnvironment } = require('./test-env.cjs');
const root = path.resolve(__dirname, '..');
const files = ['tests', 'server'].flatMap(directory => fs.readdirSync(path.join(root, directory)).filter(name => name.endsWith('.test.cjs')).sort().map(name => path.join(directory, name)));
const child = spawn(process.execPath, ['--require', path.join(__dirname, 'test-network.cjs'), '--test', ...process.argv.slice(2), ...files], { cwd: root, env: testEnvironment(), stdio: 'inherit', windowsHide: true });
child.on('error', () => { console.error('Não foi possível iniciar os testes isolados.'); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
