# Pinform

A GPU-powered silver pin-art toy that turns a live camera feed into a rotatable metallic relief. AI depth estimation runs in the browser; camera frames are never uploaded.

## Run locally

```bash
npm install
npm run dev
```

Camera access requires `localhost` or HTTPS. The first AI-depth run downloads the on-device model and may take a moment to warm up.

## Verify and build

```bash
npm run check
npm run build
```

The static production site is written to `dist/`. Pushes to `main` deploy it to GitHub Pages through `.github/workflows/deploy-pages.yml`.
