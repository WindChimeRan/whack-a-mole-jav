import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const productionOrigin = 'https://mole-lab.vercel.app';

export function createJevBridge({
  baseUrl = process.env.JEV_BASE_URL || 'http://127.0.0.1:8011',
  key = process.env.JEV_API_KEY || '',
  allowedOrigins = (process.env.BRIDGE_ALLOWED_ORIGIN || productionOrigin).split(',').map((origin) => origin.trim()),
  fetchImpl = fetch,
} = {}) {
  const target = new URL(baseUrl);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash) {
    throw new Error('JEV_BASE_URL must be an HTTP or HTTPS server URL without credentials.');
  }
  const originSet = new Set(allowedOrigins);
  const destination = (path) => new URL(path, `${target.origin}/`).toString();
  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    const browserAllowed = !origin || originSet.has(origin);
    const headers = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Vary': 'Origin',
      ...(browserAllowed && origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    };
    const send = (status, body) => {
      res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    if (!browserAllowed) return send(403, { error: 'This site is not allowed to use the Jev bridge.' });
    if (req.method === 'OPTIONS' && ['/health', '/v1/systemone'].includes(req.url)) {
      res.writeHead(204, {
        ...headers,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'content-type, authorization',
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Max-Age': '600',
      });
      return res.end();
    }
    if (req.method === 'GET' && req.url === '/health') {
      try {
        const response = await fetchImpl(destination('/health'), { signal: AbortSignal.timeout(3_000) });
        return send(response.ok ? 200 : 502, response.ok ? { status: 'ok' } : { error: `Jev returned HTTP ${response.status}.` });
      } catch {
        return send(502, { error: 'Cannot reach the Jev server.' });
      }
    }
    if (req.method === 'POST' && req.url === '/v1/systemone') {
      if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: 'JSON content type required.' });
      let body = '';
      try {
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 1_500_000) return send(413, { error: 'Request is too large.' });
        }
        JSON.parse(body);
      } catch {
        return send(400, { error: 'Invalid JSON.' });
      }
      try {
        const response = await fetchImpl(destination('/v1/systemone'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(key || req.headers.authorization ? { Authorization: key ? `Bearer ${key}` : req.headers.authorization } : {}),
          },
          body,
          signal: AbortSignal.timeout(8_000),
        });
        res.writeHead(response.status, { ...headers, 'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8' });
        return res.end(await response.text());
      } catch {
        return send(502, { error: 'Cannot reach the Jev server.' });
      }
    }
    return send(404, { error: 'Not found.' });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.BRIDGE_PORT || 8013);
  createJevBridge().listen(port, '127.0.0.1', () => {
    console.log(`Jev bridge ready at http://127.0.0.1:${port}`);
  });
}
