import { defineConfig } from 'vite';

export default defineConfig({
  base: '/pinform/depth-runtime/',
  build: {
    assetsInlineLimit: 0,
    copyPublicDir: false,
    emptyOutDir: true,
    outDir: 'public/depth-runtime',
    target: 'es2022',
    rollupOptions: {
      input: 'app/depth-worker.ts',
      output: {
        assetFileNames: '[name]-[hash][extname]',
        entryFileNames: 'depth-worker.js',
      },
    },
  },
});
