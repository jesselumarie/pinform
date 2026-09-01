import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const packageJson = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const viteConfig = readFileSync(new URL('vite.config.ts', root), 'utf8');
const depthViteConfig = readFileSync(new URL('vite.depth-worker.config.ts', root), 'utf8');
const workflow = readFileSync(new URL('.github/workflows/deploy-pages.yml', root), 'utf8');
const index = readFileSync(new URL('index.html', root), 'utf8');

test('builds as a static Vite app under the GitHub Pages project path', () => {
  assert.equal(packageJson.name, 'pinform');
  assert.equal(packageJson.scripts.build, 'npm run build:depth && vite build');
  assert.match(viteConfig, /base: ['"]\/pinform\/['"]/);
  assert.match(depthViteConfig, /base: ['"]\/pinform\/depth-runtime\/['"]/);
  assert.match(viteConfig, /react\(\)/);
  assert.match(index, /<div id="root"><\/div>/);
  assert.match(index, /<script type="module" src="\/app\/main\.tsx"><\/script>/);
});

test('deploys the built dist directory with the official Pages actions', () => {
  assert.match(workflow, /actions\/configure-pages@v5/);
  assert.match(workflow, /actions\/upload-pages-artifact@v4/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /path: ['"]?\.\/dist/);
});
