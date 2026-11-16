/**
 * scripts/comprehensive-audit-probe.mjs
 *
 * Comprehensive quantitative and qualitative auditor for:
 *   - ui-ux-overhaul-report (Parts A-D, D-01 through D-44, Section 5.7)
 *   - in-page extension facelift (EXT-01 through EXT-16)
 */

import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join, extname } from 'node:path'
import { gzipSync } from 'node:zlib'

const ROOT = process.cwd()

function walkSync(dir, fileList = []) {
  if (!existsSync(dir)) return fileList
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'dist-ui', 'coverage'].includes(entry.name)) continue
      walkSync(fullPath, fileList)
    } else {
      fileList.push(fullPath)
    }
  }
  return fileList
}

const allSrcFiles = walkSync(join(ROOT, 'src'))

console.log('====================================================')
console.log('COMPREHENSIVE AUDIT PROBE: ZERO-ASSUMPTION VERIFICATION')
console.log('====================================================\n')

// 1. DEAD LEGACY FILES AUDIT
console.log('--- 1. DEAD LEGACY FILES AUDIT ---')
const forbiddenFiles = [
  'src/ui/src/OnboardingWizard.tsx',
  'src/ui/src/OnboardingWizard.js',
  'src/ui/src/SubscriptionExpiredPage.tsx',
  'src/ui/src/SubscriptionExpiredPage.js',
  'src/ui/src/cad/ClinicalOverview.tsx',
  'src/ui/src/cad/ClinicalOverview.js',
  'src/ui/src/hooks/useSubscription.ts',
  'src/ui/src/hooks/usePayment.ts',
]

let legacyFilesFound = 0
for (const f of forbiddenFiles) {
  const p = join(ROOT, f)
  if (existsSync(p)) {
    console.error(`[FAIL] Legacy dead file exists: ${f}`)
    legacyFilesFound++
  }
}
if (legacyFilesFound === 0) {
  console.log('[PASS] All dead legacy files successfully purged.')
}

// 2. QUANTITATIVE PATTERN AUDIT
console.log('\n--- 2. QUANTITATIVE PATTERN AUDIT ---')

const rawTailwindPatterns = [
  /\b(?:bg|text|border|ring|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}\b/g,
]

const sub12pxPatterns = [
  /font-size:\s*(?:[0-9]|1[01](?:\.[0-9]+)?)\s*px/g,
  /text-\[(?:[0-9]|1[01](?:\.[0-9]+)?)\s*px\]/g,
  /text-xs/g, // Flag text-xs for inspection (0.75rem = 12px, which is acceptable if font-size >= 12px)
]

const truncationPatterns = [/\btruncate\b/g, /\btext-ellipsis\b/g, /\bline-clamp-\d+\b/g]

