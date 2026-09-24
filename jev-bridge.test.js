import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJevBridge } from './scripts/jev-bridge.mjs';

test('Jev bridge permits the hosted game and forwards a decision to Spark', async () => {
  const calls = [];
  const bridge = createJevBridge({
    baseUrl: 'http://192.0.2.10:8011',
    key: 'server-secret',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return url.endsWith('/health')
        ? new Response('{}', { status: 200 })
        : new Response(JSON.stringify({ answers: { action: { type: 'choice', choice: 'h2' } } }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
    },
  });
  await new Promise((resolve) => bridge.listen(0, '127.0.0.1', resolve));
  try {
    const address = `http://127.0.0.1:${bridge.address().port}`;
    const origin = 'https://mole-lab.vercel.app';
    const preflight = await fetch(`${address}/v1/systemone`, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
    const health = await fetch(`${address}/health`, { headers: { Origin: origin } });
    assert.equal(health.status, 200);
    const response = await fetch(`${address}/v1/systemone`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'jev-latest', state: {}, questions: {} }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).answers.action.choice, 'h2');
    assert.equal(calls[1].url, 'http://192.0.2.10:8011/v1/systemone');
    assert.equal(calls[1].options.headers.Authorization, 'Bearer server-secret');
    const denied = await fetch(`${address}/health`, { headers: { Origin: 'https://unrelated.example' } });
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.get('access-control-allow-origin'), null);
  } finally {
    bridge.close();
  }
});
