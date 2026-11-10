import { defineConfig, type Plugin } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

// Dev middleware plugin to route /cad or /cad/ to /cad.html
const cadDevRoutingPlugin = (): Plugin => ({
  name: 'cad-dev-routing',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url === '/cad' || req.url === '/cad/') {
        req.url = '/cad.html'
      }
      next()
    })
  },
})

export default defineConfig({
  root: 'src/ui',
  base: './',
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/rest/v1': {
        target: 'http://localhost:8080/api',
        changeOrigin: true,
        rewrite: (pathStr) => pathStr.replace(/^\/rest\/v1/, ''),
      },
    },
  },
  // envDir must be set explicitly: when root='src/ui', Vite defaults envDir
  // to src/ui/ and won't find the .env at the project root.
  envDir: __dirname,
  plugins: [react({ jsxRuntime: 'classic' }), tailwindcss(), cadDevRoutingPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/ui/src'),
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime',
      'react/jsx-dev-runtime': 'preact/jsx-runtime',
    },
  },
  build: {
    outDir: '../../dist/extension',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, 'src/ui/popup.html'),
        dashboard: path.resolve(__dirname, 'src/ui/dashboard.html'),
        options: path.resolve(__dirname, 'src/ui/options.html'),
        cad: path.resolve(__dirname, 'src/ui/cad.html'),
      },
    },
  },
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