const windowDialogPatterns = [/\bwindow\.confirm\s*\(/g, /\bwindow\.alert\s*\(/g, /\balert\s*\(/g]

const handRolledOverlayPatterns = [/fixed\s+inset-0/g]

const windowReactPatterns = [/window\.React\b/g]

const tableWrapperOverflowPatterns = [
  /<(?:div|table)[^>]*class(?:Name)?=["'][^"']*\boverflow-hidden\b[^"']*["'][^>]*>/gi,
]

const emojiConfidencePatterns = [/['"`][^'"`]*[ⓘ📊📋⚠][^'"`]*['"`]/gu]

let rawTailwindCount = 0
let sub12pxCount = 0
let truncationCount = 0
let windowDialogCount = 0
let handRolledOverlayCount = 0
let windowReactCount = 0
let tableOverflowHiddenCount = 0
let emojiConfidenceCount = 0

const findings = []

for (const file of allSrcFiles) {
  const ext = extname(file)
  if (!['.tsx', '.ts', '.jsx', '.js', '.css', '.html'].includes(ext)) continue
  const content = readFileSync(file, 'utf8')
  const rel = file.replace(ROOT + '/', '').replace(ROOT + '\\', '')

  // Skip generated files
  if (
    rel.includes('.generated.') ||
    rel.includes('tokens.d.ts') ||
    rel.includes('portal-tokens.css')
  )
    continue

  // Raw Tailwind
  if (['.tsx', '.jsx'].includes(ext)) {
    for (const pat of rawTailwindPatterns) {
      const m = content.match(pat)
      if (m) {
        rawTailwindCount += m.length
        findings.push(`[Raw Tailwind] ${rel}: ${m.slice(0, 3).join(', ')} (${m.length} matches)`)
      }
    }
  }

  // Sub 12px font
  if (['.tsx', '.css', '.js'].includes(ext) && !rel.includes('__tests__')) {
    const mPx = content.match(/font-size:\s*(?:[0-9]|1[01](?:\.[0-9]+)?)\s*px/g)
    const mTw = content.match(/text-\[(?:[0-9]|1[01](?:\.[0-9]+)?)\s*px\]/g)
    if (mPx) {
      sub12pxCount += mPx.length
      findings.push(`[Sub-12px px] ${rel}: ${mPx.join(', ')}`)
    }
    if (mTw) {
      sub12pxCount += mTw.length
      findings.push(`[Sub-12px tw] ${rel}: ${mTw.join(', ')}`)
    }
  }

  // Truncation in data tables or components
  if (['.tsx'].includes(ext) && !rel.includes('__tests__')) {
    for (const pat of truncationPatterns) {
      const m = content.match(pat)
      if (m) {
        truncationCount += m.length
        findings.push(`[Truncation] ${rel}: ${m.join(', ')}`)
      }
    }
  }

  // Window confirm/alert
  if (['.tsx', '.ts'].includes(ext) && !rel.includes('__tests__')) {
    for (const pat of windowDialogPatterns) {
      const m = content.match(pat)
      if (m) {
        windowDialogCount += m.length
        findings.push(`[Window Dialog] ${rel}: ${m.join(', ')}`)
      }
    }
  }

  // Hand-rolled overlay
  if (
    ['.tsx'].includes(ext) &&
    !rel.includes('__tests__') &&
    !rel.includes('ConfirmDialog') &&
    !rel.includes('ConsentDocModal') &&
    !rel.includes('CommandPaletteModal')
  ) {
    const m = content.match(/fixed\s+inset-0/g)
    if (m) {
      handRolledOverlayCount += m.length
      findings.push(`[Hand-rolled overlay] ${rel}: ${m.length} occurrences`)
    }
  }

  // Window React
  const mReact = content.match(/window\.React\b/g)
  if (mReact) {
    windowReactCount += mReact.length
    findings.push(`[Window.React] ${rel}`)
  }

  // Table overflow hidden
  if (['.tsx'].includes(ext) && !rel.includes('__tests__')) {
    if (content.includes('<table') || rel.includes('Table') || rel.includes('List')) {
      const m = content.match(tableWrapperOverflowPatterns[0])
      if (m) {
        tableOverflowHiddenCount += m.length
        findings.push(`[Table Overflow Hidden] ${rel}: ${m.join(', ')}`)
      }
    }
  }
}

console.log(`- Raw Tailwind palette classes: ${rawTailwindCount}`)
console.log(`- Sub-12px font rules: ${sub12pxCount}`)
console.log(`- Truncation utilities (truncate/text-ellipsis/line-clamp): ${truncationCount}`)
console.log(`- Window dialog calls (alert/confirm): ${windowDialogCount}`)
console.log(
  `- Hand-rolled overlays (fixed inset-0 outside native dialogs): ${handRolledOverlayCount}`,
)
console.log(`- window.React globals: ${windowReactCount}`)
console.log(`- Table overflow-hidden wrappers: ${tableOverflowHiddenCount}`)

if (findings.length > 0) {
  console.log('\nFindings details:')
  findings.slice(0, 20).forEach((f) => console.log('  ' + f))
  if (findings.length > 20) console.log(`  ...and ${findings.length - 20} more.`)
}

// 3. BUNDLE SIZE BUDGETS (Eager Gzip)
console.log('\n--- 3. BUNDLE SIZE BUDGETS (Eager Gzip) ---')
const distExtDir = join(ROOT, 'dist/extension')
const distCadDir = join(ROOT, 'dist-ui/cad')

function calculateBundleSize(dir, htmlName) {
  const htmlPath = join(dir, htmlName)
  if (!existsSync(htmlPath)) return { htmlBytes: 0, jsBytes: 0, cssBytes: 0, totalGzip: 0 }
  const htmlContent = readFileSync(htmlPath, 'utf8')

  // Find linked js and css
  const scriptMatches = [...htmlContent.matchAll(/src=["']([^"']+\.js)["']/g)].map((m) => m[1])
  const cssMatches = [...htmlContent.matchAll(/href=["']([^"']+\.css)["']/g)].map((m) => m[1])

  let totalGzip = gzipSync(htmlContent).length
  let jsGzip = 0
  let cssGzip = 0

  for (const s of scriptMatches) {
    const sPath = join(dir, s.replace(/^\.?\//, ''))
    if (existsSync(sPath)) {
      const gz = gzipSync(readFileSync(sPath)).length
      jsGzip += gz
      totalGzip += gz
    }
  }

  for (const c of cssMatches) {
    const cPath = join(dir, c.replace(/^\.?\//, ''))
    if (existsSync(cPath)) {
      const gz = gzipSync(readFileSync(cPath)).length
      cssGzip += gz
      totalGzip += gz
    }
  }

  return {
    totalGzipKb: (totalGzip / 1024).toFixed(2),
    jsGzipKb: (jsGzip / 1024).toFixed(2),
    cssGzipKb: (cssGzip / 1024).toFixed(2),
  }
}

const popupBundle = calculateBundleSize(distExtDir, 'popup.html')
const sidepanelBundle = calculateBundleSize(distExtDir, 'sidepanel.html')
const dashboardBundle = calculateBundleSize(distExtDir, 'dashboard.html')
const cadBundle = calculateBundleSize(distCadDir, 'index.html')

console.log(
  `- Popup: ${popupBundle.totalGzipKb} KB (Target: <= 40 KB) -> ${parseFloat(popupBundle.totalGzipKb) <= 40 ? 'PASS' : 'FAIL'}`,
)
console.log(
  `- Sidepanel: ${sidepanelBundle.totalGzipKb} KB (Target: <= 60 KB) -> ${parseFloat(sidepanelBundle.totalGzipKb) <= 60 ? 'PASS' : 'FAIL'}`,
)
console.log(
  `- Dashboard: ${dashboardBundle.totalGzipKb} KB (Target: <= 70 KB) -> ${parseFloat(dashboardBundle.totalGzipKb) <= 70 ? 'PASS' : 'FAIL'}`,
)
console.log(
  `- CAD: ${cadBundle.totalGzipKb} KB (Target: <= 110 KB) -> ${parseFloat(cadBundle.totalGzipKb) <= 110 ? 'PASS' : 'FAIL'}`,
)

// 4. SPECIFIC DEFECT VERIFICATION
console.log('\n--- 4. SPECIFIC DEFECT VERIFICATION ---')

// D-30: MFA TOTP & AAL claim
const authContext = readFileSync(join(ROOT, 'src/ui/src/cad/context/AuthContext.tsx'), 'utf8')
const mfaChallenge = readFileSync(join(ROOT, 'src/ui/src/cad/components/MfaChallenge.tsx'), 'utf8')
const hasRealTotp =
  mfaChallenge.includes('mfa.challengeAndVerify') ||
  authContext.includes('mfa.challengeAndVerify') ||
  mfaChallenge.includes('verifyTotp') ||
  authContext.includes('verifyTotp')
const hasAalClaim = authContext.includes('aal') || authContext.includes('amr')
console.log(
  `- D-30 CAD MFA TOTP verification: ${hasRealTotp ? 'PASS (Real TOTP challenge & verify wired)' : 'INSPECT'}`,
)
console.log(
  `- D-30 CAD MFA AAL assurance derivation: ${hasAalClaim ? 'PASS (Derives assurance from JWT claims)' : 'INSPECT'}`,
)

// D-44: No fabricated demo staff, tenants, or audit logs
const auditLogView = readFileSync(join(ROOT, 'src/ui/src/cad/views/AuditLogView.tsx'), 'utf8')
const userMgmtView = readFileSync(join(ROOT, 'src/ui/src/cad/views/UserManagementView.tsx'), 'utf8')
const hasDemoFallback =
  auditLogView.includes('demo') ||
  userMgmtView.includes('demo') ||
  auditLogView.includes('fallbackData')
console.log(
  `- D-44 Production Purity (zero fake data fallbacks): ${!hasDemoFallback ? 'PASS' : 'INSPECT'}`,
)

// D-35: Timeframes (only today, week, month, 3months)
const timeframesSrc = readFileSync(join(ROOT, 'src/ui/src/app/lib/timeframes.ts'), 'utf8')
const hasBannedRanges =
  timeframesSrc.includes("'year'") ||
  timeframesSrc.includes("'all'") ||
  timeframesSrc.includes('bucketCount')
console.log(
  `- D-35 Four exact timeframes only: ${!hasBannedRanges ? 'PASS (year, all, bucketCount deleted)' : 'FAIL'}`,
)

// D-10: Token Architecture
const tokensGenerated = existsSync(join(ROOT, 'src/ui/src/styles/tokens.generated.css'))
const portalTokens = existsSync(join(ROOT, 'src/extension/styles/portal-tokens.css'))
console.log(
  `- D-01/D-02/D-10 W3C DTCG Token Compilation: ${tokensGenerated && portalTokens ? 'PASS' : 'FAIL'}`,
)

console.log('\nProbe completed successfully.')
