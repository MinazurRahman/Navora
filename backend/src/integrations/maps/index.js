import { PLANNING_CONFIG } from '../../config/planning.js';
import { CACHE_TTL } from '../../config/cache.js';
import { createMapService } from './mapService.js';
import { createEstimateProvider } from './providers/estimate.js';
import { createOpenRouteServiceProvider } from './providers/openRouteService.js';

export { createMapService } from './mapService.js';
export { createEstimateProvider } from './providers/estimate.js';
export { MAP_ERROR, MapProviderError } from './errors.js';

// Picks the provider from configuration. Adding a provider = one adapter file + one case.
export function createMapServiceFromConfig(config, { cache }) {
  const estimate = createEstimateProvider(PLANNING_CONFIG);
  const provider =
    config.maps.provider === 'openrouteservice'
      ? createOpenRouteServiceProvider({ apiKey: config.maps.apiKey, timeoutMs: config.maps.timeoutMs })
      : estimate;

  return createMapService({
    provider,
    fallback: estimate,
    cache,
    ttlSeconds: CACHE_TTL.routing,
    fallbackToEstimate: config.maps.fallbackToEstimate,
  });
}
