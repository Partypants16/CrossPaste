export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { ...(options.headers || {}) },
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError('Could not reach the server.', { code: 'NETWORK_ERROR' });
  }

  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const error = body?.error || {};
    throw new ApiError(error.message || 'The server returned an error.', {
      status: response.status,
      code: error.code || 'UNKNOWN_ERROR',
      details: error,
    });
  }

  return body;
}

function jsonBody(payload) {
  return {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

export function fetchState() {
  return request('/api/state');
}

export function saveClipboard(html, baseRevision) {
  return request('/api/clipboard', { ...jsonBody({ html, baseRevision }), method: 'PUT' });
}

export function forceSaveClipboard(html) {
  return request('/api/clipboard/force', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ html }),
  });
}

export function clearClipboard() {
  return request('/api/clipboard/clear', { method: 'POST' });
}

export function fetchImages() {
  return request('/api/images');
}

export async function uploadImage(file) {
  const formData = new FormData();
  formData.append('image', file, file.name || 'upload');
  return request('/api/images', { method: 'POST', body: formData });
}

export function deleteImageRequest(id) {
  return request(`/api/images/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function imageFileUrl(id) {
  return `/api/images/${encodeURIComponent(id)}/file`;
}

export function imageThumbnailUrl(id) {
  return `/api/images/${encodeURIComponent(id)}/thumbnail`;
}

export function imageDownloadUrl(id) {
  return `/api/images/${encodeURIComponent(id)}/download`;
}

export function fetchFiles() {
  return request('/api/files');
}

export async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file, file.name || 'upload');
  return request('/api/files', { method: 'POST', body: formData });
}

export function deleteFileRequest(id) {
  return request(`/api/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function fileDownloadUrl(id) {
  return `/api/files/${encodeURIComponent(id)}/download`;
}
