import assert from 'node:assert/strict';
import test from 'node:test';
import { downsampleDepth, featureRelief, foregroundThreshold, normalizeNearDepth } from './depth-processing.ts';

const ROOM = [0.2, 0.3, 0.25, 0.4, 0.3, 0.2];
const SITTER = [1.0, 1.2, 1.4, 1.6, 1.8, 2.0];

test('splits a bimodal depth map between the sitter and the room', () => {
  const threshold = foregroundThreshold(new Float32Array([...ROOM, ...SITTER]));

  assert.ok(threshold > 0.4 && threshold <= 1.0, `threshold ${threshold} should sit between room and sitter`);
});

test('maps the sitter linearly onto the full pin travel and keeps the room flush', () => {
  const result = normalizeNearDepth(new Float32Array([...ROOM, ...SITTER]), {
    floorPercentile: 0,
    peakPercentile: 1,
    plinth: 0,
  });

  assert.deepEqual(Array.from(result), [0, 0, 0, 0, 0, 0, 0, 51, 102, 153, 204, 255]);
});

test('raises the whole sitter above the room on a small plinth', () => {
  const result = normalizeNearDepth(new Float32Array([...ROOM, ...SITTER]), {
    floorPercentile: 0,
    peakPercentile: 1,
    plinth: 0.2,
  });

  assert.deepEqual(Array.from(result), [0, 0, 0, 0, 0, 0, 51, 92, 133, 173, 214, 255]);
});

test('gives a typical sitter most of the pin travel even with a far room behind them', () => {
  const values: number[] = [];
  for (let index = 0; index < 700; index += 1) values.push(0.2 + (index % 30) * 0.01); // room
  for (let index = 0; index < 100; index += 1) values.push(1.3 + (index % 20) * 0.01); // shoulders
  for (let index = 0; index < 200; index += 1) values.push(1.6 + (index % 40) * 0.01); // face
  const cheek = values.push(1.8) - 1;
  const nose = values.push(2.0) - 1;
  const room = values.push(0.3) - 1;
  const shoulder = values.push(1.35) - 1;

  const result = normalizeNearDepth(new Float32Array(values));

  assert.equal(result[room], 0);
  assert.ok(result[shoulder] > 0, 'shoulders should sit on the plinth');
  assert.ok(result[nose] - result[cheek] > 50, `nose ${result[nose]} should clearly lead cheek ${result[cheek]}`);
  assert.ok(result[nose] >= 250, `nose ${result[nose]} should reach full travel`);
});

test('keeps a flat depth map flush instead of raising every pin', () => {
  const result = normalizeNearDepth(new Float32Array([4, 4, 4, 4]));

  assert.deepEqual(Array.from(result), [0, 0, 0, 0]);
});

test('ignores invalid predictions while computing robust bounds', () => {
  const result = normalizeNearDepth(new Float32Array([Number.NaN, 0, 0.1, 5, 10]), {
    floorPercentile: 0,
    peakPercentile: 1,
    plinth: 0,
  });

  assert.deepEqual(Array.from(result), [0, 0, 0, 0, 255]);
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

function plateau(width: number, height: number, level: number, paint?: (x: number, y: number) => number | undefined) {
  const pressed = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    pressed[y * width + x] = Math.round((paint?.(x, y) ?? level) * 255);
  }
  return pressed;
}

test('leaves a flat sitter and the room untouched', () => {
  const pressed = plateau(24, 16, 0.5, (x) => (x < 6 ? 0 : undefined));

  assert.ok(featureRelief(pressed, 24, 16).every((value) => value === 128));
});

test('lifts a small bump like a nose and settles its surround', () => {
  const pressed = plateau(24, 16, 0.5, (x, y) => (x === 12 && y === 8 ? 0.6 : undefined));

  const result = featureRelief(pressed, 24, 16);

  assert.ok(result[8 * 24 + 12] > 200, `nose ${result[8 * 24 + 12]} should rise`);
  assert.ok(result[8 * 24 + 13] < 128, `neighbour ${result[8 * 24 + 13]} should dip`);
  assert.equal(result[2 * 24 + 2], 128);
});

test('does not emboss a depth cliff such as chin over chest or hair over face', () => {
  const pressed = plateau(24, 16, 0.8, (x) => (x < 12 ? 0.2 : undefined));

  assert.ok(featureRelief(pressed, 24, 16).every((value) => value === 128));
});
