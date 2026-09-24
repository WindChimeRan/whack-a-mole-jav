import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createMetalRequest, parseMetalChoice } from './metal-client.js';
import { defaultModelId } from './model-connection.js';
import { defaultJevModel, makeJevRequest, parseJevDecision } from './jev-client.js';

export { parseMetalChoice } from './metal-client.js';
export { makeJevRequest } from './jev-client.js';

const root = dirname(fileURLToPath(import.meta.url));
const model = defaultJevModel;
const port = Number(process.env.PORT || 4173);

const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/metal-client.js': ['metal-client.js', 'text/javascript; charset=utf-8'],
  '/model-connection.js': ['model-connection.js', 'text/javascript; charset=utf-8'],
  '/jev-client.js': ['jev-client.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_500_000) throw new Error('Request is too large');
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON');
  }
}

export function makeMetalRequest(input, metalModel) {
  makeJevRequest(input); // Keep the same bounded input validation for the local proxy.
  return createMetalRequest(input, metalModel);
}

export function createAppServer({
  fetchImpl = fetch,
  baseUrl = process.env.JEV_BASE_URL || 'http://127.0.0.1:8011',
  key = process.env.JEV_API_KEY || '',
  metalUrl = process.env.METAL_BASE_URL || 'http://127.0.0.1:8012',
  metalModel = process.env.METAL_MODEL || defaultModelId,
  metalKey = process.env.METAL_API_KEY || '',
} = {}) {
  const decisionUrl = new URL('/v1/systemone', baseUrl).toString();
  const healthUrl = new URL('/health', baseUrl).toString();
  const endpoint = new URL(baseUrl).host;
  const metalDecisionUrl = metalUrl ? new URL('/v1/chat/completions', metalUrl).toString() : null;
  const metalHealthUrl = metalUrl ? new URL('/health', metalUrl).toString() : null;
  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    try {
      if (req.method === 'POST' && !req.headers['content-type']?.startsWith('application/json')) {
        return json(res, 415, { error: 'JSON content type required.' });
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        const checkHealth = async (target) => {
          if (!target) return false;
          try {
            const response = await fetchImpl(target, { signal: AbortSignal.timeout(2_000) });
            return response.ok;
          } catch {
            return false;
          }
        };
        const [connected, metalConnected] = await Promise.all([checkHealth(healthUrl), checkHealth(metalHealthUrl)]);
        return json(res, 200, {
          connected, model, endpoint,
          metalConfigured: Boolean(metalDecisionUrl), metalConnected,
          metalModel, metalEndpoint: metalUrl ? new URL(metalUrl).host : null,
        });
      }

      if (req.method === 'POST' && url.pathname === '/api/decide') {
        const input = await readJson(req);
        const backend = input.backend || 'metal';
        if (backend === 'metal') {
          if (!metalDecisionUrl) return json(res, 503, { error: 'Qwen Metal backend is not configured.' });
          const payload = makeMetalRequest(input, metalModel);
          const started = performance.now();
          let response;
          try {
            response = await fetchImpl(metalDecisionUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(metalKey ? { Authorization: `Bearer ${metalKey}` } : {}),
              },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(8_000),
            });
          } catch (error) {
            return json(res, 502, { error: `Could not reach Qwen Metal: ${error.name === 'TimeoutError' ? 'request timed out' : 'network error'}.` });
          }
          if (!response.ok) return json(res, 502, { error: `Qwen Metal returned HTTP ${response.status}.` });
          const result = await response.json();
          const raw = result?.choices?.[0]?.message?.content;
          const choice = parseMetalChoice(raw);
          const proxyMs = Math.round(performance.now() - started);
          return json(res, 200, {
            choice: choice || 'wait', invalidOutput: !choice,
            model: result.model || metalModel,
            inputTokens: result.usage?.prompt_tokens ?? null,
            modelMs: proxyMs, proxyMs, timingSource: 'local_proxy_round_trip',
          });
        }
        if (backend !== 'jev') return json(res, 400, { error: 'Unknown backend.' });
        const payload = makeJevRequest(input);
        const started = performance.now();
        let response;
        try {
          response = await fetchImpl(decisionUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(key ? { Authorization: `Bearer ${key}` } : {}),
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(8_000),
          });
        } catch (error) {
          return json(res, 502, { error: `Could not reach the decision server: ${error.name === 'TimeoutError' ? 'request timed out' : 'network error'}.` });
        }
        if (!response.ok) {
          return json(res, 502, { error: `Decision server returned HTTP ${response.status}.` });
        }
        const result = await response.json();
        let decision;
        try {
          decision = parseJevDecision(result, model);
        } catch {
          return json(res, 502, { error: 'Decision server returned an unexpected choice response.' });
        }
        return json(res, 200, {
          ...decision,
          proxyMs: Math.round(performance.now() - started),
        });
      }

      const asset = assets[url.pathname];
      if (req.method === 'GET' && asset) {
        const data = await readFile(join(root, asset[0]));
        res.writeHead(200, {
          'Content-Type': asset[1],
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src http: https:; img-src 'self' data:; object-src 'none'; base-uri 'none'",
        });
        return res.end(data);
      }
      return json(res, 404, { error: 'Not found' });
    } catch (error) {
      return json(res, error.message === 'Invalid game state' || error.message === 'Invalid JSON' || error.message === 'Request is too large' ? 400 : 500, {
        error: error.message === 'Invalid game state' || error.message === 'Invalid JSON' || error.message === 'Request is too large'
          ? error.message
          : 'Server error',
      });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createAppServer().listen(port, '127.0.0.1', () => {
    console.log(`Mole Lab is ready at http://127.0.0.1:${port}`);
  });
}
