'use client';

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { classifyCameraError, type CameraIssue } from './camera';
import { depthEngineForAttempt, depthEngineOrder, type DepthBackend, type DepthModel } from './depth-backend';
import {
  CAMERA_IDEAL_HEIGHT,
  CAMERA_IDEAL_WIDTH,
  DEPTH_FRAME_DELAY_MS,
  DEPTH_FRAME_HEIGHT,
  DEPTH_FRAME_WIDTH,
} from './depth-performance';
import { IMPRINT_SCALE, MAX_PIN_TRAVEL, MIN_PIN_TRAVEL, PIN_LENGTH } from './pin-geometry';
import { applyDragRotation, settleRotation, type Rotation } from './rotation';

const COLUMNS = 96;
const ROWS = 64;
const SPACING = 0.136;
const DEPTH_CHANNELS = 2;

/** Flush pins (R = 0) with flat feature relief (G = 128). */
function flattenDepth<T extends Uint8Array | Float32Array>(data: T) {
  data.fill(0);
  for (let index = 1; index < data.length; index += DEPTH_CHANNELS) data[index] = 128;
  return data;
}

export type CameraState = 'idle' | 'requesting' | 'live' | 'captured' | 'error';
export type DepthMode = 'ai' | 'classic';
export type DepthState = 'idle' | 'loading' | 'warming' | 'ready-gpu' | 'ready-cpu' | 'fallback';

export interface PinSculptureHandle {
  startCamera: () => Promise<boolean>;
  capture: () => boolean;
  stopCamera: () => void;
  retryDepth: () => void;
  pulse: () => void;
  resetView: () => void;
}

interface PinSculptureProps {
  relief: number;
  detail: number;
  inverted: boolean;
  depthMode: DepthMode;
  onCameraError: (issue: CameraIssue) => void;
  onDepthStatus: (status: DepthState) => void;
  onDepthProgress: (progress: number | null) => void;
  onDepthError: (message: string | null) => void;
  onDiagnostic: (message: string, details?: string) => void;
  onCaptured: () => void;
}

interface SculptureUniforms {
  uTime: THREE.IUniform<number>;
  uPointer: THREE.IUniform<THREE.Vector2>;
  uBoard: THREE.IUniform<THREE.Vector2>;
  uVideo: THREE.IUniform<THREE.Texture>;
  uVideoAspect: THREE.IUniform<number>;
  uDepth: THREE.IUniform<THREE.Texture>;
  uUseVideo: THREE.IUniform<number>;
  uUseDepth: THREE.IUniform<number>;
  uRelief: THREE.IUniform<number>;
  uDetail: THREE.IUniform<number>;
  uInvert: THREE.IUniform<number>;
  uPulseStart: THREE.IUniform<number>;
  uMotion: THREE.IUniform<number>;
}

