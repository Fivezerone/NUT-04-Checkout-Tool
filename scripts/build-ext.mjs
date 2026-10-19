import { cpSync, mkdirSync } from 'node:fs'

mkdirSync('dist', { recursive: true })
cpSync('src/extension', 'dist', {
  recursive: true,
  filter: (src) => !src.endsWith('.xlsx') && !src.includes('data\\') && !src.includes('data/'),
})
console.log('[build-ext] Extension files copied to dist, skipping .xlsx and data/ JSON datasets.')
