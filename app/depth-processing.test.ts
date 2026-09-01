import assert from 'node:assert/strict';
import test from 'node:test';
import { downsampleDepth, normalizeNearDepth } from './depth-processing.ts';

test('normalizes only the nearest part of a relative depth map', () => {
  const result = normalizeNearDepth(new Float32Array([0, 1, 2, 3, 8, 10]), {
    lowPercentile: 0,
    highPercentile: 1,
    nearThreshold: 0.5,
  });

  assert.deepEqual(Array.from(result), [0, 0, 0, 0, 165, 255]);
});

test('keeps a flat depth map flush instead of raising every pin', () => {
  const result = normalizeNearDepth(new Float32Array([4, 4, 4, 4]));

  assert.deepEqual(Array.from(result), [0, 0, 0, 0]);
});

test('keeps mid-near facial planes in the default relief range', () => {
  const result = normalizeNearDepth(new Float32Array([0, 2, 4, 5, 6, 7, 8, 9, 10]));

  assert.ok(result[4] > 0);
  assert.ok(result[8] > result[4]);
});

test('ignores invalid predictions while computing robust bounds', () => {
  const result = normalizeNearDepth(new Float32Array([Number.NaN, -1, 0, 5, 10]), {
    lowPercentile: 0,
    highPercentile: 1,
    nearThreshold: 0.5,
  });

  assert.deepEqual(Array.from(result), [0, 0, 0, 6, 255]);
});

test('downsamples dense model output to the physical pin grid', () => {
  const result = downsampleDepth(new Float32Array([
    1, 3, 5, 7,
    3, 5, 7, 9,
    9, 11, 13, 15,
    11, 13, 15, 17,
  ]), 4, 4, 2, 2);

  assert.deepEqual(Array.from(result), [3.5, 7.5, 11.5, 15.5]);
});

test('preserves a restrained local depth peak while downsampling', () => {
  const result = downsampleDepth(new Float32Array([
    10, 10, 10, 10,
    10, 18, 10, 10,
    10, 10, 10, 10,
    10, 10, 10, 10,
  ]), 4, 4, 2, 2);

  assert.equal(result[0], 13.5);
  assert.deepEqual(Array.from(result.slice(1)), [10, 10, 10]);
});
