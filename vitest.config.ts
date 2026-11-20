import { defineConfig } from 'vitest/config'
import path from 'path'
import preact from '@preact/preset-vite'

export default defineConfig({
  plugins: [preact()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/ui/src'),
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/compat/jsx-runtime',
      'react/jsx-dev-runtime': 'preact/compat/jsx-dev-runtime',
      'preact/jsx-runtime': 'preact/compat/jsx-runtime',
      'preact/jsx-dev-runtime': 'preact/compat/jsx-dev-runtime',
      'lucide-react': path.resolve(__dirname, 'node_modules/lucide-react/dist/esm/lucide-react.js'),
    },
  },
  ssr: {
    noExternal: ['lucide-react'],
  },
  test: {
    environment: 'node',
    server: {
      deps: {
        inline: ['lucide-react'],
      },
    },
  },
})
