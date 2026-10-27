import { isConfigured } from '../config.js';
import { createAnthropicProvider } from './anthropic.js';

let override = null;

// Tests swap in a fake provider; production builds one from the config.
export function setProviderOverride(provider) {
  override = provider;
}

export function getProvider(config) {
  if (override) return override;
  if (!isConfigured(config)) return null;
  if (config.provider === 'anthropic') return createAnthropicProvider(config);
  return null;
}