const PinSculpture = forwardRef<PinSculptureHandle, PinSculptureProps>(function PinSculpture(
  {
    relief,
    detail,
    inverted,
    depthMode,
    onCameraError,
    onDepthStatus,
    onDepthProgress,
    onDepthError,
    onDiagnostic,
    onCaptured,
  },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const uniformsRef = useRef<SculptureUniforms | null>(null);
  const fallbackTextureRef = useRef<THREE.DataTexture | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoTextureRef = useRef<THREE.VideoTexture | null>(null);
  const capturedTextureRef = useRef<THREE.CanvasTexture | null>(null);
  const depthTextureRef = useRef<THREE.DataTexture | null>(null);
  const depthWorkerRef = useRef<Worker | null>(null);
  const depthReadyRef = useRef(false);
  const depthBackendRef = useRef<DepthBackend>('webgpu');
  const depthNextAttemptRef = useRef(0);
  const startDepthAttemptRef = useRef<(attempt: number, lastError?: string) => void>(() => undefined);
  const depthPendingRef = useRef(false);
  const depthTimerRef = useRef<number | null>(null);
  const depthProgressBucketRef = useRef(-1);
  const depthFrameCountRef = useRef(0);
  const depthLastFrameAtRef = useRef(0);
  const depthCaptureErrorLoggedRef = useRef(false);
  const depthSmoothedRef = useRef(flattenDepth(new Float32Array(COLUMNS * ROWS * DEPTH_CHANNELS)));
  const depthModeRef = useRef(depthMode);
  const isCapturedRef = useRef(false);
  const rotationTargetRef = useRef<Rotation>({ x: 0, y: 0 });
  const cameraMixTargetRef = useRef(0);
  const pulseRequestedRef = useRef(false);
  const initialTuningRef = useRef({ relief, detail, inverted });

  const stopDepthFrames = useCallback(() => {
    if (depthTimerRef.current !== null) window.clearTimeout(depthTimerRef.current);
    depthTimerRef.current = null;
    depthPendingRef.current = false;
  }, []);

  const updateDepthTexture = useCallback((next: Uint8Array) => {
    const texture = depthTextureRef.current;
    const uniforms = uniformsRef.current;
    if (!texture || !uniforms || next.length !== COLUMNS * ROWS * DEPTH_CHANNELS) return;
    const pixels = texture.image.data as Uint8Array;
    const smoothed = depthSmoothedRef.current;
    for (let index = 0; index < next.length; index += 1) {
      smoothed[index] += (next[index] - smoothed[index]) * 0.38;
      pixels[index] = Math.round(smoothed[index]);
    }
    texture.needsUpdate = true;
    uniforms.uUseDepth.value = depthModeRef.current === 'ai' ? 1 : 0;
  }, []);

  const scheduleDepthFrame = useCallback(() => {
    if (!depthReadyRef.current || depthPendingRef.current || !streamRef.current) return;
    if (depthTimerRef.current !== null) window.clearTimeout(depthTimerRef.current);
    depthTimerRef.current = window.setTimeout(async () => {
      depthTimerRef.current = null;
      const worker = depthWorkerRef.current;
      const video = videoRef.current;
      if (!worker || !video || !streamRef.current || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      if (!video.videoWidth || !video.videoHeight) {
        scheduleDepthFrame();
        return;
      }

      const canvas = document.createElement('canvas');
      canvas.width = DEPTH_FRAME_WIDTH;
      canvas.height = DEPTH_FRAME_HEIGHT;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) return;
      const targetAspect = canvas.width / canvas.height;
      const sourceAspect = video.videoWidth / Math.max(video.videoHeight, 1);
      let sourceX = 0;
      let sourceY = 0;
      let sourceWidth = video.videoWidth;
      let sourceHeight = video.videoHeight;
      if (sourceAspect > targetAspect) {
        sourceWidth = video.videoHeight * targetAspect;
        sourceX = (video.videoWidth - sourceWidth) / 2;
      } else {
        sourceHeight = video.videoWidth / targetAspect;
        sourceY = (video.videoHeight - sourceHeight) / 2;
      }
      try {
        context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
        depthPendingRef.current = true;
        const bitmap = await createImageBitmap(canvas);
        if (!streamRef.current) {
          bitmap.close();
          depthPendingRef.current = false;
          return;
        }
        worker.postMessage({ type: 'estimate', bitmap }, [bitmap]);
      } catch {
        depthPendingRef.current = false;
        if (!depthCaptureErrorLoggedRef.current) {
          depthCaptureErrorLoggedRef.current = true;
          onDiagnostic('depth.frame_capture_failed');
        }
        scheduleDepthFrame();
      }
    }, DEPTH_FRAME_DELAY_MS);
  }, [onDiagnostic]);

  const startDepthAttempt = useCallback((attempt: number, lastError?: string) => {
    const hasWebGPU = 'gpu' in navigator;
    const engine = depthEngineForAttempt(hasWebGPU, attempt);
    if (!engine) {
      onDiagnostic('depth.exhausted', lastError);
      onDepthProgress(null);
      onDepthError(lastError ?? 'No compatible depth backend is available.');
      onDepthStatus('fallback');
      if (uniformsRef.current) uniformsRef.current.uUseDepth.value = 0;
      return;
    }

    depthReadyRef.current = false;
    depthProgressBucketRef.current = -1;
    depthFrameCountRef.current = 0;
    depthLastFrameAtRef.current = 0;
    const { backend, model } = engine;
    onDiagnostic('depth.backend_attempt', `backend=${backend} model=${model} attempt=${attempt + 1}`);
    onDepthError(null);
    onDepthStatus('loading');
    onDepthProgress(0);
    let worker: Worker;
    try {
      const depthWorkerUrl = new URL(
        'depth-runtime/depth-worker.js',
        new URL(import.meta.env.BASE_URL, window.location.origin),
      ).href;
      worker = new Worker(depthWorkerUrl, { type: 'module' });
    } catch (error) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      onDiagnostic('depth.worker_create_failed', `backend=${backend} message=${message}`);
      startDepthAttemptRef.current(attempt + 1, `Worker construction failed: ${message}`);
      return;
    }
    depthWorkerRef.current = worker;
    let failed = false;
    const failAttempt = (message = 'The depth worker stopped unexpectedly.') => {
      if (failed || depthWorkerRef.current !== worker) return;
      failed = true;
      depthPendingRef.current = false;
      depthReadyRef.current = false;
      worker.terminate();
      depthWorkerRef.current = null;
      onDiagnostic('depth.backend_failed', `backend=${backend} model=${model} message=${message}`);
      // Do not retry a failed engine this session, but always leave the last one available.
      depthNextAttemptRef.current = Math.min(attempt + 1, depthEngineOrder(hasWebGPU).length - 1);
      startDepthAttemptRef.current(attempt + 1, message);
    };
    worker.addEventListener('error', (event) => {
      event.preventDefault();
      failAttempt();
    });
    worker.addEventListener('message', (event: MessageEvent<{
      type: string;
      relief?: ArrayBuffer;
      backend?: DepthBackend;
      model?: DepthModel;
      progress?: number;
      message?: string;
      inferenceMs?: number;
      inputSize?: number | string;
      warmupMs?: number;
    }>) => {
      if (depthWorkerRef.current !== worker) return;
      if (event.data.type === 'ready') {
        depthReadyRef.current = true;
        depthBackendRef.current = event.data.backend ?? 'webgpu';
        onDepthProgress(null);
        onDiagnostic(
          'depth.ready',
          `backend=${depthBackendRef.current} model=${event.data.model ?? model} warmup_ms=${event.data.warmupMs ?? 'unknown'}`,
        );
        onDepthStatus(depthBackendRef.current === 'wasm' ? 'ready-cpu' : 'ready-gpu');
        scheduleDepthFrame();
      } else if (event.data.type === 'warming') {
        onDiagnostic('depth.warmup', `backend=${backend} model=${model} input=${event.data.inputSize ?? 'unknown'}`);
        onDepthProgress(null);
        onDepthStatus('warming');
      } else if (event.data.type === 'progress' && typeof event.data.progress === 'number') {
        const bucket = Math.floor(event.data.progress / 10) * 10;
        if (bucket > depthProgressBucketRef.current) {
          depthProgressBucketRef.current = bucket;
          onDiagnostic('depth.model_progress', `backend=${backend} progress=${bucket}%`);
        }
        onDepthProgress(event.data.progress);
      } else if (event.data.type === 'depth' && event.data.relief) {
        const now = performance.now();
        const interval = depthLastFrameAtRef.current ? Math.round(now - depthLastFrameAtRef.current) : 0;
        depthLastFrameAtRef.current = now;
        depthFrameCountRef.current += 1;
        const frame = depthFrameCountRef.current;
        if (frame <= 3 || frame % 10 === 0) {
          onDiagnostic(
            'depth.frame',
            `backend=${backend} model=${model} frame=${frame} inference_ms=${event.data.inferenceMs ?? 'unknown'} interval_ms=${interval}`,
          );
        }
        depthPendingRef.current = false;
        updateDepthTexture(new Uint8Array(event.data.relief));
        scheduleDepthFrame();
      } else if (event.data.type === 'unsupported' || event.data.type === 'error') {
        failAttempt(event.data.message);
      }
    });
    worker.postMessage({ type: 'load', backend, model });
  }, [onDepthError, onDepthProgress, onDepthStatus, onDiagnostic, scheduleDepthFrame, updateDepthTexture]);
  startDepthAttemptRef.current = startDepthAttempt;

  const startDepthEngine = useCallback(() => {
    if (depthReadyRef.current) {
      onDepthProgress(null);
      onDepthStatus(depthBackendRef.current === 'wasm' ? 'ready-cpu' : 'ready-gpu');
      scheduleDepthFrame();
      return;
    }
    if (depthWorkerRef.current) {
      onDepthStatus('loading');
      return;
    }
    startDepthAttempt(depthNextAttemptRef.current);
  }, [onDepthProgress, onDepthStatus, scheduleDepthFrame, startDepthAttempt]);

  const teardownLiveStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
      videoRef.current = null;
    }
    videoTextureRef.current?.dispose();
    videoTextureRef.current = null;
  }, []);

  const clearCapturedTexture = useCallback(() => {
    capturedTextureRef.current?.dispose();
    capturedTextureRef.current = null;
    isCapturedRef.current = false;
    rotationTargetRef.current = { x: 0, y: 0 };
    mountRef.current?.classList.remove('is-captured', 'is-dragging');
  }, []);

  const stopCamera = useCallback(() => {
    onDiagnostic('camera.stopped');
    cameraMixTargetRef.current = 0;
    stopDepthFrames();
    teardownLiveStream();
    clearCapturedTexture();
    if (uniformsRef.current && fallbackTextureRef.current) {
      uniformsRef.current.uVideo.value = fallbackTextureRef.current;
      uniformsRef.current.uVideoAspect.value = COLUMNS / ROWS;
    }
  }, [clearCapturedTexture, onDiagnostic, stopDepthFrames, teardownLiveStream]);

  const startCamera = useCallback(async () => {
    if (streamRef.current) return true;
    const hasCameraApi = Boolean(navigator.mediaDevices?.getUserMedia);
    onDiagnostic('camera.requested', `api=${hasCameraApi} secure=${window.isSecureContext}`);
    if (!hasCameraApi || !uniformsRef.current) {
      onDiagnostic('camera.unavailable', `api=${hasCameraApi} renderer=${Boolean(uniformsRef.current)}`);
      onCameraError(classifyCameraError(null, hasCameraApi));
      return false;
    }

    if (depthModeRef.current === 'ai') {
      try {
        startDepthEngine();
      } catch {
        onDepthStatus('fallback');
      }
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: CAMERA_IDEAL_WIDTH },
          height: { ideal: CAMERA_IDEAL_HEIGHT },
          frameRate: { ideal: 30, max: 30 },
        },
      });
      streamRef.current = stream;
      const settings = stream.getVideoTracks()[0]?.getSettings();
      onDiagnostic(
        'camera.stream_ready',
        `width=${settings?.width ?? 'unknown'} height=${settings?.height ?? 'unknown'} fps=${settings?.frameRate ?? 'unknown'}`,
      );
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.srcObject = stream;
      await video.play();
      onDiagnostic('camera.video_playing', `width=${video.videoWidth} height=${video.videoHeight}`);

      const texture = new THREE.VideoTexture(video);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;

      clearCapturedTexture();
      videoRef.current = video;
      videoTextureRef.current = texture;
      uniformsRef.current.uVideo.value = texture;
      uniformsRef.current.uVideoAspect.value = video.videoWidth / video.videoHeight;
      uniformsRef.current.uUseDepth.value = 0;
      flattenDepth(depthSmoothedRef.current);
      if (depthTextureRef.current) {
        flattenDepth(depthTextureRef.current.image.data as Uint8Array);
        depthTextureRef.current.needsUpdate = true;
      }
      cameraMixTargetRef.current = 1;
      pulseRequestedRef.current = true;
      if (depthModeRef.current === 'ai') {
        try {
          startDepthEngine();
        } catch {
          onDepthStatus('fallback');
        }
      }
      return true;
    } catch (error) {
      teardownLiveStream();
      const issue = classifyCameraError(error, hasCameraApi);
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      onDiagnostic('camera.failed', `issue=${issue} message=${message}`);
      onCameraError(issue);
      return false;
    }
  }, [clearCapturedTexture, onCameraError, onDepthStatus, onDiagnostic, startDepthEngine, teardownLiveStream]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    const uniforms = uniformsRef.current;
    if (!video || !uniforms || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false;

    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context || !video.videoWidth || !video.videoHeight) return false;

    const targetAspect = canvas.width / canvas.height;
    const sourceAspect = video.videoWidth / video.videoHeight;
    let sourceX = 0;
    let sourceY = 0;
    let sourceWidth = video.videoWidth;
    let sourceHeight = video.videoHeight;
    if (sourceAspect > targetAspect) {
      sourceWidth = video.videoHeight * targetAspect;
      sourceX = (video.videoWidth - sourceWidth) / 2;
    } else {
      sourceHeight = video.videoWidth / targetAspect;
      sourceY = (video.videoHeight - sourceHeight) / 2;
    }
    context.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    capturedTextureRef.current?.dispose();
    capturedTextureRef.current = texture;
    uniforms.uVideo.value = texture;
    uniforms.uVideoAspect.value = canvas.width / canvas.height;
    cameraMixTargetRef.current = 1;
    isCapturedRef.current = true;
    onDiagnostic('camera.captured', `width=${canvas.width} height=${canvas.height}`);
    mountRef.current?.classList.add('is-captured');
    onCaptured();
    stopDepthFrames();
    teardownLiveStream();
    pulseRequestedRef.current = true;
    return true;
  }, [onCaptured, onDiagnostic, stopDepthFrames, teardownLiveStream]);

  useImperativeHandle(ref, () => ({
    startCamera,
    capture,
    stopCamera,
    retryDepth: startDepthEngine,
    pulse: () => { pulseRequestedRef.current = true; },
    resetView: () => { rotationTargetRef.current = { x: 0, y: 0 }; },
  }), [capture, startCamera, startDepthEngine, stopCamera]);

  useEffect(() => {
    const uniforms = uniformsRef.current;
    if (!uniforms) return;
    uniforms.uRelief.value = relief;
    uniforms.uDetail.value = detail;
    uniforms.uInvert.value = inverted ? 1 : 0;
  }, [relief, detail, inverted]);

  useEffect(() => {
    depthModeRef.current = depthMode;
    const uniforms = uniformsRef.current;
    if (uniforms) uniforms.uUseDepth.value = depthMode === 'ai' && depthReadyRef.current ? 1 : 0;
  }, [depthMode]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const fallbackTexture = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    fallbackTexture.needsUpdate = true;
    fallbackTextureRef.current = fallbackTexture;
    const depthTexture = new THREE.DataTexture(
      flattenDepth(new Uint8Array(COLUMNS * ROWS * DEPTH_CHANNELS)),
      COLUMNS,
      ROWS,
      THREE.RGFormat,
    );
    depthTexture.minFilter = THREE.LinearFilter;
    depthTexture.magFilter = THREE.LinearFilter;
    depthTexture.generateMipmaps = false;
    depthTexture.needsUpdate = true;
    depthTextureRef.current = depthTexture;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 100);
    camera.position.set(0, -0.15, 16.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    mount.appendChild(renderer.domElement);
    onDiagnostic(
      'renderer.ready',
      `webgl2=${renderer.capabilities.isWebGL2} max_texture=${renderer.capabilities.maxTextureSize} pixel_ratio=${renderer.getPixelRatio()}`,
    );

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnvironment = new RoomEnvironment();
    const environmentTarget = pmremGenerator.fromScene(roomEnvironment, 0.04);
    scene.environment = environmentTarget.texture;
    const toyGroup = new THREE.Group();
    scene.add(toyGroup);

    const boardWidth = (COLUMNS - 1) * SPACING;
    const boardHeight = (ROWS - 1) * SPACING;
    const geometry = new THREE.CylinderGeometry(0.052, 0.052, PIN_LENGTH, 8, 1, false);
    geometry.rotateX(Math.PI / 2);

    const material = new THREE.MeshPhysicalMaterial({
      color: 0xdde2e8,
      metalness: 1,
      roughness: 0.18,
      clearcoat: 0.08,
      clearcoatRoughness: 0.24,
      envMapIntensity: 1.65,
    });

    const uniforms: SculptureUniforms = {
      uTime: { value: 0 },
      uPointer: { value: new THREE.Vector2(0.5, 0.5) },
      uBoard: { value: new THREE.Vector2(boardWidth, boardHeight) },
      uVideo: { value: fallbackTexture },
      uVideoAspect: { value: COLUMNS / ROWS },
      uDepth: { value: depthTexture },
      uUseVideo: { value: 0 },
      uUseDepth: { value: 0 },
      uRelief: { value: initialTuningRef.current.relief },
      uDetail: { value: initialTuningRef.current.detail },
      uInvert: { value: initialTuningRef.current.inverted ? 1 : 0 },
      uPulseStart: { value: -10 },
      uMotion: { value: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1 },
    };
    uniformsRef.current = uniforms;

    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = `
        uniform float uTime;
        uniform vec2 uPointer;
        uniform vec2 uBoard;
        uniform sampler2D uVideo;
        uniform float uVideoAspect;
        uniform sampler2D uDepth;
        uniform float uUseVideo;
        uniform float uUseDepth;
        uniform float uRelief;
        uniform float uDetail;
        uniform float uInvert;
        uniform float uPulseStart;
        uniform float uMotion;
        float pinLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
      ${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
          vec3 transformed = vec3(position);
          vec2 pinUv = vec2(instanceMatrix[3].x / uBoard.x + 0.5, instanceMatrix[3].y / uBoard.y + 0.5);
          float pointerDistance = distance(pinUv, uPointer);
          float pointerWave = exp(-pointerDistance * 8.0) * cos(pointerDistance * 27.0 - uTime * 4.2) * uMotion;
          float ambientWave = sin(pinUv.x * 11.0 + uTime * 0.72) * cos(pinUv.y * 9.0 - uTime * 0.54) * 0.13 * uMotion;
          float centerPulse = sin(length(pinUv - 0.5) * 20.0 - uTime * 1.5) * 0.055 * uMotion;
          float proceduralRelief = pointerWave * 0.55 + ambientWave + centerPulse;

          vec2 videoUv = pinUv;
          vec2 imprintUv = (videoUv - 0.5) / ${IMPRINT_SCALE.toFixed(2)} + 0.5;
          float imprintMask = step(0.0, imprintUv.x) * step(imprintUv.x, 1.0)
            * step(0.0, imprintUv.y) * step(imprintUv.y, 1.0);
          vec2 cameraUv = imprintUv;
          float boardAspect = uBoard.x / uBoard.y;
          if (uVideoAspect > boardAspect) {
            cameraUv.x = (cameraUv.x - 0.5) * (boardAspect / uVideoAspect) + 0.5;
          } else {
            cameraUv.y = (cameraUv.y - 0.5) * (uVideoAspect / boardAspect) + 0.5;
          }
          float cameraDetailRadius = mix(1.35, 0.75, clamp(uDetail / 5.0, 0.0, 1.0));
          vec2 px = vec2(1.0 / 96.0, 1.0 / 64.0) * cameraDetailRadius;
          float center = pinLuma(texture2D(uVideo, cameraUv).rgb);
          float neighbors = pinLuma(texture2D(uVideo, cameraUv + vec2(px.x, 0.0)).rgb)
            + pinLuma(texture2D(uVideo, cameraUv - vec2(px.x, 0.0)).rgb)
            + pinLuma(texture2D(uVideo, cameraUv + vec2(0.0, px.y)).rgb)
            + pinLuma(texture2D(uVideo, cameraUv - vec2(0.0, px.y)).rgb);
          float edge = center - neighbors * 0.25;
          float cameraRelief = ((center - 0.48) * 1.25 + edge * uDetail * 3.1) * uRelief;
          cameraRelief *= mix(1.0, -1.0, uInvert) * imprintMask;
          vec2 depthUv = vec2(imprintUv.x, 1.0 - imprintUv.y);
          // R: sitter pressed linearly into the pins. G: feature-scale relief
          // (nose, lips, brow) computed in the depth worker, 0.5 = flat.
          vec2 depthTexel = texture2D(uDepth, depthUv).rg;
          float depthSample = depthTexel.r;
          float depthBase = depthSample * uRelief * 0.72;
          float depthRelief = depthBase * imprintMask;
          float featureRelief = depthTexel.g * 2.0 - 1.0;
          float detailGate = smoothstep(0.05, 0.26, depthSample);
          float localDepthDetail = featureRelief * uDetail * 0.12 * uRelief;
          float cameraMicroDetail = edge * uDetail * 0.58 * uRelief;
          depthRelief += (localDepthDetail + cameraMicroDetail) * detailGate;
          cameraRelief = mix(cameraRelief, depthRelief, uUseDepth);

          float pulseAge = uTime - uPulseStart;
          float pulseRadius = pulseAge * 0.48;
          float shockwave = sin((pointerDistance - pulseRadius) * 55.0)
            * exp(-abs(pointerDistance - pulseRadius) * 38.0)
            * exp(-pulseAge * 1.7)
            * step(0.0, pulseAge) * step(pulseAge, 2.8);

          float pinTravel = clamp(
            mix(proceduralRelief, cameraRelief, uUseVideo) + shockwave * 0.7,
            ${MIN_PIN_TRAVEL.toFixed(2)},
            ${MAX_PIN_TRAVEL.toFixed(2)}
          );
          float pinAnchor = clamp((position.z + ${(PIN_LENGTH / 2).toFixed(2)}) / ${PIN_LENGTH.toFixed(2)}, 0.0, 1.0);
          transformed.z += pinTravel * pinAnchor;
        `,
      );
    };
    material.customProgramCacheKey = () => 'pinform-camera-relief-v8';

    const pins = new THREE.InstancedMesh(geometry, material, COLUMNS * ROWS);
    const matrix = new THREE.Matrix4();
    let index = 0;
    for (let row = 0; row < ROWS; row += 1) {
      for (let column = 0; column < COLUMNS; column += 1) {
        matrix.makeTranslation(column * SPACING - boardWidth / 2, row * SPACING - boardHeight / 2, 0);
        pins.setMatrixAt(index, matrix);
        index += 1;
      }
    }
    pins.instanceMatrix.needsUpdate = true;
    pins.frustumCulled = false;
    toyGroup.add(pins);

    const backing = new THREE.Mesh(
      new THREE.BoxGeometry(boardWidth + 0.32, boardHeight + 0.32, 0.32),
      new THREE.MeshStandardMaterial({ color: 0x0c1015, metalness: 0.82, roughness: 0.36 }),
    );
    backing.position.z = -0.54;
    toyGroup.add(backing);

    const bezelWidth = 0.46;
    const bezelDepth = 0.72;
    const bezelGap = 0.08;
    const bezelMaterial = new THREE.MeshStandardMaterial({
      color: 0x020304,
      metalness: 0.62,
      roughness: 0.26,
      envMapIntensity: 1.45,
    });
    const horizontalBezel = new THREE.BoxGeometry(
      boardWidth + (bezelGap + bezelWidth) * 2,
      bezelWidth,
      bezelDepth,
    );
    const verticalBezel = new THREE.BoxGeometry(
      bezelWidth,
      boardHeight + bezelGap * 2,
      bezelDepth,
    );
    [
      [horizontalBezel, 0, boardHeight / 2 + bezelGap + bezelWidth / 2],
      [horizontalBezel, 0, -boardHeight / 2 - bezelGap - bezelWidth / 2],
      [verticalBezel, boardWidth / 2 + bezelGap + bezelWidth / 2, 0],
      [verticalBezel, -boardWidth / 2 - bezelGap - bezelWidth / 2, 0],
    ].forEach(([bezelGeometry, x, y]) => {
      const bezel = new THREE.Mesh(bezelGeometry as THREE.BufferGeometry, bezelMaterial);
      bezel.position.set(x as number, y as number, -0.08);
      toyGroup.add(bezel);
    });

    const keyLight = new THREE.DirectionalLight(0xffffff, 3.8);
    keyLight.position.set(-3.5, 5.5, 8);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0xbad8ff, 2.8);
    rimLight.position.set(6, -3, 5);
    scene.add(rimLight);
    scene.add(new THREE.HemisphereLight(0xe8eef6, 0x0b0d12, 1.35));

    const pointerTarget = new THREE.Vector2(0.5, 0.5);
    const rotationCurrent: Rotation = { x: 0, y: 0 };
    let draggingPointer: number | null = null;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let dragDistance = 0;
    const updatePointer = (event: PointerEvent) => {
      const bounds = mount.getBoundingClientRect();
      pointerTarget.set(
        THREE.MathUtils.clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
        THREE.MathUtils.clamp(1 - (event.clientY - bounds.top) / bounds.height, 0, 1),
      );
    };
    const onPointerMove = (event: PointerEvent) => {
      if (isCapturedRef.current && draggingPointer === event.pointerId) {
        const deltaX = event.clientX - lastPointerX;
        const deltaY = event.clientY - lastPointerY;
        rotationTargetRef.current = applyDragRotation(rotationTargetRef.current, deltaX, deltaY);
        dragDistance += Math.hypot(deltaX, deltaY);
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        return;
      }
      updatePointer(event);
    };
    const onPointerDown = (event: PointerEvent) => {
      updatePointer(event);
      if (streamRef.current && capture()) return;
      if (isCapturedRef.current) {
        draggingPointer = event.pointerId;
        lastPointerX = event.clientX;
        lastPointerY = event.clientY;
        dragDistance = 0;
        mount.setPointerCapture(event.pointerId);
        mount.classList.add('is-dragging');
        return;
      }
      pulseRequestedRef.current = true;
    };
    const finishPointer = (event: PointerEvent) => {
      if (draggingPointer !== event.pointerId) return;
      if (dragDistance < 5) pulseRequestedRef.current = true;
      if (mount.hasPointerCapture(event.pointerId)) mount.releasePointerCapture(event.pointerId);
      draggingPointer = null;
      mount.classList.remove('is-dragging');
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isCapturedRef.current) return;
      const keyDrag: Record<string, [number, number]> = {
        ArrowLeft: [-20, 0],
        ArrowRight: [20, 0],
        ArrowUp: [0, -20],
        ArrowDown: [0, 20],
      };
      if (event.key === 'Home') {
        rotationTargetRef.current = { x: 0, y: 0 };
        event.preventDefault();
      } else if (keyDrag[event.key]) {
        rotationTargetRef.current = applyDragRotation(rotationTargetRef.current, ...keyDrag[event.key]);
        event.preventDefault();
      }
    };
    mount.addEventListener('pointermove', onPointerMove);
    mount.addEventListener('pointerdown', onPointerDown);
    mount.addEventListener('pointerup', finishPointer);
    mount.addEventListener('pointercancel', finishPointer);
    mount.addEventListener('keydown', onKeyDown);

    const resize = () => {
      const { width, height } = mount.getBoundingClientRect();
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    window.addEventListener('pagehide', stopCamera);

    const clock = new THREE.Clock();
    let animationFrame = 0;
    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const time = clock.getElapsedTime();
      uniforms.uTime.value = time;
      uniforms.uPointer.value.lerp(pointerTarget, 0.075);
      uniforms.uUseVideo.value = THREE.MathUtils.lerp(uniforms.uUseVideo.value, cameraMixTargetRef.current, 0.065);
      if (pulseRequestedRef.current) {
        uniforms.uPulseStart.value = time;
        pulseRequestedRef.current = false;
      }
      const drift = uniforms.uMotion.value;
      if (isCapturedRef.current) {
        const settled = settleRotation(rotationCurrent, rotationTargetRef.current, 0.1);
        rotationCurrent.x = settled.x;
        rotationCurrent.y = settled.y;
      } else {
        rotationCurrent.x = Math.sin(time * 0.22) * 0.012 * drift;
        rotationCurrent.y = Math.sin(time * 0.18) * 0.018 * drift;
      }
      toyGroup.rotation.set(rotationCurrent.x, rotationCurrent.y, 0);
      keyLight.position.x = -3.5 + Math.sin(time * 0.28) * 2.2 * drift;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      stopCamera();
      depthWorkerRef.current?.terminate();
      depthWorkerRef.current = null;
      depthReadyRef.current = false;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener('pagehide', stopCamera);
      mount.removeEventListener('pointermove', onPointerMove);
      mount.removeEventListener('pointerdown', onPointerDown);
      mount.removeEventListener('pointerup', finishPointer);
      mount.removeEventListener('pointercancel', finishPointer);
      mount.removeEventListener('keydown', onKeyDown);
      geometry.dispose();
      material.dispose();
      backing.geometry.dispose();
      (backing.material as THREE.Material).dispose();
      horizontalBezel.dispose();
      verticalBezel.dispose();
      bezelMaterial.dispose();
      environmentTarget.dispose();
      roomEnvironment.dispose();
      pmremGenerator.dispose();
      fallbackTexture.dispose();
      depthTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      uniformsRef.current = null;
      fallbackTextureRef.current = null;
      depthTextureRef.current = null;
    };
  }, [capture, onDiagnostic, stopCamera]);

  return (
    <div
      ref={mountRef}
      className="pin-canvas"
      tabIndex={0}
      aria-label="Interactive 3D silver pin sculpture. When live, click to capture. After capture, drag or use the arrow keys to rotate it."
    />
  );
});

export default PinSculpture;
