// Retains the supplied Worker ESM starter's default.fetch contract. The build
// embeds assets into this module; no standalone asset bindings are needed.
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
} });

// Classification now runs against our bundled weights in the browser. These
// compatibility routes deliberately have no provider connection or credentials.
export function handleLocalApi(request) {
  const url = new URL(request.url);
  if (url.pathname === '/api/health') {
    if (request.method !== 'GET') return json({ ok: false, error: { code: 'method_not_allowed', message: 'Use GET.' } }, 405);
    return json({ configured: true, provider: 'trained-local-classifier', callsExternalApi: false });
  }
  if (url.pathname === '/api/plan') return json({ ok: false, error: {
    code: 'local_model_in_browser', message: 'Workout requests are classified locally in this browser. Use Plan my workout on the website.',
  } }, 410);
  return json({ ok: false, error: { code: 'not_found', message: 'Not found.' } }, 404);
}

export function createWorker(assets) {
  return {
    async fetch(request, env, ctx) {
      void env; void ctx;
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) return handleLocalApi(request);
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
      let path;
      try { path = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname); }
      catch { return new Response('Bad request', { status: 400 }); }
      if (!/^\/[^/\\\0]+$/.test(path) || path.startsWith('/.')) return new Response('Not found', { status: 404 });
      const asset = Object.hasOwn(assets, path) ? assets[path] : null;
      if (!asset) return new Response('Not found', { status: 404 });
      return new Response(request.method === 'HEAD' ? null : asset.body, { headers: {
        'content-type': asset.type, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin',
        'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com https://*.chatgpt.site",
      } });
    },
  };
}
