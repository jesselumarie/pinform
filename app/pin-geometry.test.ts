import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_PIN_TRAVEL,
  MIN_PIN_TRAVEL,
  IMPRINT_SCALE,
  PIN_LENGTH,
  anchoredPinOffset,
  clampPinTravel,
  mapImprintCoordinate,
} from './pin-geometry.ts';

test('clamps relief to a physical pin travel range', () => {
  assert.equal(clampPinTravel(99), MAX_PIN_TRAVEL);
  assert.equal(clampPinTravel(-99), MIN_PIN_TRAVEL);
  assert.ok(MAX_PIN_TRAVEL <= 1.2);
});

test('maps the camera across the complete pin field', () => {
  assert.equal(IMPRINT_SCALE, 1);
  assert.equal(mapImprintCoordinate(0), 0);
  assert.equal(mapImprintCoordinate(0.5), 0.5);
  assert.equal(mapImprintCoordinate(1), 1);
});

test('keeps the back of each pin anchored while extending its face', () => {
  const back = -PIN_LENGTH / 2;
  const front = PIN_LENGTH / 2;

  assert.equal(anchoredPinOffset(back, MAX_PIN_TRAVEL), 0);
  assert.equal(anchoredPinOffset(front, MAX_PIN_TRAVEL), MAX_PIN_TRAVEL);
  assert.equal(anchoredPinOffset(front, 99), MAX_PIN_TRAVEL);
});
