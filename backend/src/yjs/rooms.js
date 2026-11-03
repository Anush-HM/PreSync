// Who is connected to each live room, so access changes can reach them.
// Kept apart from server.js so controllers can use it without loading
// the whole Yjs layer.
const socketsByRoom = new Map(); // room key -> Set of { ws, userId }

// Close code telling a client its access changed; it reloads to pick up
// what it may now do.
export const ACCESS_CHANGED = 4005;

export function joinRoom(roomKey, ws, userId) {
  const member = { ws, userId };
  if (!socketsByRoom.has(roomKey)) socketsByRoom.set(roomKey, new Set());
  socketsByRoom.get(roomKey).add(member);
  return () => {
    const members = socketsByRoom.get(roomKey);
    members?.delete(member);
    if (members && !members.size) socketsByRoom.delete(roomKey);
  };
}

// Closes one person's live connections to a Word document after the
// owner changes or removes their access.
export function disconnectFromDocument(documentId, userId) {
  for (const entry of socketsByRoom.get(`document:${documentId}`) || []) {
    if (entry.userId === userId) entry.ws.close(ACCESS_CHANGED, 'Access changed');
  }
}
