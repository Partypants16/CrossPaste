export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function errorFromResponse(status, body) {
  const error = body?.error || {};
  return new ApiError(error.message || 'The server returned an error.', {
    status,
    code: error.code || 'UNKNOWN_ERROR',
    details: error,
  });
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
    throw errorFromResponse(response.status, body);
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

/**
 * Uploads one shared file. Uses XMLHttpRequest rather than fetch because fetch cannot
 * report upload progress. `onProgress({ loaded, total })` fires as bytes are sent
 * (`total` is null if the browser can't tell), `onSent()` once the whole body is sent
 * and the server is saving it, and aborting `signal` cancels the upload.
 */
export function uploadFile(file, { onProgress, onSent, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files');

    xhr.upload.addEventListener('progress', (event) => {
      onProgress?.({ loaded: event.loaded, total: event.lengthComputable ? event.total : null });
    });
    xhr.upload.addEventListener('load', () => onSent?.());

    xhr.addEventListener('load', () => {
      let body = null;
      if ((xhr.getResponseHeader('content-type') || '').includes('application/json')) {
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          body = null;
        }
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(errorFromResponse(xhr.status, body));
    });
    xhr.addEventListener('error', () => reject(new ApiError('Could not reach the server.', { code: 'NETWORK_ERROR' })));
    xhr.addEventListener('abort', () => reject(new ApiError('Upload cancelled.', { code: 'UPLOAD_CANCELLED' })));
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });

    const formData = new FormData();
    formData.append('file', file, file.name || 'upload');
    xhr.send(formData);
  });
}

export function deleteFileRequest(id) {
  return request(`/api/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function fileDownloadUrl(id) {
  return `/api/files/${encodeURIComponent(id)}/download`;
}
