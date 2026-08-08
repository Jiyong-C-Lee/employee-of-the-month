import type { ChainRequest, ProviderAdapter } from './types.js';

export function selectProviders(req: ChainRequest, adapters: ProviderAdapter[]): ProviderAdapter[] {
  const needsTools = 'tools' in req && !!req.tools?.length;
  return needsTools ? adapters.filter(a => a.caps.tools) : adapters;
}
