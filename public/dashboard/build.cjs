const esbuild = require('esbuild');

function requireEnv(name) {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing required env var: ${name}. Refusing to build firebase-sync.bundle.js without it.`);
  }
  return val;
}

esbuild.build({
  entryPoints: ['src/extension/firebase-sync.js'],
  bundle: true,
  outfile: 'src/extension/firebase-sync.bundle.js',
  format: 'iife',
  target: ['chrome96'],
  minify: true,
  logLevel: 'info',
  define: {
    'process.env.FIREBASE_API_KEY': JSON.stringify(requireEnv('FIREBASE_API_KEY')),
    'process.env.FIREBASE_AUTH_DOMAIN': JSON.stringify(requireEnv('FIREBASE_AUTH_DOMAIN')),
    'process.env.FIREBASE_PROJECT_ID': JSON.stringify(requireEnv('FIREBASE_PROJECT_ID')),
    'process.env.FIREBASE_STORAGE_BUCKET': JSON.stringify(requireEnv('FIREBASE_STORAGE_BUCKET')),
    'process.env.FIREBASE_MESSAGING_SENDER_ID': JSON.stringify(requireEnv('FIREBASE_MESSAGING_SENDER_ID')),
    'process.env.FIREBASE_APP_ID': JSON.stringify(requireEnv('FIREBASE_APP_ID')),
  }
}).catch(() => process.exit(1));
