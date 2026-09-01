import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyCameraError } from './camera.ts';

test('reports browsers without camera APIs as unsupported', () => {
  assert.equal(classifyCameraError(null, false), 'unsupported');
  assert.equal(classifyCameraError({ name: 'NotFoundError' }, true), 'unsupported');
});

test('distinguishes permission denial from a busy camera', () => {
  assert.equal(classifyCameraError({ name: 'NotAllowedError' }, true), 'denied');
  assert.equal(classifyCameraError({ name: 'NotReadableError' }, true), 'busy');
});

test('keeps unrecognized camera failures separate', () => {
  assert.equal(classifyCameraError(new Error('unrecognized'), true), 'unknown');
});
