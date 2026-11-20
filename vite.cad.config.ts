import { defineConfig, type Plugin } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import preact from '@preact/preset-vite'

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
  base: '/',
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
  envDir: __dirname,
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(
      process.env.VITE_API_URL || 'https://api.nutriscore.co.ke/api',
    ),
    'import.meta.env.VITE_OIDC_ISSUER': JSON.stringify(
      process.env.VITE_OIDC_ISSUER || 'https://auth.nutriscore.co.ke/realms/nutriscore',
    ),
  },
  plugins: [preact(), tailwindcss(), cadDevRoutingPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/ui/src'),
    },
  },
  build: {
    target: 'es2022',
    outDir: '../../dist-ui/cad',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        cad: path.resolve(__dirname, 'src/ui/cad.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('preact')) return 'preact-vendor'
            if (id.includes('lucide-react')) return 'lucide-vendor'
          }
        },
      },
    },
  },
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
