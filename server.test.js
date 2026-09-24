import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer, makeJevRequest, makeMetalRequest, parseMetalChoice } from './server.js';
import { metalImagePrompt } from './metal-client.js';
import { parseJevDecision } from './jev-client.js';

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

test('browser Jev response keeps the selected action and server timing', () => {
  const result = parseJevDecision({
    model: 'dgemma',
    answers: { action: { type: 'choice', choice: 'h2', confidence: .94 } },
    usage: { input_tokens: 120 },
    diagnostics: { timing: { total_ms: 123.4 } },
  });
  assert.deepEqual(result, {
    choice: 'h2', confidence: .94, probabilities: undefined, model: 'dgemma',
    inputTokens: 120, modelMs: 123,
  });
  assert.throws(() => parseJevDecision({ answers: { action: { type: 'choice', choice: 'h1 h2' } } }));
});

test('Qwen Metal requests keep image observations visual and parse bounded labels', () => {
  const textRequest = makeMetalRequest({ mode: 'text', holes: board, score: 4, samples: 1 }, 'qwen35-metal');
  assert.match(textRequest.messages[0].content, /Hole 2: gold mole \(430 ms left\)/);
  assert.match(textRequest.messages[0].content, /Do not hit a bomb or empty hole/);
  assert.deepEqual(textRequest.structured_outputs.choice, ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'wait']);
  const imageRequest = makeMetalRequest({ mode: 'image', image, score: 4, samples: 1 }, 'qwen35-metal');
  assert.equal(imageRequest.messages[0].content[0].text, metalImagePrompt);
  assert.match(metalImagePrompt, /Do not hit a gray bomb with an orange fuse or an empty hole/);
  assert.equal(imageRequest.messages[0].content[1].image_url.url, image);
  assert.equal(JSON.stringify(imageRequest).includes('gold mole (430'), false);
  assert.equal(parseMetalChoice('h3'), 'h3');
  assert.equal(parseMetalChoice('Wait'), 'wait');
  assert.equal(parseMetalChoice('3'), 'h3');
  assert.equal(parseMetalChoice('h1 h3'), null);
});

test('Qwen Metal backend proxies chat completions separately', async () => {
  let observed;
  const server = createAppServer({
    baseUrl: 'http://192.0.2.10:8011', metalUrl: 'http://127.0.0.1:8012', metalModel: 'qwen35-metal',
    fetchImpl: async (url, options) => {
      if (url.endsWith('/health')) return new Response('{}', { status: 200 });
      observed = { url, options };
      return new Response(JSON.stringify({
        model: 'qwen35-metal',
        choices: [{ message: { content: 'h2' } }],
        usage: { prompt_tokens: 90 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = `http://127.0.0.1:${server.address().port}`;
    const status = await (await fetch(`${address}/api/status`)).json();
    assert.equal(status.connected, true);
    assert.equal(status.metalConnected, true);
    const response = await fetch(`${address}/api/decide`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'text', holes: board, score: 0, samples: 1 }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.choice, 'h2');
    assert.equal(result.timingSource, 'local_proxy_round_trip');
    assert.equal(observed.url, 'http://127.0.0.1:8012/v1/chat/completions');
    assert.deepEqual(JSON.parse(observed.options.body).structured_outputs.choice,
      ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'wait']);
  } finally {
    server.close();
  }
});

test('Qwen Metal is configured on loopback by default', async () => {
  const server = createAppServer({
    fetchImpl: async () => new Response('{}', { status: 200 }),
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const status = await (await fetch(`http://127.0.0.1:${server.address().port}/api/status`)).json();
    assert.equal(status.metalConfigured, true);
    assert.equal(status.metalEndpoint, '127.0.0.1:8012');
    assert.equal(status.metalModel, 'Qwen/Qwen3.5-0.8B');
  } finally {
    server.close();
  }
});

test('optional Jev backend checks health and proxies a structured decision', async () => {
  let observed;
  const server = createAppServer({
    baseUrl: 'http://192.0.2.10:8011',
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
        diagnostics: { timing: { total_ms: 123.4 } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = `http://127.0.0.1:${server.address().port}`;
    const status = await (await fetch(`${address}/api/status`)).json();
    assert.equal(status.connected, true);
    assert.equal(status.model, 'jev-latest');
    assert.equal(status.endpoint, '192.0.2.10:8011');
    const response = await fetch(`${address}/api/decide`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backend: 'jev', holes: board, score: 4, samples: 4 }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.choice, 'h2');
    assert.equal(result.model, 'dgemma');
    assert.equal(result.modelMs, 123);
    assert.ok(result.proxyMs >= 0);
    assert.equal(observed.url, 'http://192.0.2.10:8011/v1/systemone');
    assert.equal(observed.options.headers.Authorization, undefined);
    assert.equal(JSON.parse(observed.options.body).questions.action.type, 'choice');
    assert.equal(JSON.parse(observed.options.body).samples, 4);
    const imageResponse = await fetch(`${address}/api/decide`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backend: 'jev', mode: 'image', image, score: 0, samples: 1 }),
    });
    assert.equal(imageResponse.status, 200);
    const forwarded = JSON.parse(observed.options.body);
    assert.deepEqual(forwarded.images, [image]);
    assert.equal('holes' in forwarded.state, false);
  } finally {
    server.close();
  }
});
