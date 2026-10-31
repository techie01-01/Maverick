const TOKEN_KEY = 'brightloop.token';

/**
 * Token storage with an in-memory fallback.
 *
 * localStorage throws in a sandboxed iframe (and is disabled in some private
 * modes), so every access is guarded. When it is unavailable the session still
 * works — it just does not survive a page reload.
 */
const memoryStore = new Map();
const store = {
  get(key) {
    try { return window.localStorage.getItem(key); } catch { return memoryStore.get(key) ?? null; }
  },
  set(key, value) {
    try { window.localStorage.setItem(key, value); } catch { memoryStore.set(key, value); }
  },
  del(key) {
    try { window.localStorage.removeItem(key); } catch { memoryStore.delete(key); }
  },
};

export const getToken = () => store.get(TOKEN_KEY);
export const setToken = (t) => (t ? store.set(TOKEN_KEY, t) : store.del(TOKEN_KEY));

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

/**
 * Single fetch wrapper for the whole app.
 * - relative /api URL, so the Vite dev proxy (or the Express static server)
 *   handles it with no environment config
 * - attaches the bearer token
 * - normalises the server's { error } envelope into an exception
 */
export async function api(path, { method = 'GET', body, params, signal } = {}) {
  let url = `/api${path}`;
  if (params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') qs.append(k, v);
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the server. Is the API running on port 4000?');
  }

  if (res.status === 204) return null;

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/login')) {
      setToken(null);
      window.dispatchEvent(new CustomEvent('brightloop:unauthorised'));
    }
    throw new ApiError(res.status, data?.error || `Request failed (${res.status})`, data?.details);
  }
  return data;
}

export const get = (p, params, opts) => api(p, { params, ...opts });
export const post = (p, body, opts) => api(p, { method: 'POST', body, ...opts });
export const patch = (p, body) => api(p, { method: 'PATCH', body });
export const put = (p, body) => api(p, { method: 'PUT', body });
export const del = (p) => api(p, { method: 'DELETE' });

/** Download a CSV, honouring the bearer token. */
export async function downloadCsv(path, params) {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  const res = await fetch(`/api${path}${qs}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) throw new ApiError(res.status, 'Export failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `brightloop-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
