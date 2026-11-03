import { API_BASE, apiFetch, getAuthToken } from './apiConfig.js';
import { uploadImport } from './importsApi.js';

// Word documents, independent of presentations.
export const listDocuments = () => apiFetch('/api/documents');
export const getDocument = (id) => apiFetch(`/api/documents/${id}`);
export const deleteDocument = (id) => apiFetch(`/api/documents/${id}`, { method: 'DELETE' });

export function createDocument({ title, pageSize } = {}) {
  return apiFetch('/api/documents', { method: 'POST', body: JSON.stringify({ title, pageSize }) });
}

// patch: any of { title, content, page, layout }. Only used when the
// live co-editing connection is unavailable.
export function updateDocument(id, patch) {
  return apiFetch(`/api/documents/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
}

// Writes the live copy now and keeps an automatic version now and then.
export const saveDocument = (id) => apiFetch(`/api/documents/${id}/save`, { method: 'POST' });

// Sharing: { owner, people: [{ id, name, email, role: 'editor' | 'viewer' }] }.
export const shareDocument = (id, email, role) =>
  apiFetch(`/api/documents/${id}/share`, { method: 'POST', body: JSON.stringify({ email, role }) });
export const updateDocumentShare = (id, userId, role) =>
  apiFetch(`/api/documents/${id}/share/${userId}`, { method: 'PATCH', body: JSON.stringify({ role }) });
export const removeDocumentShare = (id, userId) => apiFetch(`/api/documents/${id}/share/${userId}`, { method: 'DELETE' });

// Comment threads: [{ id, quote, text, author, createdAt, resolved, replies }].
export const listDocumentComments = (id) => apiFetch(`/api/documents/${id}/comments`);
export const addDocumentComment = (id, { text, quote }) =>
  apiFetch(`/api/documents/${id}/comments`, { method: 'POST', body: JSON.stringify({ text, quote }) });
export const replyToDocumentComment = (id, commentId, text) =>
  apiFetch(`/api/documents/${id}/comments/${commentId}/replies`, { method: 'POST', body: JSON.stringify({ text }) });
export const updateDocumentComment = (id, commentId, patch) =>
  apiFetch(`/api/documents/${id}/comments/${commentId}`, { method: 'PATCH', body: JSON.stringify(patch) });
export const deleteDocumentComment = (id, commentId) => apiFetch(`/api/documents/${id}/comments/${commentId}`, { method: 'DELETE' });

// Version history: [{ id, label, kind, title, wordCount, createdAt, author }].
export const listDocumentVersions = (id) => apiFetch(`/api/documents/${id}/versions`);
export const getDocumentVersion = (id, versionId) => apiFetch(`/api/documents/${id}/versions/${versionId}`);
export const saveDocumentVersion = (id, label = '') =>
  apiFetch(`/api/documents/${id}/versions`, { method: 'POST', body: JSON.stringify({ label }) });
export const restoreDocumentVersion = (id, versionId) =>
  apiFetch(`/api/documents/${id}/versions/${versionId}/restore`, { method: 'POST' });

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
