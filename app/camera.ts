export type CameraIssue = 'unsupported' | 'denied' | 'busy' | 'unknown';

export function classifyCameraError(error: unknown, hasCameraApi: boolean): CameraIssue {
  if (!hasCameraApi) return 'unsupported';
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (name === 'NotFoundError') return 'unsupported';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotReadableError' || name === 'AbortError') return 'busy';
  return 'unknown';
}
