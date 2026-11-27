export async function api(method, url, body) {
  const headers = { 'X-Requested-With': 'SecureOps' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  } catch {
    throw new Error('Cannot reach the server. Check your connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event('auth-lost'));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const qs = q => {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
export { qs };

export const R = {
  list: (r, q) => api('GET', `/api/r/${r}${qs(q)}`),
  get: (r, id) => api('GET', `/api/r/${r}/${id}`),
  create: (r, data) => api('POST', `/api/r/${r}`, data),
  update: (r, id, data) => api('PUT', `/api/r/${r}/${id}`, data),
  del: (r, id) => api('DELETE', `/api/r/${r}/${id}`),
};
export const GET = (url, q) => api('GET', url + qs(q));
export const POST = (url, body = {}) => api('POST', url, body);
export const PUT = (url, body = {}) => api('PUT', url, body);
