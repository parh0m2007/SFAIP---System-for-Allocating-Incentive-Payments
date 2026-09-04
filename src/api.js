/* Thin fetch client for the educational-system REST API. */

const DEFAULT_BASE_URL = 'http://localhost:3001';
const ACCESS_TOKEN_KEY = 'accessToken';
const REFRESH_TOKEN_KEY = 'refreshToken';

export class ApiError extends Error {
  constructor(message, { code = 'HTTP_ERROR', details, status } = {}) {
    super(message || 'Request failed');
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function defaultStorage() {
  try {
    return globalThis.localStorage || memoryStorage();
  } catch {
    return memoryStorage();
  }
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

async function parseError(response) {
  let payload;
  const contentType = response.headers?.get?.('content-type') || '';
  try {
    if (contentType.includes('json')) payload = await response.json();
    else {
      const text = await response.text();
      try { payload = JSON.parse(text); } catch { payload = text; }
    }
  } catch {
    try { payload = await response.json(); } catch { payload = undefined; }
  }
  if (payload && typeof payload === 'object') {
    return new ApiError(payload.message || `Request failed (${response.status})`, {
      code: payload.code || 'HTTP_ERROR', details: payload.details, status: response.status,
    });
  }
  return new ApiError(typeof payload === 'string' && payload ? payload : `Request failed (${response.status})`, {
    code: 'HTTP_ERROR', status: response.status,
  });
}

function bodyIsJson(body) {
  const FormDataCtor = globalThis.FormData;
  const BlobCtor = globalThis.Blob;
  const ArrayBufferCtor = globalThis.ArrayBuffer;
  return body !== undefined && body !== null && typeof body === 'object'
    && !(FormDataCtor && body instanceof FormDataCtor)
    && !(BlobCtor && body instanceof BlobCtor)
    && !(ArrayBufferCtor && body instanceof ArrayBufferCtor);
}

export function createApi({ baseUrl, fetchImpl, storage } = {}) {
  const requestFetch = fetchImpl || globalThis.fetch?.bind(globalThis);
  if (!requestFetch) throw new Error('fetch is not available');
  const tokenStorage = storage || defaultStorage();
  const root = normalizeBaseUrl(baseUrl || globalThis.API_BASE_URL);

  const getAccessToken = () => tokenStorage.getItem(ACCESS_TOKEN_KEY);
  const getRefreshToken = () => tokenStorage.getItem(REFRESH_TOKEN_KEY);
  const clearTokens = () => {
    tokenStorage.removeItem(ACCESS_TOKEN_KEY);
    tokenStorage.removeItem(REFRESH_TOKEN_KEY);
  };
  const storeTokens = (tokens) => {
    if (tokens?.accessToken) tokenStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
    if (tokens?.refreshToken) tokenStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
    return tokens;
  };

  async function request(path, { method = 'GET', body, headers = {}, responseType = 'json', auth = true, retry = true } = {}) {
    // Keep headers as a plain object: fetch accepts it, and it remains easy to inspect in tests/callers.
    const requestHeaders = {};
    if (typeof Headers !== 'undefined' && headers instanceof Headers) headers.forEach((value, key) => { requestHeaders[key] = value; });
    else Object.assign(requestHeaders, headers || {});
    const setHeader = (name, value) => {
      const existing = Object.keys(requestHeaders).find((key) => key.toLowerCase() === name.toLowerCase());
      requestHeaders[existing || name] = value;
    };
    if (auth) {
      const accessToken = getAccessToken();
      if (accessToken) setHeader('Authorization', `Bearer ${accessToken}`);
    }
    let requestBody = body;
    if (bodyIsJson(body)) {
      setHeader('Content-Type', 'application/json');
      requestBody = JSON.stringify(body);
    }
    const response = await requestFetch(`${root}${path}`, { method, headers: requestHeaders, body: requestBody });
    if (response.status === 401 && auth && retry && path !== '/api/auth/refresh' && getRefreshToken()) {
      try {
        const tokens = await request('/api/auth/refresh', { method: 'POST', body: { refreshToken: getRefreshToken() }, auth: false, retry: false });
        storeTokens(tokens);
        return request(path, { method, body, headers, responseType, auth, retry: false });
      } catch {
        clearTokens();
        throw await parseError(response);
      }
    }
    if (!response.ok) throw await parseError(response);
    if (response.status === 204 || responseType === 'void') return null;
    if (responseType === 'blob') return response.blob();
    if (responseType === 'text') return response.text();
    const contentType = response.headers?.get?.('content-type') || '';
    if (contentType.includes('json')) return response.json();
    try {
      const text = await response.text();
      if (!text) return null;
      try { return JSON.parse(text); } catch { return text; }
    } catch {
      // Lightweight fetch mocks sometimes expose only json(); support those too.
      return response.json();
    }
  }

  async function authenticate(path, data) {
    const result = await request(path, { method: 'POST', body: data, auth: false });
    return storeTokens(result);
  }

  const client = {
    request,
    getAccessToken,
    getRefreshToken,
    clearTokens,
    register: (data) => authenticate('/api/auth/register', data),
    login: (data) => authenticate('/api/auth/login', data),
    listSchools: () => request('/api/schools', { auth: false }),
    refresh: async (refreshToken = getRefreshToken()) => {
      try {
        const result = await request('/api/auth/refresh', { method: 'POST', body: { refreshToken }, auth: false, retry: false });
        return storeTokens(result);
      } catch (error) {
        clearTokens();
        throw error;
      }
    },
    logout: async () => {
      try {
        if (getAccessToken()) return await request('/api/auth/logout', { method: 'POST' });
        return null;
      } finally {
        clearTokens();
      }
    },
    getProfile: () => request('/api/profile'),
    updateProfile: (data) => request('/api/profile', { method: 'PATCH', body: data }),
    listCriteria: () => request('/api/criteria'),
    listUsers: () => request('/api/users'),
    createCriterion: (data) => request('/api/criteria', { method: 'POST', body: data }),
    updateCriterion: (id, data) => request(`/api/criteria/${encodeURIComponent(id)}`, { method: 'PATCH', body: data }),
    updateCriterionStatus: (id, active) => request(`/api/criteria/${encodeURIComponent(id)}/status`, { method: 'PATCH', body: { active: Boolean(active) } }),
    deleteCriterion: (id) => request(`/api/criteria/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    listApplications: () => request('/api/applications'),
    createApplication: (data) => request('/api/applications', { method: 'POST', body: data }),
    getApplication: (id) => request(`/api/applications/${encodeURIComponent(id)}`),
    updateApplication: (id, data) => request(`/api/applications/${encodeURIComponent(id)}`, { method: 'PATCH', body: data }),
    submitApplication: (id) => request(`/api/applications/${encodeURIComponent(id)}/submit`, { method: 'POST' }),
    listReviews: () => request('/api/reviews'),
    approveReview: (id) => request(`/api/reviews/${encodeURIComponent(id)}/approve`, { method: 'POST' }),
    rejectReview: (id, comment) => request(`/api/reviews/${encodeURIComponent(id)}/reject`, { method: 'POST', body: typeof comment === 'string' ? { comment } : comment }),
    listNotifications: () => request('/api/notifications'),
    markNotificationRead: (id) => request(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }),
    uploadFile: (fileOrOptions, applicationId, itemId) => {
      const options = fileOrOptions && typeof fileOrOptions === 'object' && 'file' in fileOrOptions
        ? fileOrOptions : { file: fileOrOptions, applicationId, itemId };
      const form = new FormData();
      form.append('file', options.file, options.file?.name || 'upload');
      if (options.applicationId != null) form.append('applicationId', options.applicationId);
      if (options.itemId != null) form.append('itemId', options.itemId);
      return request('/api/files', { method: 'POST', body: form });
    },
    downloadFile: (id) => request(`/api/files/${encodeURIComponent(id)}`, { responseType: 'blob' }),
    exportReport: (periodId) => request(`/api/reports/${encodeURIComponent(periodId)}/export.xlsx`, { responseType: 'blob' }),
  };

  // Namespaced aliases make the client convenient for both existing UI code and consumers that group resources.
  client.auth = { register: client.register, login: client.login, refresh: client.refresh, logout: client.logout };
  client.schools = { list: client.listSchools };
  client.profile = { get: client.getProfile, update: client.updateProfile };
  client.criteria = { list: client.listCriteria, create: client.createCriterion, update: client.updateCriterion, updateStatus: client.updateCriterionStatus, delete: client.deleteCriterion };
  client.users = { list: client.listUsers };
  client.getCriteria = client.listCriteria;
  client.applications = { list: client.listApplications, create: client.createApplication, get: client.getApplication, update: client.updateApplication, submit: client.submitApplication };
  client.getApplications = client.listApplications;
  client.reviews = { list: client.listReviews, approve: client.approveReview, reject: client.rejectReview };
  client.notifications = { list: client.listNotifications, markRead: client.markNotificationRead };
  client.files = { upload: client.uploadFile, download: client.downloadFile };
  client.reports = { export: client.exportReport };
  client.review = client.reviews;
  client.getReviews = client.listReviews;
  client.approveApplication = client.approveReview;
  client.rejectApplication = client.rejectReview;
  client.uploadEvidence = client.uploadFile;
  client.exportXlsx = client.exportReport;
  client.markRead = client.markNotificationRead;
  client.getNotifications = client.listNotifications;
  return client;
}

export const api = createApi();
export default api;

export const { register, login, refresh, logout, getProfile, updateProfile, listCriteria, createCriterion, updateCriterion, updateCriterionStatus, deleteCriterion,
  listSchools,
  listUsers,
  listApplications, createApplication, getApplication, updateApplication, submitApplication, listReviews, approveReview, rejectReview,
  listNotifications, markNotificationRead, uploadFile, downloadFile, exportReport } = api;
