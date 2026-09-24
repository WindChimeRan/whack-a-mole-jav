import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseModelBaseUrl } from './model-connection.js';

test('model URL accepts a local host and a standard /v1 suffix', () => {
  assert.deepEqual(parseModelBaseUrl('127.0.0.1:8012'), {
    baseUrl: 'http://127.0.0.1:8012',
    modelsUrl: 'http://127.0.0.1:8012/v1/models',
    completionUrl: 'http://127.0.0.1:8012/v1/chat/completions',
    endpoint: '127.0.0.1:8012/v1/chat/completions',
  });
  assert.equal(parseModelBaseUrl('https://example.com/proxy/v1').completionUrl,
    'https://example.com/proxy/v1/chat/completions');
  assert.equal(parseModelBaseUrl('http://localhost:8000/v1/chat/completions/').modelsUrl,
    'http://localhost:8000/v1/models');
});

test('model URL rejects credentials, query strings, and non-HTTP schemes', () => {
  for (const value of ['http://user:pass@localhost:8000', 'https://example.com/?key=secret', 'file:///tmp/model', '']) {
    assert.throws(() => parseModelBaseUrl(value));
  }
});
