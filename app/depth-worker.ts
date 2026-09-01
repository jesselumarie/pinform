/// <reference lib="webworker" />

import { pipeline } from '@huggingface/transformers';
import type { DepthBackend } from './depth-backend';
import {
  DEPTH_FRAME_HEIGHT,
  DEPTH_FRAME_WIDTH,
  DEPTH_MODEL_INPUT_HEIGHT,
  DEPTH_MODEL_INPUT_WIDTH,
  tuneDepthProcessor,
} from './depth-performance';
import { downsampleDepth, normalizeNearDepth } from './depth-processing';

const INPUT_WIDTH = DEPTH_FRAME_WIDTH;
const INPUT_HEIGHT = DEPTH_FRAME_HEIGHT;
const PIN_WIDTH = 96;
const PIN_HEIGHT = 64;
const MODEL_ID = 'onnx-community/depth-anything-v2-small-ONNX';

type DepthEstimator = Awaited<ReturnType<typeof pipeline<'depth-estimation'>>>;
let estimatorPromise: Promise<DepthEstimator> | null = null;
let selectedBackend: DepthBackend | null = null;
const canvas = new OffscreenCanvas(INPUT_WIDTH, INPUT_HEIGHT);
const context = canvas.getContext('2d', { alpha: false });
const worker = self as DedicatedWorkerGlobalScope;

async function createEstimator(backend: DepthBackend) {
  const estimator = await pipeline('depth-estimation', MODEL_ID, {
    device: backend,
    dtype: backend === 'webgpu' ? 'q4' : 'q8',
    progress_callback: (progress) => {
      if (progress.status === 'progress_total') {
        worker.postMessage({ type: 'progress', progress: Math.round(progress.progress), backend });
      }
    },
  });
  if (!tuneDepthProcessor(estimator)) {
    throw new Error('The depth model image processor is unavailable.');
  }
  return estimator;
}

function loadEstimator(backend: DepthBackend) {
  if (selectedBackend && selectedBackend !== backend) {
    throw new Error('A depth worker cannot change backends after initialization.');
  }
  selectedBackend = backend;
  estimatorPromise ??= createEstimator(backend);
  return estimatorPromise;
}

function drawWarmupFrame() {
  if (!context) throw new Error('Image processing is unavailable.');
  const gradient = context.createLinearGradient(0, 0, INPUT_WIDTH, INPUT_HEIGHT);
  gradient.addColorStop(0, '#101820');
  gradient.addColorStop(0.52, '#d9e5ef');
  gradient.addColorStop(1, '#27313b');
  context.fillStyle = gradient;
  context.fillRect(0, 0, INPUT_WIDTH, INPUT_HEIGHT);
  context.fillStyle = '#f8fafc';
  context.beginPath();
  context.arc(INPUT_WIDTH * 0.5, INPUT_HEIGHT * 0.48, INPUT_HEIGHT * 0.27, 0, Math.PI * 2);
  context.fill();
}

async function predictRelief(estimator: DepthEstimator) {
  const result = await estimator(canvas);
  const prediction = result.predicted_depth;
  const height = prediction.dims.at(-2) ?? INPUT_HEIGHT;
  const width = prediction.dims.at(-1) ?? INPUT_WIDTH;
  const dense = new Float32Array(prediction.data as Float32Array);
  const pinDepth = downsampleDepth(dense, width, height, PIN_WIDTH, PIN_HEIGHT);
  return normalizeNearDepth(pinDepth);
}

worker.addEventListener('message', async (event: MessageEvent<
  { type: 'load'; backend: DepthBackend } | { type: 'estimate'; bitmap: ImageBitmap }
>) => {
  if (event.data.type === 'load') {
    try {
      const estimator = await loadEstimator(event.data.backend);
      worker.postMessage({
        type: 'warming',
        backend: event.data.backend,
        inputSize: `${DEPTH_MODEL_INPUT_WIDTH}x${DEPTH_MODEL_INPUT_HEIGHT}`,
      });
      drawWarmupFrame();
      const startedAt = performance.now();
      await predictRelief(estimator);
      worker.postMessage({
        type: 'ready',
        backend: event.data.backend,
        warmupMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      worker.postMessage({
        type: 'error',
        backend: event.data.backend,
        message: error instanceof Error ? error.message : 'Depth model failed to load.',
      });
    }
    return;
  }

  const { bitmap } = event.data;
  if (!context) {
    bitmap.close();
    worker.postMessage({ type: 'error', message: 'Image processing is unavailable.' });
    return;
  }

  try {
    if (!selectedBackend) throw new Error('Depth model has not been initialized.');
    const estimator = await loadEstimator(selectedBackend);
    context.drawImage(bitmap, 0, 0, INPUT_WIDTH, INPUT_HEIGHT);
    bitmap.close();
    const startedAt = performance.now();
    const relief = await predictRelief(estimator);
    worker.postMessage({
      type: 'depth',
      relief: relief.buffer,
      inferenceMs: Math.round(performance.now() - startedAt),
    }, [relief.buffer]);
  } catch (error) {
    bitmap.close();
    worker.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Depth inference failed.' });
  }
});

export {};
