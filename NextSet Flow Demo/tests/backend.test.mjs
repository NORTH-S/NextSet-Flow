import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorker, handleLocalApi } from '../worker/index.js';

const healthBody = { configured: true, provider: 'trained-local-classifier', callsExternalApi: false };
const assets = {
  '/index.html': { body: '<h1>NextSet Flow</h1>', type: 'text/html; charset=utf-8' },
  '/trained-model.js': { body: 'export const TRAINED_MODEL = {format:"nextset-tfidf-logreg-v1"};', type: 'text/javascript; charset=utf-8' },
};

test('public health reports the bundled classifier without reading provider credentials', async () => {
  const worker = createWorker(assets);
  const response = await worker.fetch(new Request('https://nextset.test/api/health'), { OPENAI_API_KEY: 'test-only-unused' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), healthBody);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('retired planning endpoint is unavailable for every method and never calls an external provider', async () => {
  const originalFetch = globalThis.fetch;
  let called = 0;
  globalThis.fetch = () => { called++; throw new Error('External request forbidden'); };
  try {
    const worker = createWorker(assets);
    for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']) {
      const response = await worker.fetch(new Request('https://nextset.test/api/plan', { method,
        ...(method === 'POST' ? { body: '{invalid-json', headers: { 'content-type': 'application/json' } } : {}),
      }), { OPENAI_API_KEY: 'test-only-unused' });
      assert.equal(response.status, 410);
      const body = await response.json();
      assert.equal(body.ok, false);
      assert.equal(body.error.code, 'local_model_in_browser');
      assert(!JSON.stringify(body).includes('test-only-unused'));
    }
    assert.equal(called, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('API routes have bounded compatibility behavior without parsing workout input', async () => {
  assert.equal(handleLocalApi(new Request('https://nextset.test/api/unknown')).status, 404);
  assert.equal(handleLocalApi(new Request('https://nextset.test/api/health', { method: 'POST' })).status, 405);
  const response = handleLocalApi(new Request('https://nextset.test/api/plan', { method: 'POST', body: 'x'.repeat(10000) }));
  assert.equal(response.status, 410);
  assert.equal((await response.json()).intent, undefined);
});

test('public page and trained model asset require no account and retain security headers', async () => {
  const worker = createWorker(assets);
  const page = await worker.fetch(new Request('https://nextset.test/'), {});
  assert.equal(page.status, 200);
  assert.match(await page.text(), /NextSet Flow/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
  const model = await worker.fetch(new Request('https://nextset.test/trained-model.js'), {});
  assert.equal(model.status, 200);
  assert.match(model.headers.get('content-type'), /javascript/);
  assert.match(await model.text(), /nextset-tfidf-logreg/);
  const head = await worker.fetch(new Request('https://nextset.test/trained-model.js', { method: 'HEAD' }), {});
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('hidden files, traversals, inherited object keys and unsupported methods are not served', async () => {
  const worker = createWorker(assets);
  for (const path of ['/.env.local', '/.openai/hosting.json', '/server/index.js', '/%2eenv.local', '/%2e%2e/.env.local', '/a%5cb.js', '/constructor', '/__proto__']) {
    assert.equal((await worker.fetch(new Request('https://nextset.test' + path), {})).status, 404, path);
  }
  assert.equal((await worker.fetch(new Request('https://nextset.test/%E0%A4%A'), {})).status, 400);
  assert.equal((await worker.fetch(new Request('https://nextset.test/', { method: 'POST' }), {})).status, 405);
});

test('Worker build and local server no longer import or configure the paid API backend', async () => {
  const [worker, build, server] = await Promise.all(['worker/index.js', 'build-worker.mjs', 'server.mjs'].map(p => readFile(new URL('../' + p, import.meta.url), 'utf8')));
  assert.doesNotMatch(worker, /backend\/api|OPENAI_API_KEY|api\.openai\.com|Bearer/);
  assert.doesNotMatch(server, /backend\/api|OPENAI_API_KEY|\.env\.local|Bearer/);
  assert.doesNotMatch(build, /readFile\(resolve\(root, 'backend\/api\.js'/);
  assert.match(build, /callsExternalApi: false/);
});

test('actual local HTTP server serves model assets and refuses the retired API and private paths', async (t) => {
  const serverPath = fileURLToPath(new URL('../server.mjs', import.meta.url));
  const child = spawn(process.execPath, [serverPath], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => child.kill());
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Preview server did not start')), 5000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', chunk => { const url = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; if (url) { clearTimeout(timer); resolve(url); } });
    child.on('exit', code => { clearTimeout(timer); if (code) reject(new Error('Preview server exited')); });
  });
  const health = await fetch(origin + '/api/health');
  assert.deepEqual(await health.json(), healthBody);
  assert.equal((await fetch(origin + '/')).status, 200);
  const model = await fetch(origin + '/trained-model.js');
  assert.equal(model.status, 200);
  assert.match(await model.text(), /TRAINED_MODEL.*nextset-tfidf-logreg-v1/);
  const retired = await fetch(origin + '/api/plan', { method: 'POST', body: 'invalid' });
  assert.equal(retired.status, 410);
  assert.equal((await retired.json()).error.code, 'local_model_in_browser');
  for (const path of ['/.env.local', '/server/index.js', '/.openai/hosting.json', '/%2e%2e/.env.local']) assert.equal((await fetch(origin + path)).status, 404);
  const head = await fetch(origin + '/index.html', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
});
