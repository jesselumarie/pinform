'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CameraIssue } from './camera';
import { summarizeDepthError } from './depth-backend';
import { formatDiagnostics, type DiagnosticEntry } from './diagnostics';
import PinSculpture, {
  type CameraState,
  type DepthMode,
  type DepthState,
  type PinSculptureHandle,
} from './pin-sculpture';

export default function Home() {
  const sculptureRef = useRef<PinSculptureHandle>(null);
  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [relief, setRelief] = useState(1.25);
  const [detail, setDetail] = useState(3);
  const [inverted, setInverted] = useState(false);
  const [depthMode, setDepthMode] = useState<DepthMode>('ai');
  const [depthState, setDepthState] = useState<DepthState>('idle');
  const [depthProgress, setDepthProgress] = useState<number | null>(null);
  const [depthError, setDepthError] = useState<string | null>(null);
  const [cameraIssue, setCameraIssue] = useState<CameraIssue | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([]);
  const [diagnosticsCopyState, setDiagnosticsCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const addDiagnostic = useCallback((message: string, details?: string) => {
    const entry: DiagnosticEntry = {
      elapsedMs: Math.round(performance.now()),
      message,
      details: details?.replace(/[\r\n]+/g, ' ').slice(0, 240),
    };
    setDiagnostics((current) => [...current, entry].slice(-100));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const hasCameraApi = Boolean(navigator.mediaDevices?.getUserMedia);
      addDiagnostic(
        'app.ready',
        [
          `camera_api=${hasCameraApi}`,
          `webgpu=${'gpu' in navigator}`,
          `offscreen_canvas=${'OffscreenCanvas' in window}`,
          `worker=${'Worker' in window}`,
          `secure=${window.isSecureContext}`,
          `cores=${navigator.hardwareConcurrency ?? 'unknown'}`,
        ].join(' '),
      );
      if (!hasCameraApi) {
        addDiagnostic('camera.api_missing');
        setCameraIssue('unsupported');
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [addDiagnostic]);

  const handleDepthStatus = useCallback((status: DepthState) => {
    addDiagnostic('depth.status', `state=${status}`);
    setDepthState(status);
  }, [addDiagnostic]);

  const handleCaptured = useCallback(() => setCameraState('captured'), []);

  const enableCamera = async () => {
    const previousState = cameraState;
    setCameraIssue(null);
    setCameraState('requesting');
    const started = await sculptureRef.current?.startCamera();
    setCameraState(started ? 'live' : previousState === 'captured' ? 'captured' : 'error');
  };

  const captureImprint = () => {
    sculptureRef.current?.capture();
  };

  const stopCamera = () => {
    sculptureRef.current?.stopCamera();
    setCameraState('idle');
    setDepthState('idle');
    setDepthProgress(null);
    setDepthError(null);
  };

  const copyCameraLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
    } catch {
      setLinkCopied(false);
    }
  };

  const copyDiagnostics = async () => {
    const report = formatDiagnostics({
      generatedAt: new Date().toISOString(),
      userAgent: navigator.userAgent,
      secureContext: window.isSecureContext,
      entries: diagnostics,
    });
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(report);
      } else {
        const field = document.createElement('textarea');
        field.value = report;
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        const copied = document.execCommand('copy');
        field.remove();
        if (!copied) throw new Error('Clipboard copy failed.');
      }
      setDiagnosticsCopyState('copied');
    } catch {
      setDiagnosticsCopyState('failed');
    }
    window.setTimeout(() => setDiagnosticsCopyState('idle'), 2200);
  };

  const cameraActive = cameraState === 'live' || cameraState === 'captured';
  const captured = cameraState === 'captured';
  const needsBrowserHandoff = cameraIssue === 'unsupported' || cameraIssue === 'unknown';
  const cameraIssueCopy: Record<CameraIssue, string> = {
    unsupported: 'No camera found. Connect one or open this on another device.',
    denied: 'Camera blocked. Allow access in your browser settings.',
    busy: 'Camera busy. Close other camera apps and retry.',
    unknown: 'Camera could not start. Try Chrome or Safari.',
  };
  const statusCopy = cameraIssue && (cameraState === 'error' || cameraState === 'idle')
    ? cameraIssueCopy[cameraIssue]
    : cameraState === 'requesting'
      ? 'Waiting for camera permission'
      : cameraState === 'live'
      ? depthState === 'loading'
        ? depthProgress !== null && depthProgress > 0
          ? `Camera live · loading AI depth ${depthProgress}%`
          : 'Camera live · starting AI depth'
        : depthState === 'warming'
          ? 'Camera live · checking AI inference'
        : depthState === 'fallback'
          ? `AI depth error · ${summarizeDepthError(depthError ?? '')}`
          : depthState === 'ready-cpu' && depthMode === 'ai'
            ? 'Camera live · AI depth, compatibility mode'
          : depthMode === 'ai'
            ? 'Camera live · AI depth'
            : 'Camera live · classic relief'
      : cameraState === 'captured'
        ? 'Captured · camera off'
        : cameraState === 'error'
          ? 'Camera unavailable'
          : 'Camera off';

  return (
    <main className="experience-shell">
      <div className="grain" aria-hidden="true" />

      <header className="topbar">
        <a className="brand" href="#top" aria-label="Pinform home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>Pinform</span>
        </a>
        <div className="privacy-note">
          <span className={`status-dot ${cameraState === 'live' ? 'is-live' : ''}`} />
          Camera stays on this device
        </div>
      </header>

      <section className="hero" id="top">
        <div className="sculpture-stage">
          <PinSculpture
            ref={sculptureRef}
            relief={relief}
            detail={detail}
            inverted={inverted}
            depthMode={depthMode}
            onCameraError={(issue) => {
              setCameraIssue(issue);
              setCameraState('error');
            }}
            onDepthStatus={handleDepthStatus}
            onDepthProgress={setDepthProgress}
            onDepthError={setDepthError}
            onDiagnostic={addDiagnostic}
            onCaptured={handleCaptured}
          />
          <div className={`live-badge ${cameraActive ? 'is-visible' : ''} ${captured ? 'is-captured' : ''}`}><span /> {captured ? 'Captured' : 'Live'}</div>
          <div className={`rotate-hint ${captured ? 'is-visible' : ''}`}>Drag to rotate</div>
        </div>

        <aside className={`control-card ${cameraActive ? 'camera-active' : ''}`} aria-label="Controls">
          {!cameraActive && needsBrowserHandoff ? (
            <button className="camera-button" type="button" onClick={copyCameraLink}>
              {linkCopied ? 'Link copied' : 'Copy link for a device with a camera'}
            </button>
          ) : !cameraActive ? (
            <button className="camera-button" type="button" onClick={enableCamera} disabled={cameraState === 'requesting'}>
              <span className="camera-icon" aria-hidden="true" />
              {cameraState === 'requesting' ? 'Requesting access…' : 'Enable camera'}
            </button>
          ) : cameraState === 'live' ? (
            <div className="action-grid">
              <button className="mode-button capture-action" type="button" onClick={captureImprint}>Capture</button>
              <button className="mode-button" type="button" onClick={() => sculptureRef.current?.pulse()}>Pulse</button>
            </div>
          ) : (
            <div className="action-grid">
              <button className="mode-button capture-action" type="button" onClick={enableCamera}>Retake</button>
              <button className="mode-button" type="button" onClick={() => sculptureRef.current?.resetView()}>Reset view</button>
            </div>
          )}

          {cameraActive && (
            <div className="tuning-controls">
              <div className="depth-mode" aria-label="Depth detector">
                <button type="button" className={depthMode === 'ai' ? 'is-active' : ''} onClick={() => {
                  setDepthMode('ai');
                  if (captured && depthState !== 'ready-gpu' && depthState !== 'ready-cpu') {
                    void enableCamera();
                  } else {
                    sculptureRef.current?.retryDepth();
                  }
                }} aria-busy={depthState === 'loading' || depthState === 'warming'}>
                  {captured && depthState === 'fallback'
                    ? 'Retake for AI depth'
                    : depthState === 'fallback'
                      ? 'Retry AI depth'
                      : depthState === 'loading'
                        ? 'AI loading…'
                        : depthState === 'warming'
                          ? 'AI checking…'
                          : 'AI depth'}
                </button>
                <button type="button" className={depthMode === 'classic' ? 'is-active' : ''} onClick={() => setDepthMode('classic')}>Classic</button>
              </div>
              <label>
                <span>Relief</span><output>{Math.round(relief * 100)}</output>
                <input type="range" min="0.55" max="2" step="0.05" value={relief} onChange={(event) => setRelief(Number(event.target.value))} />
              </label>
              <label>
                <span>{depthMode === 'ai' ? 'Facial detail' : 'Edge detail'}</span><output>{Math.round(detail * 100)}</output>
                <input type="range" min="0" max="5" step="0.05" value={detail} onChange={(event) => setDetail(Number(event.target.value))} />
              </label>
              <div className="micro-actions">
                <button type="button" className={inverted ? 'is-active' : ''} onClick={() => setInverted((value) => !value)}>Invert depth</button>
                <button type="button" onClick={stopCamera}>Stop camera</button>
              </div>
            </div>
          )}

          <p className={`camera-status ${cameraState === 'error' || depthState === 'fallback' ? 'is-error' : ''}`} role="status" aria-live="polite">
            <span /> {statusCopy}
          </p>

          <details className="diagnostics-panel">
            <summary><span>Diagnostics</span><small>{diagnostics.length} events</small></summary>
            <div className="diagnostics-body">
              <pre aria-label="Pinform diagnostic log">
                {diagnostics.slice(-14).map(({ elapsedMs, message, details }) => (
                  `[${(elapsedMs / 1000).toFixed(3)}s] ${message}${details ? ` · ${details}` : ''}`
                )).join('\n') || 'Waiting for diagnostic events…'}
              </pre>
              <button type="button" onClick={copyDiagnostics}>
                {diagnosticsCopyState === 'copied'
                  ? 'Copied'
                  : diagnosticsCopyState === 'failed'
                    ? 'Copy failed · select the log above'
                    : 'Copy diagnostics'}
              </button>
            </div>
          </details>
        </aside>
      </section>
    </main>
  );
}
