import jwt from 'jsonwebtoken';

// Gatekeeper for every editor-facing route. Viewers never hit this —
// their join-by-code flow is deliberately unauthenticated (see
// routes/roomRoutes.js), which is what keeps the two access paths
// structurally separate rather than just permission-flagged.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = header.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}