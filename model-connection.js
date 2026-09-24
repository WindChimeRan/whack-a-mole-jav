export const defaultModelId = 'Qwen/Qwen3.5-0.8B';

export function parseModelBaseUrl(raw) {
  const value = raw.trim();
  let url;
  try {
    url = new URL(value.includes('://') ? value : `http://${value}`);
  } catch {
    throw new Error('Enter a valid model server URL.');
  }
  if (!['http:', 'https:'].includes(url.protocol)
    || url.username || url.password || url.search || url.hash) {
    throw new Error('Enter an HTTP or HTTPS model URL without credentials or query parameters.');
  }
  let path = url.pathname.replace(/\/+$/, '');
  path = path.replace(/\/v1(?:\/chat\/completions)?$/, '');
  const baseUrl = `${url.origin}${path}`;
  return {
    baseUrl,
    modelsUrl: `${baseUrl}/v1/models`,
    completionUrl: `${baseUrl}/v1/chat/completions`,
    endpoint: `${url.host}${path}/v1/chat/completions`,
  };
}

export function parseJevBaseUrl(raw) {
  const normalized = raw.trim().replace(/\/v1\/systemone\/?$/, '');
  const connection = parseModelBaseUrl(normalized);
  return {
    baseUrl: connection.baseUrl,
    healthUrl: `${connection.baseUrl}/health`,
    decisionUrl: `${connection.baseUrl}/v1/systemone`,
    endpoint: `${new URL(connection.baseUrl).host}${new URL(connection.baseUrl).pathname.replace(/\/$/, '')}/v1/systemone`,
  };
}
