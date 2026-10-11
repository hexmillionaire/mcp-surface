import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const source = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
assert.equal(Object.keys(manifest.dependencies ?? {}).length, 0);
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm run test:package.');
const tempBase = await realpath(tmpdir());
const temp = await mkdtemp(join(tempBase, 'mcp-surface-package-'));
function run(args, { cwd = source, expected = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, windowsHide: true, env: { ...process.env, npm_config_cache: join(temp, 'npm-cache'), npm_config_update_notifier: 'false' } });
    child.stdin.end();
    let stdout = ''; let stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    const timer = setTimeout(() => { child.kill(); reject(new Error('Package test timed out.')); }, 60000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); code === expected ? resolve(stdout) : reject(new Error('Unexpected exit ' + code + ': ' + stderr + '\n' + stdout)); });
  });
}
try {
  const packed = JSON.parse(await run([npm, 'pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', temp]))[0];
  assert.equal(packed.version, manifest.version);
  for (const file of packed.files) assert.ok(!/^(node_modules|test|\.git)\//.test(file.path), file.path);
  const install = join(temp, 'install with space'); await mkdir(install);
  await run([npm, 'install', '--offline', '--prefix', install, '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', join(temp, packed.filename)]);
  const installed = join(install, 'node_modules', ...manifest.name.split('/'));
  const bin = join(installed, 'bin/mcp-surface.mjs');
  assert.equal((await run([bin, '--version'])).trim(), manifest.version);
  const baseline = join(installed, 'examples/baseline.json');
  const compatible = join(installed, 'examples/compatible.json');
  const breaking = join(installed, 'examples/breaking.json');
  assert.equal(JSON.parse(await run([bin, 'compare', baseline, compatible])).counts.compatible, 2);
  assert.equal(JSON.parse(await run([bin, 'compare', baseline, breaking], { expected: 1 })).counts.breaking, 2);
  const exportsURL = pathToFileURL(join(installed, 'src/index.mjs')).href;
  await run(['--input-type=module', '--eval', 'const api=await import(' + JSON.stringify(exportsURL) + '); if(api.lintArtifact({tools:[]}).behaviorVerification!=="not-performed") throw Error("API smoke failed");']);
  const installedManifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.equal(Object.keys(installedManifest.dependencies ?? {}).length, 0);
  console.log(manifest.name + ': offline production archive install, API and CLI passed.');
} finally {
  assert.equal(dirname(temp), tempBase);
  assert.ok(temp.startsWith(join(tempBase, 'mcp-surface-package-')));
  await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
