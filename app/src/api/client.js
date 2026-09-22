const TIMEOUT_MS = 6000;

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

/** Small REST client for the Raspberry Pi FocusPi API. */
export function createApi({ serverUrl, apiKey }) {
  const base = (serverUrl || '').trim().replace(/\/+$/, '');

  async function request(path, { method = 'GET', body } = {}) {
    if (!base) throw new ApiError('Set the Raspberry Pi server URL in Settings', 0);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response;
    try {
      response = await fetch(`${base}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'X-API-Key': apiKey.trim() } : {})
        },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      const msg = e?.name === 'AbortError' ? 'Raspberry Pi did not respond' : 'Cannot reach the Raspberry Pi';
      throw new ApiError(msg, 0);
    } finally {
      clearTimeout(timer);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiError(payload.error || `Request failed (${response.status})`, response.status, payload);
    }
    return payload;
  }

  return {
    health: () => request('/api/health'),
    status: () => request('/api/status'),
    start: (minutes, label) => request('/api/focus/start', { method: 'POST', body: { minutes, label } }),
    stop: () => request('/api/focus/stop', { method: 'POST' }),
    stats: (days = 7) => request(`/api/stats?days=${days}`),
    history: (limit = 30) => request(`/api/focus/history?limit=${limit}`)
  };
}
