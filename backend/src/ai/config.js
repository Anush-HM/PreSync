// Copilot configuration, read from the environment on every call so
// tests (and a restarted dev server) pick up changes without a reload.
// Nothing here is ever sent to the browser except through publicStatus.

export const DEFAULT_MODEL = 'claude-opus-5-5';
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

function int(value, fallback, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function getAiConfig(env = process.env) {
  const provider = (env.AI_PROVIDER || 'anthropic').trim().toLowerCase();
  const apiKey = (env.ANTHROPIC_API_KEY || '').trim();
  const effort = (env.AI_EFFORT || 'medium').trim().toLowerCase();
  return {
    provider,
    apiKey,
    model: (env.AI_MODEL || DEFAULT_MODEL).trim(),
    effort: EFFORTS.includes(effort) ? effort : 'medium',
    maxOutputTokens: int(env.AI_MAX_OUTPUT_TOKENS, 8000, 1000, 32000),
    // Server-side refusal fallback ("default" lets the API pick the
    // fallback model). "off" sends plain requests.
    refusalFallback: (env.AI_REFUSAL_FALLBACK || 'default').trim().toLowerCase() !== 'off',
    rateLimitPerMinute: int(env.AI_RATE_LIMIT_PER_MINUTE, 10, 1, 600),
    // Copilot can be switched off entirely, even with a key present.
    enabled: (env.AI_COPILOT_ENABLED || 'true').trim().toLowerCase() !== 'false',
    storeHistory: (env.AI_STORE_HISTORY || 'true').trim().toLowerCase() !== 'false'
  };
}

export const SUPPORTED_PROVIDERS = {
  anthropic: { label: 'Anthropic', needs: 'ANTHROPIC_API_KEY' }
};

export function isConfigured(config) {
  if (!config.enabled) return false;
  if (config.provider === 'anthropic') return !!config.apiKey;
  return false;
}

// What the editor may know: whether Copilot works, who processes the
// data (for the disclosure), and how to enable it. Never the key.
export function publicStatus(config) {
  const known = SUPPORTED_PROVIDERS[config.provider];
  let setup = null;
  if (!config.enabled) setup = 'AI Copilot is turned off on this server (AI_COPILOT_ENABLED=false).';
  else if (!known) setup = `AI_PROVIDER "${config.provider}" is not supported. Use one of: ${Object.keys(SUPPORTED_PROVIDERS).join(', ')}.`;
  else if (!isConfigured(config)) setup = `Set ${known.needs} in backend/.env and restart the backend to enable AI Copilot.`;
  return {
    configured: isConfigured(config),
    provider: known ? known.label : config.provider,
    model: config.model,
    storesHistory: config.storeHistory,
    setup
  };
}
