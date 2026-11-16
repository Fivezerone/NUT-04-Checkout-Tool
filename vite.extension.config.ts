import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/ui',
  base: './',
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
    outDir: '../../dist/extension',
    emptyOutDir: false,
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, 'src/ui/popup.html'),
        dashboard: path.resolve(__dirname, 'src/ui/dashboard.html'),
        options: path.resolve(__dirname, 'src/ui/options.html'),
        sidepanel: path.resolve(__dirname, 'src/ui/sidepanel.html'),
      },
    },
  },
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
