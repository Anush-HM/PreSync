// Express 4 doesn't forward rejected promises from async route handlers
// to the error middleware on its own. Wrapping each handler here means
// every controller can just `await` and throw/reject normally.
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}