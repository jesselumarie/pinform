import assert from 'node:assert/strict';
import test from 'node:test';
import { depthEngineForAttempt, depthEngineOrder, summarizeDepthError } from './depth-backend.ts';

test('runs Depth Anything 3 on WebGPU and keeps V2 Small as the lighter fallbacks', () => {
  assert.deepEqual(depthEngineOrder(true), [
    { backend: 'webgpu', model: 'da3' },
    { backend: 'webgpu', model: 'v2' },
    { backend: 'wasm', model: 'v2' },
  ]);
});

test('uses V2 Small on the CPU backend when WebGPU is unavailable', () => {
  assert.deepEqual(depthEngineOrder(false), [{ backend: 'wasm', model: 'v2' }]);
});

test('moves a failed attempt to the next engine and stops after the last one', () => {
  assert.deepEqual(depthEngineForAttempt(true, 1), { backend: 'webgpu', model: 'v2' });
  assert.deepEqual(depthEngineForAttempt(true, 2), { backend: 'wasm', model: 'v2' });
  assert.equal(depthEngineForAttempt(true, 3), null);
  assert.equal(depthEngineForAttempt(false, 1), null);
});

test('turns opaque runtime failures into a useful persistent status', () => {
  assert.equal(summarizeDepthError('TypeError: Failed to fetch'), 'MODEL DOWNLOAD BLOCKED');
  assert.equal(summarizeDepthError('failed to call OrtRun()'), 'DEPTH INFERENCE FAILED');
  assert.equal(summarizeDepthError('mysterious failure'), 'MYSTERIOUS FAILURE');
});
