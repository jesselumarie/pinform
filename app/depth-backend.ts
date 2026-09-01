export type DepthBackend = 'webgpu' | 'wasm';

export function depthBackendOrder(hasWebGPU: boolean): DepthBackend[] {
  return hasWebGPU ? ['webgpu', 'wasm'] : ['wasm'];
}

export function depthBackendForAttempt(hasWebGPU: boolean, attempt: number): DepthBackend | null {
  return depthBackendOrder(hasWebGPU)[attempt] ?? null;
}

export function summarizeDepthError(message: string) {
  if (/failed to fetch|networkerror|load failed/i.test(message)) return 'MODEL DOWNLOAD BLOCKED';
  if (/ortrun|inference|tensor|predicted_depth/i.test(message)) return 'DEPTH INFERENCE FAILED';
  if (/out of memory|allocation failed/i.test(message)) return 'NOT ENOUGH BROWSER MEMORY';
  return message.replace(/^\w*error:\s*/i, '').trim().slice(0, 96).toUpperCase() || 'DEPTH ENGINE FAILED';
}
