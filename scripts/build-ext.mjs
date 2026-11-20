import { cpSync, mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

const targetDirs = ['dist/extension', 'dist-ui/extension']

for (const extOutDir of targetDirs) {
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

  // Build-time injection for config.js to prevent placeholders or local endpoints leaking to dist
  const configPath = `${extOutDir}/config.js`
  if (existsSync(configPath)) {
    let configContent = readFileSync(configPath, 'utf8')
    const defaultApiUrl = 'https://api.nutriscore.co.ke'
    const defaultOidcIssuer = 'https://auth.nutriscore.co.ke/realms/nutriscore'

    const envApiUrl =
      process.env.VITE_API_URL &&
      !process.env.VITE_API_URL.includes('localhost') &&
      !process.env.VITE_API_URL.includes('127.0.0.1')
        ? process.env.VITE_API_URL
        : defaultApiUrl

    const envOidcIssuer =
      process.env.VITE_OIDC_ISSUER &&
      !process.env.VITE_OIDC_ISSUER.includes('localhost') &&
      !process.env.VITE_OIDC_ISSUER.includes('127.0.0.1')
        ? process.env.VITE_OIDC_ISSUER
        : defaultOidcIssuer

    configContent = configContent.replace('__VITE_API_URL__', envApiUrl)
    configContent = configContent.replace('__VITE_OIDC_ISSUER__', envOidcIssuer)
    writeFileSync(configPath, configContent, 'utf8')
  }
}

// Mirror compiled UI bundle into dist-ui/extension if available
if (existsSync('dist/extension/assets') && existsSync('dist-ui/extension')) {
  cpSync('dist/extension/assets', 'dist-ui/extension/assets', { recursive: true })
  const htmlPages = ['popup.html', 'dashboard.html', 'options.html', 'sidepanel.html']
  for (const p of htmlPages) {
    if (existsSync(`dist/extension/${p}`)) {
      copyFileSync(`dist/extension/${p}`, `dist-ui/extension/${p}`)
    }
  }
}

console.log(
  '[build-ext] Extension files copied to dist/extension and dist-ui/extension with catalog JSON fallback seeds.',
)
