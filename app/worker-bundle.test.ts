import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('loads the depth worker from the separately built browser runtime', () => {
  const source = readFileSync(new URL('./pin-sculpture.tsx', import.meta.url), 'utf8');

  assert.match(source, /new URL\(\s*['"]depth-runtime\/depth-worker\.js['"],\s*new URL\(import\.meta\.env\.BASE_URL, window\.location\.origin\),?\s*\)/);
  assert.match(source, /new Worker\(depthWorkerUrl, \{ type: ['"]module['"] \}\)/);
  assert.doesNotMatch(source, /depth-worker\?worker/);
});
