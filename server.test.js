import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer, makeJevRequest } from './server.js';

const board = [null, { kind: 'gold', msLeft: 430 }, null, null, { kind: 'bomb', msLeft: 900 }, null, null, null, null];
const image = 'data:image/png;base64,AAAA';

test('Jev request gives the model the visible board and ten bounded actions', () => {
  const request = makeJevRequest({ holes: board, score: 4 });
  assert.equal(request.model, 'jev-latest');
  assert.equal(request.samples, 1);
  assert.equal(request.state.holes[1].occupant, 'gold');
  assert.equal(request.state.holes[1].milliseconds_remaining, 430);
  assert.equal(request.state.holes[4].occupant, 'bomb');
  assert.deepEqual(Object.keys(request.questions.action.criteria), ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'wait']);
});

test('image request carries board pixels without the text occupancy list', () => {
  const request = makeJevRequest({ mode: 'image', image, score: 4, samples: 'auto' });
  assert.deepEqual(request.images, [image]);
  assert.equal(request.samples, 'auto');
  assert.equal('holes' in request.state, false);
  assert.equal(request.questions.action.type, 'choice');
});

test('local server checks health and proxies a decision to the structured port', async () => {
  let observed;
  const server = createAppServer({
    baseUrl: 'http://10.0.0.33:8011',
    key: '',
    fetchImpl: async (url, options) => {
      observed = { url, options };
      if (url.endsWith('/health')) {
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      }
      return new Response(JSON.stringify({
        model: 'dgemma',
        answers: { action: { type: 'choice', choice: 'h2', confidence: .94, probabilities: { h2: .94 } } },
        usage: { input_tokens: 120, output_tokens: 10 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = `http://127.0.0.1:${server.address().port}`;
    const status = await (await fetch(`${address}/api/status`)).json();
    assert.equal(status.connected, true);
    assert.equal(status.endpoint, '10.0.0.33:8011');
    const response = await fetch(`${address}/api/decide`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ holes: board, score: 4, samples: 4 }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.choice, 'h2');
    assert.equal(result.model, 'dgemma');
    assert.equal(observed.url, 'http://10.0.0.33:8011/v1/systemone');
    assert.equal(observed.options.headers.Authorization, undefined);
    assert.equal(JSON.parse(observed.options.body).questions.action.type, 'choice');
    assert.equal(JSON.parse(observed.options.body).samples, 4);
    const imageResponse = await fetch(`${address}/api/decide`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'image', image, score: 0, samples: 1 }),
    });
    assert.equal(imageResponse.status, 200);
    const forwarded = JSON.parse(observed.options.body);
    assert.deepEqual(forwarded.images, [image]);
    assert.equal('holes' in forwarded.state, false);
  } finally {
    server.close();
  }
});
