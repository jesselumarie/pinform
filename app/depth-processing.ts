export interface DepthNormalizationOptions {
  floorPercentile?: number;
  peakPercentile?: number;
  plinth?: number;
  /** Fraction of the sitter's depth range the press reaches behind the nearest point. */
  pressDepth?: number;
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

function finiteSorted(values: Float32Array) {
  return Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
}

const HISTOGRAM_BINS = 256;

/**
 * Otsu's threshold over the depth histogram: the split that best separates the
 * near cluster (the sitter) from the far cluster (the room behind them).
 */
export function foregroundThreshold(values: Float32Array) {
  const sorted = finiteSorted(values);
  if (sorted.length < 2) return Number.POSITIVE_INFINITY;
  const min = sorted[0];
  const span = sorted[sorted.length - 1] - min;
  if (!(span > 0)) return min;

  const histogram = new Float64Array(HISTOGRAM_BINS);
  let totalMoment = 0;
  for (const value of sorted) {
    const bin = Math.min(HISTOGRAM_BINS - 1, Math.floor(((value - min) / span) * HISTOGRAM_BINS));
    histogram[bin] += 1;
    totalMoment += bin;
  }

  let farWeight = 0;
  let farMoment = 0;
  let bestSplit = 0;
  let bestVariance = -1;
  for (let bin = 0; bin < HISTOGRAM_BINS - 1; bin += 1) {
    farWeight += histogram[bin];
    farMoment += bin * histogram[bin];
    const nearWeight = sorted.length - farWeight;
    if (farWeight === 0 || nearWeight === 0) continue;
    const meanGap = farMoment / farWeight - (totalMoment - farMoment) / nearWeight;
    const variance = farWeight * nearWeight * meanGap * meanGap;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestSplit = bin;
    }
  }
  return min + ((bestSplit + 1) / HISTOGRAM_BINS) * span;
}

/**
 * Press the sitter into the pins like a real pin toy: the room stays flush, the
 * nearest point (nose) bottoms out at full travel, and everything in between is
 * linear so the nose-to-cheek step survives. The press only reaches part way
 * back into the sitter, the way a face pressed into a toy leaves the shoulders
 * untouched, so the face gets most of the travel.
 */
export function normalizeNearDepth(
  values: Float32Array,
  {
    floorPercentile = 0.03,
    peakPercentile = 0.995,
    plinth = 0.1,
    pressDepth = 0.6,
  }: DepthNormalizationOptions = {},
) {
  const output = new Uint8Array(values.length);
  const threshold = foregroundThreshold(values);
  const foreground = finiteSorted(values).filter((value) => value >= threshold);
  if (foreground.length < 2) return output;

  const peak = percentile(foreground, peakPercentile);
  const range = (peak - percentile(foreground, floorPercentile)) * Math.max(1e-3, Math.min(1, pressDepth));
  if (!(range > 1e-6)) return output;
  const floor = peak - range;

  const lift = clamp01(plinth);
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value) || value < threshold) continue;
    const press = clamp01((value - floor) / range);
    output[index] = Math.round((lift + (1 - lift) * press) * 255);
  }
  return output;
}

export interface FeatureReliefOptions {
  sigma?: number;
  rangeSigma?: number;
  knee?: number;
}

/**
 * Feature-scale relief for the FACIAL DETAIL slider, encoded around 128.
 * A bilateral high-pass of the pressed depth: bumps a few pins wide (nose,
 * lips, brow, sockets) are amplified, while big depth cliffs (silhouette,
 * chin over chest, hair over face) are left alone so they do not grow halos.
 * tanh soft-clips so weak and strong model outputs both land in range.
 */
export function featureRelief(
  pressed: Uint8Array,
  width: number,
  height: number,
  { sigma = 2.5, rangeSigma = 0.15, knee = 0.1 }: FeatureReliefOptions = {},
) {
  const radius = Math.ceil(sigma * 2.5);
  const kernel = Array.from({ length: radius * 2 + 1 }, (_, k) => Math.exp(-((k - radius) ** 2) / (2 * sigma * sigma)));
  const output = new Uint8Array(pressed.length).fill(128);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const center = pressed[y * width + x] / 255;
      if (center === 0) continue;
      let total = 0;
      let weight = 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const sampleY = y + dy;
        if (sampleY < 0 || sampleY >= height) continue;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const sampleX = x + dx;
          if (sampleX < 0 || sampleX >= width) continue;
          const sample = pressed[sampleY * width + sampleX] / 255;
          if (sample === 0) continue;
          const delta = sample - center;
          const g = kernel[dy + radius] * kernel[dx + radius] * Math.exp(-(delta * delta) / (2 * rangeSigma * rangeSigma));
          total += sample * g;
          weight += g;
        }
      }
      output[y * width + x] = Math.round(128 + 127 * Math.tanh((center - total / weight) / knee));
    }
  }
  return output;
}
