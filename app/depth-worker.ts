/// <reference lib="webworker" />

import {
  AutoModelForDepthEstimation,
  AutoProcessor,
  pipeline,
  RawImage,
  type Tensor,
} from '@huggingface/transformers';
import type { DepthEngine } from './depth-backend';
import {
  DEPTH_FRAME_HEIGHT,
  DEPTH_FRAME_WIDTH,
  DEPTH_MODEL_INPUT_HEIGHT,
  DEPTH_MODEL_INPUT_WIDTH,
  tuneDepthProcessor,
} from './depth-performance';
import { downsampleDepth, featureRelief, normalizeNearDepth } from './depth-processing';

const INPUT_WIDTH = DEPTH_FRAME_WIDTH;
const INPUT_HEIGHT = DEPTH_FRAME_HEIGHT;
const PIN_WIDTH = 96;
const PIN_HEIGHT = 64;
/** Depth Anything 3 Small: real facial geometry. fp32 only (~100 MB), so WebGPU. */
const DA3_MODEL_ID = 'onnx-community/depth-anything-v3-small';
/** Depth Anything V2 Small: the light fallback (~26 MB q4, ~37 MB q8). Also lends DA3 its image processor. */
const V2_MODEL_ID = 'onnx-community/depth-anything-v2-small-ONNX';

interface DepthPrediction {
  /** Larger means nearer, whichever quantity the model predicts. */
  nearness: Float32Array;
  width: number;
  height: number;
}
type DepthEstimator = (image: RawImage) => Promise<DepthPrediction>;

let estimatorPromise: Promise<DepthEstimator> | null = null;
let selectedEngine: DepthEngine | null = null;
const canvas = new OffscreenCanvas(INPUT_WIDTH, INPUT_HEIGHT);
const context = canvas.getContext('2d', { alpha: false });
const worker = self as DedicatedWorkerGlobalScope;

function reportProgress(engine: DepthEngine) {
  return (progress: { status: string; progress?: number }) => {
    if (progress.status === 'progress_total') {
      worker.postMessage({ type: 'progress', progress: Math.round(progress.progress ?? 0), ...engine });
    }
  };
}

async function createEstimator(engine: DepthEngine): Promise<DepthEstimator> {
  const progress_callback = reportProgress(engine);
  if (engine.model === 'da3') {
    // The DA3 repo ships no preprocessor config; it uses the same DINOv2 normalization as V2.
    const processor = await AutoProcessor.from_pretrained(V2_MODEL_ID, { progress_callback });
    if (!tuneDepthProcessor({ processor })) throw new Error('The depth model image processor is unavailable.');
    const model = await AutoModelForDepthEstimation.from_pretrained(DA3_MODEL_ID, {
      device: engine.backend,
      dtype: 'fp32',
      progress_callback,
    });
    return async (image) => {
      const inputs = await processor(image);
      // DA3 is an any-view model: (batch, views, channels, height, width).
      inputs.pixel_values = inputs.pixel_values.unsqueeze(1);
      const { predicted_depth } = (await model(inputs)) as { predicted_depth: Tensor };
      // DA3 predicts depth (nearer = smaller); the relief wants nearer = larger.
      return {
        nearness: Float32Array.from(predicted_depth.data as Float32Array, (value) => -value),
        width: predicted_depth.dims.at(-1) ?? DEPTH_MODEL_INPUT_WIDTH,
        height: predicted_depth.dims.at(-2) ?? DEPTH_MODEL_INPUT_HEIGHT,
      };
    };
  }

  const estimator = await pipeline('depth-estimation', V2_MODEL_ID, {
    device: engine.backend,
    dtype: engine.backend === 'webgpu' ? 'q4' : 'q8',
    progress_callback,
  });
  if (!tuneDepthProcessor(estimator)) throw new Error('The depth model image processor is unavailable.');
  return async (image) => {
    const { predicted_depth } = await estimator(image);
    return {
      nearness: predicted_depth.data as Float32Array,
      width: predicted_depth.dims.at(-1) ?? INPUT_WIDTH,
      height: predicted_depth.dims.at(-2) ?? INPUT_HEIGHT,
    };
  };
}

function loadEstimator(engine: DepthEngine) {
  if (selectedEngine && (selectedEngine.backend !== engine.backend || selectedEngine.model !== engine.model)) {
    throw new Error('A depth worker cannot change engines after initialization.');
  }
  selectedEngine = engine;
  estimatorPromise ??= createEstimator(engine);
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
  const { nearness, width, height } = await estimator(await RawImage.read(canvas));
  const pinDepth = downsampleDepth(nearness, width, height, PIN_WIDTH, PIN_HEIGHT);
  const pressed = normalizeNearDepth(pinDepth);
  const feature = featureRelief(pressed, PIN_WIDTH, PIN_HEIGHT);
  const relief = new Uint8Array(pressed.length * 2);
  for (let index = 0; index < pressed.length; index += 1) {
    relief[index * 2] = pressed[index];
    relief[index * 2 + 1] = feature[index];
  }
  return relief;
}

worker.addEventListener('message', async (event: MessageEvent<
  ({ type: 'load' } & DepthEngine) | { type: 'estimate'; bitmap: ImageBitmap }
>) => {
  if (event.data.type === 'load') {
    const engine: DepthEngine = { backend: event.data.backend, model: event.data.model };
    try {
      const estimator = await loadEstimator(engine);
      worker.postMessage({
        type: 'warming',
        ...engine,
        inputSize: `${DEPTH_MODEL_INPUT_WIDTH}x${DEPTH_MODEL_INPUT_HEIGHT}`,
      });
      drawWarmupFrame();
      const startedAt = performance.now();
      await predictRelief(estimator);
      worker.postMessage({
        type: 'ready',
        ...engine,
        warmupMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      worker.postMessage({
        type: 'error',
        ...engine,
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
    if (!selectedEngine) throw new Error('Depth model has not been initialized.');
    const estimator = await loadEstimator(selectedEngine);
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
