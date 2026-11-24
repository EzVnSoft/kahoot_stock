async function request(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw Object.assign(new Error('network'), { status: 0 });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'error'), { status: res.status, data });
  return data;
}

export const api = {
  info: () => request('GET', '/api/info'),
  start: () => request('POST', '/api/sessions'),
  resume: (id) => request('GET', `/api/sessions/${id}`),
  answer: (id, selected) => request('POST', `/api/sessions/${id}/answer`, { selected }),
  next: (id) => request('POST', `/api/sessions/${id}/next`),
  finish: (id) => request('POST', `/api/sessions/${id}/finish`),
  reset: (id) => request('POST', `/api/sessions/${id}/reset`),
};
