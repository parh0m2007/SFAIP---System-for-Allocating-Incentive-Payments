import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError } from '../src/api.js';

function response(status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers({ 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json', ...headers }),
    async json() { return JSON.parse(payload); },
    async text() { return payload; },
    async blob() { return new Blob([payload], { type: headers['content-type'] || 'application/octet-stream' }); },
  };
}

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('login stores tokens and authenticated requests attach the bearer token', async () => {
  const calls = [];
  const api = createApi({ storage: storage(), fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return response(200, { accessToken: 'a1', refreshToken: 'r1', user: { id: 'u1' } });
  } });

  await api.login({ email: 'a@example.com', password: 'secret' });
  await api.getProfile();

  assert.equal(calls[0].url, 'http://localhost:3001/api/auth/login');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer a1');
  assert.deepEqual(JSON.parse(calls[0].options.body), { email: 'a@example.com', password: 'secret' });
});

test('a 401 refreshes once, rotates tokens, then retries the original request', async () => {
  const calls = [];
  const store = storage();
  store.setItem('accessToken', 'expired');
  store.setItem('refreshToken', 'refresh-1');
  const api = createApi({ storage: store, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/api/profile') && calls.filter((c) => c.url.endsWith('/api/profile')).length === 1) return response(401, { code: 'TOKEN_EXPIRED', message: 'expired' });
    if (url.endsWith('/api/auth/refresh')) return response(200, { accessToken: 'fresh', refreshToken: 'refresh-2' });
    return response(200, { id: 'u1' });
  } });

  assert.deepEqual(await api.getProfile(), { id: 'u1' });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].url, 'http://localhost:3001/api/auth/refresh');
  assert.equal(JSON.parse(calls[1].options.body).refreshToken, 'refresh-1');
  assert.equal(calls[2].options.headers.Authorization, 'Bearer fresh');
  assert.equal(store.getItem('accessToken'), 'fresh');
  assert.equal(store.getItem('refreshToken'), 'refresh-2');
});

test('failed refresh clears tokens and surfaces a normalized API error', async () => {
  const store = storage();
  store.setItem('accessToken', 'expired');
  store.setItem('refreshToken', 'bad');
  const api = createApi({ storage: store, fetchImpl: async (url) => {
    if (url.endsWith('/api/auth/refresh')) return response(401, { code: 'REFRESH_INVALID', message: 'Refresh недействителен', details: { reason: 'revoked' } });
    return response(401, { code: 'TOKEN_EXPIRED', message: 'Истёк' });
  } });

  await assert.rejects(api.getProfile(), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'TOKEN_EXPIRED');
    assert.equal(error.status, 401);
    return true;
  });
  assert.equal(store.getItem('accessToken'), null);
  assert.equal(store.getItem('refreshToken'), null);
});

test('multipart upload, binary download, and normalized non-JSON errors use correct endpoints', async () => {
  const calls = [];
  const api = createApi({ storage: storage(), fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/api/files')) return response(201, { id: 'file-1' });
    if (url.endsWith('/api/files/file-1')) return response(200, 'bytes', { 'content-type': 'application/pdf' });
    return response(500, 'upstream unavailable');
  } });

  const file = new Blob(['hello'], { type: 'text/plain' });
  assert.deepEqual(await api.uploadFile(file, 'app-1', 'item-2'), { id: 'file-1' });
  const form = calls[0].options.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get('applicationId'), 'app-1');
  assert.equal(form.get('itemId'), 'item-2');
  assert.ok(form.get('file'));
  assert.ok((await api.downloadFile('file-1')) instanceof Blob);

  await assert.rejects(api.listCriteria(), (error) => {
    assert.equal(error.code, 'HTTP_ERROR');
    assert.equal(error.message, 'upstream unavailable');
    assert.equal(error.status, 500);
    return true;
  });
});

test('список школ доступен для формы регистрации', async () => {
  const calls = [];
  const api = createApi({ storage: storage(), fetchImpl: async (url) => {
    calls.push(url);
    return response(200, [{ id: 'school-101', name: 'СОШ №101' }]);
  } });
  assert.deepEqual(await api.listSchools(), [{ id: 'school-101', name: 'СОШ №101' }]);
  assert.equal(calls[0], 'http://localhost:3001/api/schools');
});

test('статус критерия переключается отдельным запросом, удаление остаётся доступно', async () => {
  const calls = [];
  const api = createApi({ storage: storage(), fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return response(200, { id: 'criterion-1', active: false });
  } });

  await api.updateCriterionStatus('criterion-1', false);
  await api.deleteCriterion('criterion-1');

  assert.equal(calls[0].url, 'http://localhost:3001/api/criteria/criterion-1/status');
  assert.equal(calls[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].options.body), { active: false });
  assert.equal(calls[1].url, 'http://localhost:3001/api/criteria/criterion-1');
  assert.equal(calls[1].options.method, 'DELETE');
});
