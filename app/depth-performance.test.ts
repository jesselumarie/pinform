import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CAMERA_IDEAL_HEIGHT,
  CAMERA_IDEAL_WIDTH,
  DEPTH_FRAME_HEIGHT,
  DEPTH_FRAME_DELAY_MS,
  DEPTH_FRAME_WIDTH,
  DEPTH_MODEL_INPUT_HEIGHT,
  DEPTH_MODEL_INPUT_WIDTH,
  tuneDepthProcessor,
} from './depth-performance.ts';

test('keeps depth inference proportional to the physical pin grid', () => {
  assert.deepEqual([DEPTH_MODEL_INPUT_WIDTH, DEPTH_MODEL_INPUT_HEIGHT], [336, 224]);
  assert.equal(DEPTH_MODEL_INPUT_WIDTH % 14, 0);
  assert.equal(DEPTH_MODEL_INPUT_HEIGHT % 14, 0);
  assert.ok(DEPTH_MODEL_INPUT_WIDTH * DEPTH_MODEL_INPUT_HEIGHT <= 280 * 280);
  assert.deepEqual([DEPTH_FRAME_WIDTH, DEPTH_FRAME_HEIGHT], [288, 192]);
  assert.ok(DEPTH_FRAME_DELAY_MS <= 32);
  assert.deepEqual([CAMERA_IDEAL_WIDTH, CAMERA_IDEAL_HEIGHT], [640, 480]);
});

test('applies the low-latency input size to the loaded image processor', () => {
  const imageProcessor = { size: { width: 518, height: 518 } };

  assert.equal(tuneDepthProcessor({ processor: { image_processor: imageProcessor } }), true);
  assert.deepEqual(imageProcessor.size, { width: 336, height: 224 });
});

test('fails safely when a pipeline has no image processor', () => {
  assert.equal(tuneDepthProcessor({}), false);
});
