// build.js
// Bundles health.js (and any other extension entry points) plus their
// node_modules imports (e.g. the Firebase SDK) into single, self-contained
// files under dist/. This is required because Manifest V3's CSP forbids
// remotely-hosted or dynamically-fetched scripts — everything the
// extension runs must ship as local, static files.

const esbuild = require('esbuild');

// Add more entry points here as the extension grows
// (e.g. a background service worker, a popup script, a content script).
const entryPoints = ['health.js'];

const isWatchMode = process.argv.includes('--watch');

const buildOptions = {
  entryPoints,
  bundle: true,           // pull in all imported modules (Firebase, etc.)
  outdir: 'dist',         // bundled output goes to dist/health.bundle.js etc.
  entryNames: '[name].bundle',
  format: 'iife',         // wrap output so it's safe to load via a plain <script> tag
  target: ['chrome96'],   // matches modern Chrome extension runtime support
  minify: !isWatchMode,   // minify for production builds, skip in watch mode for readability
  sourcemap: isWatchMode ? 'inline' : false,
  logLevel: 'info',
  define: {
    'process.env.FIREBASE_API_KEY': JSON.stringify(process.env.FIREBASE_API_KEY || 'AIzaSyB05umupSWPt96qNWaevFJnS4ovaj907Gc'),
    'process.env.FIREBASE_AUTH_DOMAIN': JSON.stringify(process.env.FIREBASE_AUTH_DOMAIN || 'nutriscore-check.firebaseapp.com'),
    'process.env.FIREBASE_PROJECT_ID': JSON.stringify(process.env.FIREBASE_PROJECT_ID || 'nutriscore-check'),
    'process.env.FIREBASE_STORAGE_BUCKET': JSON.stringify(process.env.FIREBASE_STORAGE_BUCKET || 'nutriscore-check.firebasestorage.app'),
    'process.env.FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(process.env.FIREBASE_MESSAGING_SENDER_ID || '923932588057'),
    'process.env.FIREBASE_APP_ID': JSON.stringify(process.env.FIREBASE_APP_ID || '1:923932588057:web:8575308e753659b6a85288'),
    'process.env.FIREBASE_MEASUREMENT_ID': JSON.stringify(process.env.FIREBASE_MEASUREMENT_ID || 'G-TFJ44W73CX')
  }
};

async function run() {
  if (isWatchMode) {
    // Rebuilds automatically on file changes during development
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('Watching for changes...');
  } else {
    // One-off production build
    await esbuild.build(buildOptions);
    console.log('Build complete: dist/health.bundle.js');
  }
}

run().catch((error) => {
  console.error('Build failed:', error);
  process.exit(1);
});