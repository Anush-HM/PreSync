import { API_BASE, apiFetch, getAuthToken } from './apiConfig.js';
import { uploadImport } from './importsApi.js';

// Word documents, independent of presentations.
export const listDocuments = () => apiFetch('/api/documents');
export const getDocument = (id) => apiFetch(`/api/documents/${id}`);
export const deleteDocument = (id) => apiFetch(`/api/documents/${id}`, { method: 'DELETE' });

export function createDocument({ title, pageSize } = {}) {
  return apiFetch('/api/documents', { method: 'POST', body: JSON.stringify({ title, pageSize }) });
}

// patch: any of { title, content, page }.
export function updateDocument(id, patch) {
  return apiFetch(`/api/documents/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
}

// Opens a Word file imported before the editor existed.
export function createDocumentFromImport(importId) {
  return apiFetch(`/api/documents/from-import/${importId}`, { method: 'POST' });
}

// Same progress, cancel and error handling as other imports.
export function uploadDocx(file, hooks) {
  return uploadImport(file, { ...hooks, path: '/api/documents/import-docx' });
}

// Binary response, so fetch directly rather than through apiFetch.
export async function downloadDocument(id, format, title = 'document') {
  const res = await fetch(`${API_BASE}/api/documents/${id}/export/${format}`, {
    headers: { Authorization: `Bearer ${getAuthToken()}` }
  });
  if (!res.ok) {
    let message = `Export failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // not JSON — keep the generic message
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const star = /filename\*=UTF-8''([^;]+)/i.exec(res.headers.get('Content-Disposition') || '');
  const a = document.createElement('a');
  a.href = url;
  a.download = star ? decodeURIComponent(star[1]) : `${title}.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
