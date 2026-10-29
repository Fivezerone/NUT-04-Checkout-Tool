import { cpSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'

mkdirSync('dist', { recursive: true })
cpSync('src/extension', 'dist', {
  recursive: true,
  filter: (src) => !src.endsWith('.xlsx') && !src.includes('data\\') && !src.includes('data/'),
})
mkdirSync('dist/data', { recursive: true })
const dataFiles = ['quickmart_products.json', 'naivas_products.json', 'carrefour_products.json']
for (const file of dataFiles) {
  if (existsSync(`src/extension/data/${file}`)) {
    copyFileSync(`src/extension/data/${file}`, `dist/data/${file}`)
  }
}
console.log('[build-ext] Extension files copied to dist with catalog JSON fallback seeds.')
