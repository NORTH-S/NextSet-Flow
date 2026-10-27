import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const assets = {};
for (const item of await readdir(resolve(root, 'dist'), { withFileTypes: true })) {
  if (!item.isFile() || !types[extname(item.name)] || item.name.startsWith('.')) continue;
  assets['/' + item.name] = { type: types[extname(item.name)], body: await readFile(resolve(root, 'dist', item.name), 'utf8') };
}
assert(assets['/index.html'], 'Missing frontend index.html');
const worker = (await readFile(resolve(root, 'worker/index.js'), 'utf8')).replace(/^import[^\n]+\n/gm, '').replace(/^export /gm, '');
// Hosting identity is deliberately absent from this portable GitHub export.
// A deployment owner may supply their own manifest without changing the app.
let manifest = null;
try { manifest = JSON.parse(await readFile(resolve(root, '.openai/hosting.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (manifest) assert(!manifest.static, 'Worker manifest cannot declare static deployment');
assert(!worker.includes('backend/api.js'), 'Worker must not import the retired provider endpoint');
const output = `${worker}\nexport default createWorker(${JSON.stringify(assets)});\n`;
assert(!output.includes('https://api.openai.com/'), 'Deployment must not contain the retired provider request path');
assert(!/OPENAI_API_KEY|authorization[^\n]{0,80}Bearer/.test(output), 'Deployment must not contain provider credential handling');
await mkdir(resolve(root, 'dist/server'), { recursive: true });
await writeFile(resolve(root, 'dist/server/index.js'), output);
if (manifest) {
  await mkdir(resolve(root, 'dist/.openai'), { recursive: true });
  await writeFile(resolve(root, 'dist/.openai/hosting.json'), JSON.stringify(manifest, null, 2) + '\n');
}
const built = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
assert.equal(typeof built.default?.fetch, 'function');
const response = await built.default.fetch(new Request('https://nextset.test/'), {});
assert.equal(response.status, 200);
assert((await response.text()).includes('NextSet'));
const health = await built.default.fetch(new Request('https://nextset.test/api/health'), {});
assert.deepEqual(await health.json(), { configured: true, provider: 'trained-local-classifier', callsExternalApi: false });
const retired = await built.default.fetch(new Request('https://nextset.test/api/plan', { method: 'POST' }), {});
assert.equal(retired.status, 410);
console.log(`Worker ESM built and verified: ${Object.keys(assets).length} embedded assets, ${Buffer.byteLength(output)} bytes.`);
