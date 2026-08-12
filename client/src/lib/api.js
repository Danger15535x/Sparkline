const TOKEN_KEY = 'spk.token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* private mode */ }
}

export function clearToken() {
  setToken(null);
}

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function api(path, { method = 'GET', body, headers = {}, auth = true, raw } = {}) {
  const h = { ...headers };
  if (body !== undefined && !(body instanceof FormData)) h['content-type'] = 'application/json';
  if (auth) {
    const token = getToken();
    if (token) h.authorization = `Bearer ${token}`;
  }
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: h,
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Unable to connect right now. Please try again.', 'network', 0);
  }
  if (raw) return res;
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok || !json?.ok) {
    const err = json?.error;
    if (res.status === 401 && auth) {
      const t = getToken();
      if (t && !path.startsWith('/onboard')) {
        // session expired
        clearToken();
        window.dispatchEvent(new CustomEvent('spk:logged-out'));
      }
    }
    throw new ApiError(err?.message || 'Something went wrong. Please try again.', err?.code || 'error', res.status);
  }
  return json.data;
}

// Upload with progress via XMLHttpRequest
export function uploadFile(path, formData, { auth = true, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    const token = getToken();
    if (auth && token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      const data = xhr.response;
      if (xhr.status >= 200 && xhr.status < 300 && data?.ok) resolve(data.data);
      else reject(new ApiError(data?.error?.message || 'Upload failed. Try again.', data?.error?.code, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('Upload failed. Try again.', 'network', 0));
    xhr.send(formData);
  });
}

export function mediaUrl(url) {
  if (!url) return url;
  return url; // same-origin; session cookie covers authorization
}