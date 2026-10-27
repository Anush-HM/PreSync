// Errors the Copilot routes turn into a JSON answer. `code` is stable
// for the frontend; `message` is safe to show and never contains
// document text, prompts or credentials.
export class AiError extends Error {
  constructor(code, status, message, { retryAfter } = {}) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.status = status;
    if (retryAfter) this.retryAfter = retryAfter;
  }
}

export function sendAiError(res, err) {
  if (err.retryAfter) res.set('Retry-After', String(err.retryAfter));
  return res.status(err.status).json({ error: err.message, code: err.code, ...(err.retryAfter && { retryAfter: err.retryAfter }) });
}
