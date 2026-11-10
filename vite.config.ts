import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/ui',
  base: './',
  server: {
    port: 3000,
  },
  // envDir must be set explicitly: when root='src/ui', Vite defaults envDir
  // to src/ui/ and won't find the .env at the project root.
  envDir: __dirname,
  plugins: [react({ jsxRuntime: 'classic' }), tailwindcss()],
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
    outDir: '../../dist',
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
