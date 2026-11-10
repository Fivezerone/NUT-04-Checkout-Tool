import { execSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '..')

try {
  let lines = []
  try {
    try {
      execSync('git config --global --add safe.directory "*"', { stdio: 'ignore' })
    } catch (_err) {
      // Ignored: best-effort safe.directory configuration
    }
    const output = execSync('git ls-files', {
      encoding: 'utf-8',
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    lines = output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    // If not a git repo (e.g. Docker target:ci where .git is excluded by .dockerignore),
    // check that no secrets were baked into the build context.
    function walk(dir) {
      let entries
      try {
        entries = readdirSync(dir)
      } catch (_err) {
        return
      }
      for (const entry of entries) {
        if (entry === 'node_modules' || entry === '.git') continue
        const full = resolve(dir, entry)
        let st
        try {
          st = statSync(full)
        } catch {
          continue
        }
        if (st.isDirectory()) {
          walk(full)
        } else {
          lines.push(full.slice(repoRoot.length + 1).replace(/\\/g, '/'))
        }
      }
    }
    walk(repoRoot)
  }

  const violatingFiles = lines.filter((line) => {
    return /(^|\/)\.env($|\.)(?!example)/.test(line) || /^supabase\/\.temp\//.test(line)
  })

  if (violatingFiles.length > 0) {
    console.error('Found tracked secrets:', violatingFiles)
    process.exit(1)
  }
  console.log('No secrets tracked.')
} catch (err) {
  console.error(err)
  process.exit(1)
}
