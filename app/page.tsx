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
    unsupported: 'NO CAMERA DETECTED · CONNECT ONE OR USE ANOTHER DEVICE',
    denied: 'CAMERA BLOCKED · ALLOW ACCESS IN BROWSER SETTINGS',
    busy: 'CAMERA BUSY · CLOSE OTHER CAMERA APPS AND RETRY',
    unknown: 'CAMERA COULDN’T START · TRY CHROME OR SAFARI',
  };
  const statusCopy = cameraIssue && (cameraState === 'error' || cameraState === 'idle')
    ? cameraIssueCopy[cameraIssue]
    : cameraState === 'requesting'
      ? 'WAITING FOR CAMERA PERMISSION'
      : cameraState === 'live'
      ? depthState === 'loading'
        ? depthProgress !== null && depthProgress > 0
          ? `CAMERA LIVE · LOADING AI DEPTH ${depthProgress}%`
          : 'CAMERA LIVE · STARTING AI DEPTH…'
        : depthState === 'warming'
          ? 'CAMERA LIVE · VERIFYING AI INFERENCE…'
        : depthState === 'fallback'
          ? `AI DEPTH ERROR · ${summarizeDepthError(depthError ?? '')}`
          : depthState === 'ready-cpu' && depthMode === 'ai'
            ? 'CAMERA LIVE · AI DEPTH COMPATIBILITY MODE'
          : depthMode === 'ai'
            ? 'CAMERA LIVE · AI DEPTH ON DEVICE'
            : 'CAMERA LIVE · CLASSIC RELIEF'
      : cameraState === 'captured'
        ? 'CAPTURED · CAMERA OFF'
        : cameraState === 'error'
          ? 'CAMERA UNAVAILABLE · DEMO MODE ACTIVE'
          : 'PROCEDURAL FIELD · CAMERA OFF';

  return (
    <main className="experience-shell">
      <div className="grain" aria-hidden="true" />

      <header className="topbar">
        <a className="brand" href="#top" aria-label="Pinform home">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>PINFORM</span>
          <small>LIVE KINETIC STUDY</small>
        </a>
        <div className="privacy-note">
          <span className={`status-dot ${cameraState === 'live' ? 'is-live' : ''}`} />
          PRIVATE BY DESIGN · YOUR CAMERA NEVER LEAVES THIS DEVICE
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
          <div className="stage-label stage-label-left">GPU RELIEF FIELD</div>
          <div className="stage-label stage-label-right">6,144 SILVER PINS · LIVE WEBGL</div>
          <div className={`live-badge ${cameraActive ? 'is-visible' : ''} ${captured ? 'is-captured' : ''}`}><span /> {captured ? 'CAPTURED' : 'LIVE'}</div>
          <div className={`rotate-hint ${captured ? 'is-visible' : ''}`}>DRAG TO ROTATE · ARROW KEYS TO NUDGE</div>
        </div>

        <aside className={`control-card ${cameraActive ? 'camera-active' : ''}`} aria-label="Sculpture controls">
          <div className="control-head">
            <span className="control-number">01</span>
            <div>
              <p className="control-kicker">INPUT SOURCE</p>
              <h2>{captured ? 'Turn it. Inspect the relief.' : cameraActive ? 'Shape the impression.' : 'See yourself in silver.'}</h2>
            </div>
          </div>

          {!cameraActive && needsBrowserHandoff ? (
            <button className="camera-button" type="button" onClick={copyCameraLink}>
              <span className="camera-icon" aria-hidden="true" />
              {linkCopied ? 'LINK COPIED' : 'COPY LINK FOR A CAMERA DEVICE'}
            </button>
          ) : !cameraActive ? (
            <button className="camera-button" type="button" onClick={enableCamera} disabled={cameraState === 'requesting'}>
              <span className="camera-icon" aria-hidden="true" />
              {cameraState === 'requesting' ? 'REQUESTING ACCESS…' : 'ENABLE CAMERA'}
            </button>
          ) : cameraState === 'live' ? (
            <div className="action-grid">
              <button className="mode-button capture-action" type="button" onClick={captureImprint}>CAPTURE IMPRINT</button>
              <button className="mode-button" type="button" onClick={() => sculptureRef.current?.pulse()}>PULSE FIELD</button>
            </div>
          ) : (
            <div className="action-grid">
              <button className="mode-button capture-action" type="button" onClick={enableCamera}>RETAKE</button>
              <button className="mode-button" type="button" onClick={() => sculptureRef.current?.resetView()}>RESET VIEW</button>
            </div>
          )}

          <div className={`options-panel ${cameraActive ? 'is-visible' : ''}`}>
            <button className="options-toggle" type="button" aria-label="Show sculpture options">
              <span>OPTIONS</span><small>FOCUS TO ADJUST</small>
            </button>
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
                    ? 'RETAKE FOR AI'
                    : depthState === 'fallback'
                      ? 'RETRY AI DEPTH'
                      : depthState === 'loading'
                        ? 'AI LOADING…'
                        : depthState === 'warming'
                          ? 'AI CHECKING…'
                          : 'AI DEPTH'}
                </button>
                <button type="button" className={depthMode === 'classic' ? 'is-active' : ''} onClick={() => setDepthMode('classic')}>CLASSIC</button>
              </div>
              <label>
                <span>RELIEF</span><output>{Math.round(relief * 100)}</output>
                <input type="range" min="0.55" max="2" step="0.05" value={relief} onChange={(event) => setRelief(Number(event.target.value))} />
              </label>
              <label>
                <span>{depthMode === 'ai' ? 'FACIAL DETAIL' : 'EDGE DETAIL'}</span><output>{Math.round(detail * 100)}</output>
                <input type="range" min="0" max="5" step="0.05" value={detail} onChange={(event) => setDetail(Number(event.target.value))} />
              </label>
              <div className="micro-actions">
                <button type="button" className={inverted ? 'is-active' : ''} onClick={() => setInverted((value) => !value)}>INVERT DEPTH</button>
                <button type="button" onClick={stopCamera}>STOP CAMERA</button>
              </div>
            </div>
          </div>

          <p className={`camera-status ${cameraState === 'error' || depthState === 'fallback' ? 'is-error' : ''}`} role="status" aria-live="polite">
            <span /> {statusCopy}
          </p>
          <p className="control-caption">
            {needsBrowserHandoff
              ? 'No camera input is available here. Connect a webcam, use Continuity Camera, or open this link on a device with a camera.'
              : 'AI depth runs here in your browser. Capture stops the camera and keeps the silver relief on this device.'}
          </p>

          <details className="diagnostics-panel">
            <summary><span>DIAGNOSTICS</span><small>{diagnostics.length} EVENTS</small></summary>
            <div className="diagnostics-body">
              <pre aria-label="Pinform diagnostic log">
                {diagnostics.slice(-14).map(({ elapsedMs, message, details }) => (
                  `[${(elapsedMs / 1000).toFixed(3)}s] ${message}${details ? ` · ${details}` : ''}`
                )).join('\n') || 'Waiting for diagnostic events…'}
              </pre>
              <button type="button" onClick={copyDiagnostics}>
                {diagnosticsCopyState === 'copied'
                  ? 'DIAGNOSTICS COPIED'
                  : diagnosticsCopyState === 'failed'
                    ? 'COPY FAILED · SELECT LOG ABOVE'
                    : 'COPY DIAGNOSTICS'}
              </button>
              <p>DEVICE CAPABILITIES AND ERRORS ONLY · NO CAMERA IMAGES</p>
            </div>
          </details>
        </aside>
      </section>

      <footer className="footer-line">
        <span>{captured ? 'DRAG TO ROTATE · TAP TO PULSE' : cameraState === 'live' ? 'CLICK PINS TO CAPTURE' : 'MOVE TO DISTURB · TAP TO PULSE'}</span>
        <button type="button" onClick={() => sculptureRef.current?.pulse()} aria-label="Pulse the pin field">↓</button>
        <span>BUILT WITH WEBGL</span>
      </footer>
    </main>
  );
}
