import { cpSync, mkdirSync, copyFileSync, existsSync } from 'node:fs'

const extOutDir = 'dist/extension'

mkdirSync(extOutDir, { recursive: true })
cpSync('src/extension', extOutDir, {
  recursive: true,
  filter: (src) => !src.endsWith('.xlsx') && !src.includes('data\\') && !src.includes('data/'),
})
mkdirSync(`${extOutDir}/data`, { recursive: true })
const dataFiles = ['quickmart_products.json', 'naivas_products.json', 'carrefour_products.json']
for (const file of dataFiles) {
  if (existsSync(`src/extension/data/${file}`)) {
    copyFileSync(`src/extension/data/${file}`, `${extOutDir}/data/${file}`)
  }
}
console.log(
  '[build-ext] Extension files copied to dist/extension with catalog JSON fallback seeds.',
)
