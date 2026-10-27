import Anthropic from '@anthropic-ai/sdk';
import { AiError } from '../errors.js';

const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// Pulls the first JSON object out of a model's text, in case a model
// without structured-output support wraps it in prose or a code fence.
export function parseJsonReply(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
  }
  throw new AiError('BAD_MODEL_OUTPUT', 502, 'The AI returned a reply PreSync could not read. Try again.');
}

// Maps SDK errors onto stable codes. Messages are written here rather
// than passed through, so a provider error never echoes request content.
export function mapProviderError(err) {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.RateLimitError) {
    const retryAfter = Number.parseInt(err.headers?.get?.('retry-after') ?? '', 10);
    return new AiError('PROVIDER_RATE_LIMITED', 429, 'The AI provider is rate limiting requests right now. Wait a moment and try again.', {
      retryAfter: Number.isFinite(retryAfter) ? retryAfter : 30
    });
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AiError('PROVIDER_AUTH', 502, 'The AI provider rejected the configured API key. Check ANTHROPIC_API_KEY on the server.');
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AiError('PROVIDER_UNAVAILABLE', 503, 'Could not reach the AI provider. Check the server’s network connection and try again.');
  }
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError) {
    return new AiError('PROVIDER_REJECTED', 502, 'The AI provider rejected the request. Check AI_MODEL on the server.');
  }
  if (err instanceof Anthropic.APIError) {
    return new AiError('PROVIDER_UNAVAILABLE', 503, 'The AI provider is unavailable right now. Try again shortly.');
  }
  return new AiError('PROVIDER_ERROR', 502, 'The AI request failed. Try again.');
}

// Anthropic adapter. The rest of the Copilot only sees generateJson(),
// so another vendor can be added as a sibling file without touching the
// editor or the routes.
export function createAnthropicProvider({ apiKey, model, effort, maxOutputTokens, refusalFallback, client }) {
  const api = client || new Anthropic({ apiKey, maxRetries: 1, timeout: 90_000 });

  async function generateJson({ system, messages, schema }) {
    const params = {
      model,
      max_tokens: maxOutputTokens,
      system,
      messages,
      thinking: { type: 'adaptive' },
      output_config: { effort, format: { type: 'json_schema', schema } }
    };
    let response;
    try {
      response = refusalFallback
        ? await api.beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' })
        : await api.messages.create(params);
    } catch (err) {
      throw mapProviderError(err);
    }

    if (response.stop_reason === 'refusal') {
      throw new AiError('REFUSED', 422, 'The AI declined this request. Try rephrasing it.');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new AiError('TRUNCATED', 502, 'The AI reply was too long and got cut off. Ask for something shorter, such as fewer slides.');
    }
    const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (!text.trim()) throw new AiError('BAD_MODEL_OUTPUT', 502, 'The AI returned an empty reply. Try again.');
    return { json: parseJsonReply(text), model: response.model || model };
  }

  return { name: 'anthropic', model, generateJson };
}
