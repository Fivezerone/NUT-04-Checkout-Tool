import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/ui/src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  root: 'src/ui',
  base: './',
  plugins: [
    figmaAssetResolver(),
    react({ jsxRuntime: 'classic' }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/ui/src'),
      "react": "preact/compat",
      "react-dom": "preact/compat",
      "react/jsx-runtime": "preact/jsx-runtime",
      "react/jsx-dev-runtime": "preact/jsx-runtime",
    },
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: path.resolve(__dirname, 'src/ui/popup.html'),
        dashboard: path.resolve(__dirname, 'src/ui/dashboard.html')
      }
    }
  },
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
