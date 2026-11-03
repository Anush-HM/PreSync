// Who may do what with a Word document. The owner manages sharing and
// can delete it; editors (collaboratorIds) change it; viewers (viewerIds)
// read it, follow live edits, read comments and download it.
const idOf = (ref) => (ref && typeof ref === 'object' && ref._id ? ref._id : ref)?.toString();

export function roleOf(doc, userId) {
  if (!doc || !userId) return null;
  if (idOf(doc.ownerId) === userId) return 'owner';
  if ((doc.collaboratorIds || []).some((id) => idOf(id) === userId)) return 'editor';
  if ((doc.viewerIds || []).some((id) => idOf(id) === userId)) return 'viewer';
  return null;
}

export const canEdit = (role) => role === 'owner' || role === 'editor';
