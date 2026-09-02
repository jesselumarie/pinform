export type DepthBackend = 'webgpu' | 'wasm';
export type DepthModel = 'da3' | 'v2';

export interface DepthEngine {
  backend: DepthBackend;
  model: DepthModel;
}

/**
 * Depth Anything 3 Small resolves real facial geometry (nose, lips, brow) but
 * only ships fp32 weights, so it runs on WebGPU. Depth Anything V2 Small is the
 * lighter fallback: on WebGPU if DA3 fails there, and on WASM everywhere else.
 */
export function depthEngineOrder(hasWebGPU: boolean): DepthEngine[] {
  const compatibility: DepthEngine = { backend: 'wasm', model: 'v2' };
  if (!hasWebGPU) return [compatibility];
  return [{ backend: 'webgpu', model: 'da3' }, { backend: 'webgpu', model: 'v2' }, compatibility];
}

export function depthEngineForAttempt(hasWebGPU: boolean, attempt: number): DepthEngine | null {
  return depthEngineOrder(hasWebGPU)[attempt] ?? null;
}

export function summarizeDepthError(message: string) {
  if (/failed to fetch|networkerror|load failed/i.test(message)) return 'MODEL DOWNLOAD BLOCKED';
  if (/ortrun|inference|tensor|predicted_depth/i.test(message)) return 'DEPTH INFERENCE FAILED';
  if (/out of memory|allocation failed/i.test(message)) return 'NOT ENOUGH BROWSER MEMORY';
  return message.replace(/^\w*error:\s*/i, '').trim().slice(0, 96).toUpperCase() || 'DEPTH ENGINE FAILED';
}
