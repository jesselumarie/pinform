import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const sculpture = readFileSync(new URL('./pin-sculpture.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');

test('keeps AI depth upright and anchors displaced pins', () => {
  assert.match(sculpture, /vec2 depthUv = vec2\(imprintUv\.x, 1\.0 - imprintUv\.y\)/);
  assert.match(sculpture, /float pinAnchor = clamp/);
  assert.match(sculpture, /float pinTravel = clamp/);
});

test('puts the toy first and reveals options only while focused', () => {
  assert.doesNotMatch(page, /Your reflection/);
  assert.doesNotMatch(page, /className="hero-copy"/);
  assert.match(page, /className="options-toggle"/);
  assert.match(styles, /\.options-panel:focus-within \.tuning-controls/);
});

test('uses a full-viewport stage and full-board camera mapping', () => {
  assert.match(styles, /\.sculpture-stage \{[^}]*height: 100svh/);
  assert.match(styles, /\.topbar \{[^}]*position: absolute/);
  assert.match(sculpture, /vec2 imprintUv = \(videoUv - 0\.5\)/);
  assert.match(sculpture, /uniform float uVideoAspect/);
  assert.match(sculpture, /vec2 cameraUv = imprintUv/);
  assert.match(sculpture, /float boardAspect = uBoard\.x \/ uBoard\.y/);
});

test('moves in the same screen direction and captures from the live surface', () => {
  assert.match(sculpture, /vec2 videoUv = pinUv/);
  assert.match(sculpture, /if \(streamRef\.current && capture\(\)\) return/);
  assert.match(page, /const handleCaptured = useCallback\(\(\) => setCameraState\('captured'\), \[\]\)/);
  assert.match(page, /onCaptured=\{handleCaptured\}/);
  assert.match(sculpture, /When live, click to capture/);
});

test('adds facial detail only inside the AI depth surface', () => {
  assert.match(sculpture, /float depthCurvature = depthSample - depthNeighbors \* 0\.25/);
  assert.match(sculpture, /float detailGate = smoothstep\(0\.05, 0\.26, depthSample\)/);
  assert.match(sculpture, /float cameraMicroDetail = edge \* uDetail \* 0\.58 \* uRelief/);
  assert.match(sculpture, /depthRelief \+= \(localDepthDetail \+ cameraMicroDetail\) \* detailGate/);
});

test('reserves pin travel for facial features instead of saturating the base face', () => {
  assert.doesNotMatch(sculpture, /pow\(depthSample, 0\.70 \+ uDetail/);
  assert.match(sculpture, /float depthBase = pow\(depthSample, 0\.82\) \* uRelief \* 0\.72/);
  assert.match(sculpture, /float localDepthDetail = depthCurvature \* uDetail \* 0\.95 \* uRelief/);
  assert.match(sculpture, /float cameraDetailRadius = mix\(1\.35, 0\.75, clamp\(uDetail \/ 5\.0, 0\.0, 1\.0\)\)/);
  assert.match(sculpture, /float depthRelief = depthBase \* imprintMask/);
});

test('starts facial detail at 300 and allows adjustment to 500', () => {
  assert.match(page, /const \[detail, setDetail\] = useState\(3\)/);
  assert.match(page, /<input type="range" min="0" max="5" step="0\.05" value=\{detail\}/);
  assert.match(sculpture, /float pinTravel = clamp/);
});

test('surrounds the active pins with a substantial black bezel', () => {
  assert.match(sculpture, /const bezelMaterial = new THREE\.MeshStandardMaterial/);
  assert.match(sculpture, /color: 0x020304/);
  assert.match(sculpture, /const bezelWidth = 0\.46/);
  assert.match(sculpture, /const bezelDepth = 0\.72/);
});
