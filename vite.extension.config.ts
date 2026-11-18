import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import preact from '@preact/preset-vite'

export default defineConfig({
  root: 'src/ui',
  base: './',
  envDir: __dirname,
  plugins: [preact(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/ui/src'),
    },
  },
  build: {
    target: 'chrome116',
    outDir: '../../dist/extension',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, 'src/ui/popup.html'),
        dashboard: path.resolve(__dirname, 'src/ui/dashboard.html'),
        options: path.resolve(__dirname, 'src/ui/options.html'),
        sidepanel: path.resolve(__dirname, 'src/ui/sidepanel.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('preact')) {
              return 'preact-vendor'
            }
            if (id.includes('lucide-react')) {
              return 'lucide-vendor'
            }
          }
        },
      },
    },
  },
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
