import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDragRotation, settleRotation } from './rotation.ts';

test('drag rotation maps pointer movement to yaw and pitch', () => {
  const result = applyDragRotation({ x: 0, y: 0 }, 80, -40);

  assert.equal(result.y, 0.32);
  assert.equal(result.x, -0.16);
});

test('drag rotation clamps pitch and yaw to useful viewing angles', () => {
  const result = applyDragRotation({ x: 0, y: 0 }, 1000, -1000);

  assert.equal(result.y, 0.82);
  assert.equal(result.x, -0.58);
});

test('settle rotation eases toward the target without overshooting', () => {
  const result = settleRotation({ x: 0, y: 0 }, { x: 0.4, y: -0.5 }, 0.2);

  assert.ok(Math.abs(result.x - 0.08) < Number.EPSILON * 2);
  assert.equal(result.y, -0.1);
});
