import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDiagnostics, type DiagnosticEntry } from './diagnostics.ts';

test('formats a pasteable privacy-safe diagnostic report', () => {
  const entries: DiagnosticEntry[] = [
    { elapsedMs: 0, message: 'app.ready', details: 'camera_api=false webgpu=true' },
    { elapsedMs: 1250, message: 'depth.error', details: 'MODEL DOWNLOAD BLOCKED' },
  ];

  const report = formatDiagnostics({
    generatedAt: '2026-08-28T20:00:00.000Z',
    userAgent: 'Arc Test',
    secureContext: true,
    entries,
  });

  assert.match(report, /^PINFORM DIAGNOSTICS/m);
  assert.match(report, /secure_context=true/);
  assert.match(report, /\[1\.250s\] depth\.error · MODEL DOWNLOAD BLOCKED/);
});
