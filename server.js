import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createMetalRequest, parseMetalChoice } from './metal-client.js';

export { parseMetalChoice } from './metal-client.js';

const root = dirname(fileURLToPath(import.meta.url));
const model = 'jev-latest';
const port = Number(process.env.PORT || 4173);

const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/metal-client.js': ['metal-client.js', 'text/javascript; charset=utf-8'],
  '/model-connection.js': ['model-connection.js', 'text/javascript; charset=utf-8'],
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

function validBoard(holes) {
  return Array.isArray(holes)
    && holes.length === 9
    && holes.every((hole) => hole === null || (
      typeof hole === 'object'
      && ['mole', 'gold', 'bomb'].includes(hole.kind)
      && Number.isFinite(hole.msLeft)
      && hole.msLeft >= 0
      && hole.msLeft <= 10_000
    ));
}

export function makeJevRequest({ mode = 'text', holes, image, score, samples = 1 }) {
  const validImage = typeof image === 'string'
    && image.length <= 1_400_000
    && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image);
  if (!['text', 'image'].includes(mode)
    || !Number.isFinite(score)
    || ![1, 4, 'auto'].includes(samples)
    || (mode === 'text' && !validBoard(holes))
    || (mode === 'image' && !validImage)) {
    throw new Error('Invalid game state');
  }
  const criteria = Object.fromEntries(
    Array.from({ length: 9 }, (_, i) => [`h${i + 1}`, `Whack hole ${i + 1} (row-major board position).`]),
  );
  criteria.wait = 'Do not whack a hole right now.';

  return {
    model,
    samples,
    ...(mode === 'image' ? { images: [image] } : {}),
    state: mode === 'image' ? {
      game: 'Whack-a-mole',
      score,
      layout: 'The attached image is the current 3 by 3 board. Hole numbers 01 to 09 are printed next to their holes in row-major order: 01 top-left, 05 center, 09 bottom-right.',
      rules: 'Brown mole +1; gold mole +3; dark gray bomb with orange fuse -2. Dark empty holes score 0. A target may disappear before your action arrives. Judge visible occupants from the image.',
    } : {
      game: 'Whack-a-mole',
      score,
      rules: 'A mole is +1, a gold mole is +3, and a bomb is -2. Empty holes give 0. A target can disappear before the action arrives. Prefer valuable targets that are about to expire.',
      holes: holes.map((hole, i) => ({
        position: i + 1,
        occupant: hole?.kind || 'empty',
        milliseconds_remaining: hole?.msLeft || 0,
      })),
    },
    questions: {
      action: {
        type: 'choice',
        instructions: mode === 'image'
          ? 'Look at the attached board image. Choose one numbered hole containing a visible brown or gold mole. Prefer gold. Avoid gray bombs and empty dark holes. If no mole is visible, wait.'
          : 'Choose the single best action right now to maximize score. Avoid bombs and empty holes. If no positive target is visible, wait.',
        criteria,
      },
    },
  };
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
  metalModel = process.env.METAL_MODEL || 'qwen35-metal',
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
        const answer = result?.answers?.action;
        if (answer?.type !== 'choice' || !/^(h[1-9]|wait)$/.test(answer.choice)) {
          return json(res, 502, { error: 'Decision server returned an unexpected choice response.' });
        }
        return json(res, 200, {
          choice: answer.choice,
          confidence: answer.confidence,
          probabilities: answer.probabilities,
          model: result.model || model,
          inputTokens: result.usage?.input_tokens ?? null,
          modelMs: Number.isFinite(result.diagnostics?.timing?.total_ms)
            ? Math.round(result.diagnostics.timing.total_ms)
            : null,
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
