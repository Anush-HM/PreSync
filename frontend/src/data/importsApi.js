import { API_BASE, apiFetch, clearAuthToken, getAuthToken } from './apiConfig.js';

export const MAX_IMPORT_MB = 25;

export const IMPORT_FORMATS = {
  docx: { label: 'Word', ext: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  pptx: { label: 'PowerPoint', ext: '.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  pdf: { label: 'PDF', ext: '.pdf', mime: 'application/pdf' }
};

// Legacy formats are offered in the picker so we can explain them,
// rather than the browser silently hiding the file.
export const IMPORT_ACCEPT_ALL = ['.docx', '.pptx', '.pdf', '.doc', '.ppt', ...Object.values(IMPORT_FORMATS).map((f) => f.mime)].join(',');

// Checks a file before upload. Returns { format } or { error }.
export function validateImportFile(file) {
  const ext = (file.name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
  if (ext === 'doc') return { error: 'Legacy .doc files are not supported. Save it as .docx in Word, Pages or Google Docs, then import that.' };
  if (ext === 'ppt') return { error: 'Legacy .ppt files are not supported. Save it as .pptx in PowerPoint, Keynote or Google Slides, then import that.' };
  if (!IMPORT_FORMATS[ext]) return { error: `“${file.name}” isn’t a supported file. Import a Word (.docx), PowerPoint (.pptx) or PDF (.pdf) file.` };
  if (file.size === 0) return { error: 'This file is empty.' };
  if (file.size > MAX_IMPORT_MB * 1024 * 1024) return { error: `This file is larger than ${MAX_IMPORT_MB} MB.` };
  return { format: ext };
}

// Uploads a file for analysis with upload progress. XHR rather than
// fetch because fetch can't report upload progress.
// Returns { promise, abort }. onProgress gets 0..1; onUploaded fires
// once the bytes are sent and the server is analysing.
export function uploadImport(file, { onProgress, onUploaded, path = '/api/imports' } = {}) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    xhr.open('POST', `${API_BASE}${path}`);
    const token = getAuthToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.upload.onload = () => onUploaded?.();
    xhr.onload = () => {
      let body = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status === 401) {
        clearAuthToken();
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
        reject(new Error('Session expired. Please sign in again.'));
      } else if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body);
      } else {
        reject(new Error(body?.error || `Import failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('Could not reach the server. Check your connection and try again.'));
    xhr.onabort = () => {
      const err = new Error('Import cancelled');
      err.cancelled = true;
      reject(err);
    };
    const form = new FormData();
    form.append('file', file);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

export function listImports() {
  return apiFetch('/api/imports');
}

export function getImport(importId) {
  return apiFetch(`/api/imports/${importId}`);
}

export function saveImportOutline(importId, outline) {
  return apiFetch(`/api/imports/${importId}/outline`, { method: 'PUT', body: JSON.stringify({ outline }) });
}

// mode: 'outline' (generate from outline) | 'original' (PowerPoint/PDF slides as extracted)
export function createDeckFromImport(importId, { mode, outline, title } = {}) {
  return apiFetch(`/api/imports/${importId}/decks`, { method: 'POST', body: JSON.stringify({ mode, outline, title }) });
}

export function deleteImport(importId) {
  return apiFetch(`/api/imports/${importId}`, { method: 'DELETE' });
}
