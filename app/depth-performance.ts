export const DEPTH_MODEL_INPUT_WIDTH = 336;
export const DEPTH_MODEL_INPUT_HEIGHT = 224;
export const DEPTH_FRAME_WIDTH = 288;
export const DEPTH_FRAME_HEIGHT = 192;
export const DEPTH_FRAME_DELAY_MS = 24;
export const CAMERA_IDEAL_WIDTH = 640;
export const CAMERA_IDEAL_HEIGHT = 480;

interface DepthPipelineLike {
  processor?: {
    image_processor?: {
      size?: number | { width: number; height: number };
    };
  };
}

export function tuneDepthProcessor(pipeline: DepthPipelineLike) {
  const imageProcessor = pipeline.processor?.image_processor;
  if (!imageProcessor) return false;

  imageProcessor.size = {
    width: DEPTH_MODEL_INPUT_WIDTH,
    height: DEPTH_MODEL_INPUT_HEIGHT,
  };
  return true;
}
