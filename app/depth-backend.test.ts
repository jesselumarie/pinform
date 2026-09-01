import assert from 'node:assert/strict';
import test from 'node:test';
import { depthBackendForAttempt, depthBackendOrder, summarizeDepthError } from './depth-backend.ts';

test('prefers WebGPU and keeps a CPU compatibility fallback', () => {
  assert.deepEqual(depthBackendOrder(true), ['webgpu', 'wasm']);
});

test('uses the CPU backend when WebGPU is unavailable', () => {
  assert.deepEqual(depthBackendOrder(false), ['wasm']);
});

test('moves a failed WebGPU attempt to a fresh WASM worker', () => {
  assert.equal(depthBackendForAttempt(true, 0), 'webgpu');
  assert.equal(depthBackendForAttempt(true, 1), 'wasm');
  assert.equal(depthBackendForAttempt(true, 2), null);
});

test('does not retry WASM when it was the first available backend', () => {
  assert.equal(depthBackendForAttempt(false, 0), 'wasm');
  assert.equal(depthBackendForAttempt(false, 1), null);
});

test('turns opaque runtime failures into a useful persistent status', () => {
  assert.equal(summarizeDepthError('TypeError: Failed to fetch'), 'MODEL DOWNLOAD BLOCKED');
  assert.equal(summarizeDepthError('failed to call OrtRun()'), 'DEPTH INFERENCE FAILED');
  assert.equal(summarizeDepthError('mysterious failure'), 'MYSTERIOUS FAILURE');
});
