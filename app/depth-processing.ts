export interface DepthNormalizationOptions {
  lowPercentile?: number;
  highPercentile?: number;
  nearThreshold?: number;
}

export function downsampleDepth(
  values: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
) {
  const output = new Float32Array(targetWidth * targetHeight);
  for (let targetY = 0; targetY < targetHeight; targetY += 1) {
    const startY = Math.floor((targetY * sourceHeight) / targetHeight);
    const endY = Math.max(startY + 1, Math.floor(((targetY + 1) * sourceHeight) / targetHeight));
    for (let targetX = 0; targetX < targetWidth; targetX += 1) {
      const startX = Math.floor((targetX * sourceWidth) / targetWidth);
      const endX = Math.max(startX + 1, Math.floor(((targetX + 1) * sourceWidth) / targetWidth));
      let total = 0;
      let count = 0;
      let peak = -Infinity;
      for (let sourceY = startY; sourceY < Math.min(sourceHeight, endY); sourceY += 1) {
        for (let sourceX = startX; sourceX < Math.min(sourceWidth, endX); sourceX += 1) {
          const value = values[sourceY * sourceWidth + sourceX];
          if (!Number.isFinite(value)) continue;
          total += value;
          peak = Math.max(peak, value);
          count += 1;
        }
      }
      const average = count ? total / count : Number.NaN;
      output[targetY * targetWidth + targetX] = count ? average * 0.75 + peak * 0.25 : Number.NaN;
    }
  }
  return output;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function percentile(sorted: number[], amount: number) {
  return sorted[Math.round((sorted.length - 1) * clamp01(amount))];
}

export function normalizeNearDepth(
  values: Float32Array,
  {
    lowPercentile = 0.08,
    highPercentile = 0.96,
    nearThreshold = 0.42,
  }: DepthNormalizationOptions = {},
) {
  const finite = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  const output = new Uint8Array(values.length);
  if (finite.length < 2) return output;

  const low = percentile(finite, lowPercentile);
  const high = percentile(finite, highPercentile);
  const range = high - low;
  if (!Number.isFinite(range) || range < 1e-6) return output;

  const threshold = clamp01(nearThreshold);
  const activeRange = Math.max(1e-6, 1 - threshold);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) continue;
    const normalized = clamp01((value - low) / range);
    const near = clamp01((normalized - threshold) / activeRange);
    output[index] = Math.round(near * near * (3 - 2 * near) * 255);
  }
  return output;
}
