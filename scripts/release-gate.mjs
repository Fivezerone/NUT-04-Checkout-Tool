#!/usr/bin/env node
/**
 * NutriScore CAD Phase 9 — Production Release Gate (Decision D5)
 *
 * Reference: Blueprint §4.1, Decision D5
 *
 * Verifies that all statutory compliance requirements are satisfied before
 * a production release can proceed:
 * 1. DPIA document exists (docs/compliance/dpia/DPIA-<version>.md or DPIA-draft.md).
 * 2. Counsel sign-off is recorded in compliance/launch.json.
 * 3. ODPC reference number is recorded in compliance/launch.json.
 * 4. DPIA submitted_on is at least 60 days before planned_launch_on.
 *
 * Per Decision D5 / Section 5 DOD:
 * "npm run release:check fails on this branch until the counsel items and the DPIA are real. That is correct behaviour."
 */

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

/**
 * Pure evaluation function for release gate rules.
 * @param {object} config
 * @param {object} [options]
 * @returns {object}
 */
export function evaluateReleaseGate(config, options = {}) {
  const root = options.rootDir || ROOT
  const errors = []

  if (!config) {
    return {
      passed: false,
      errors: ['Launch configuration is missing or null'],
      details: {
        dpiaExists: false,
        dpiaFile: null,
        counselSignoffPresent: false,
        odpcReferencePresent: false,
        submittedOn: null,
        plannedLaunchOn: null,
        daysBetweenSubmissionAndLaunch: null,
      },
    }
  }

  // 1. Check DPIA document existence
  const dpiaDocRelative = config.dpia?.document || 'docs/compliance/dpia/DPIA-draft.md'
  const dpiaDocPath = resolve(root, dpiaDocRelative)
  const dpiaExists = options.checkDpiaFile === false ? true : existsSync(dpiaDocPath)

  if (!dpiaExists) {
    errors.push(`DPIA document not found at: ${dpiaDocRelative}`)
  }

  // 2. Counsel sign-off check
  const counselSignoff = config.dpia?.counsel_signoff
  const counselSignoffPresent = Boolean(
    counselSignoff && counselSignoff !== 'PENDING' && counselSignoff !== null,
  )
  if (!counselSignoffPresent) {
    errors.push(
      'Missing legal counsel sign-off: dpia.counsel_signoff must be signed before release',
    )
  }

  // 3. ODPC reference check
  const odpcRef = config.dpia?.odpc_reference
  const odpcReferencePresent = Boolean(odpcRef && odpcRef !== 'PENDING' && odpcRef !== null)
  if (!odpcReferencePresent) {
    errors.push(
      'Missing ODPC reference: dpia.odpc_reference is required (filing proof with Data Protection Commissioner)',
    )
  }

  // 4. Check dates: submitted_on vs planned_launch_on (60-day rule)
  const submittedOnStr = config.dpia?.submitted_on
  const plannedLaunchOnStr = config.planned_launch_on

  let daysBetween = null

  if (!submittedOnStr) {
    errors.push('Missing DPIA submission date: dpia.submitted_on is required')
  }

  if (!plannedLaunchOnStr) {
    errors.push('Missing planned launch date: planned_launch_on is required')
  }

  if (submittedOnStr && plannedLaunchOnStr) {
    const submittedDate = new Date(submittedOnStr)
    const launchDate = new Date(plannedLaunchOnStr)

    if (isNaN(submittedDate.getTime())) {
      errors.push(`Invalid dpia.submitted_on date format: ${submittedOnStr}`)
    } else if (isNaN(launchDate.getTime())) {
      errors.push(`Invalid planned_launch_on date format: ${plannedLaunchOnStr}`)
    } else {
      const diffMs = launchDate.getTime() - submittedDate.getTime()
      daysBetween = Math.floor(diffMs / (1000 * 60 * 60 * 24))

      if (daysBetween < 60) {
        errors.push(
          `DPIA submission window insufficient: submitted_on is only ${daysBetween} days before planned_launch_on (minimum 60 days required by ODPC guidance)`,
        )
      }
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    details: {
      dpiaExists,
      dpiaFile: dpiaDocRelative,
      counselSignoffPresent,
      odpcReferencePresent,
      submittedOn: submittedOnStr || null,
      plannedLaunchOn: plannedLaunchOnStr || null,
      daysBetweenSubmissionAndLaunch: daysBetween,
    },
  }
}

/**
 * Loads launch config from filesystem and runs the release gate check.
 * @param {string} [configPath]
 * @returns {object}
 */
export function checkReleaseGate(configPath = resolve(ROOT, 'compliance/launch.json')) {
  if (!existsSync(configPath)) {
    return {
      passed: false,
      errors: [`Launch configuration file not found at: ${configPath}`],
      details: {
        dpiaExists: false,
        dpiaFile: null,
        counselSignoffPresent: false,
        odpcReferencePresent: false,
        submittedOn: null,
        plannedLaunchOn: null,
        daysBetweenSubmissionAndLaunch: null,
      },
    }
  }

  try {
    const raw = readFileSync(configPath, 'utf8')
    const config = JSON.parse(raw)
    return evaluateReleaseGate(config, { rootDir: ROOT })
  } catch (err) {
    return {
      passed: false,
      errors: [`Failed to parse launch configuration: ${err.message}`],
      details: {
        dpiaExists: false,
        dpiaFile: null,
        counselSignoffPresent: false,
        odpcReferencePresent: false,
        submittedOn: null,
        plannedLaunchOn: null,
        daysBetweenSubmissionAndLaunch: null,
      },
    }
  }
}

// CLI entry point
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('='.repeat(70))
  console.log(' NutriScore CAD — Production Release Gate (Decision D5)')
  console.log('='.repeat(70))

  const result = checkReleaseGate()

  console.log(
    `DPIA File Present:       ${result.details.dpiaExists ? 'PASS' : 'FAIL'} (${result.details.dpiaFile})`,
  )
  console.log(
    `Counsel Sign-off:        ${result.details.counselSignoffPresent ? 'PASS' : 'PENDING'}`,
  )
  console.log(
    `ODPC Filing Reference:   ${result.details.odpcReferencePresent ? 'PASS' : 'PENDING'}`,
  )
  console.log(`Submitted On:            ${result.details.submittedOn ?? 'NOT SUBMITTED'}`)
  console.log(`Planned Launch Date:     ${result.details.plannedLaunchOn ?? 'NOT SET'}`)
  if (result.details.daysBetweenSubmissionAndLaunch !== null) {
    console.log(
      `Lead Time:               ${result.details.daysBetweenSubmissionAndLaunch} days (minimum: 60 days)`,
    )
  }
  console.log('-'.repeat(70))

  if (result.passed) {
    console.log('RELEASE GATE: APPROVED FOR PRODUCTION LAUNCH')
    console.log(
      'All statutory conditions met: DPIA verified, counsel signed off, ODPC notified >= 60 days.',
    )
    process.exit(0)
  } else {
    console.warn('RELEASE GATE: BLOCKED (EXPECTED BEHAVIOUR ON THIS BRANCH)')
    console.warn(
      'The following compliance prerequisites remain unresolved before production cutover:',
    )
    for (const err of result.errors) {
      console.warn(`  - [BLOCKED] ${err}`)
    }
    console.warn('\nPer blueprint Decision D5, production deployment is halted until legal counsel')
    console.warn('signs off on the DPIA and the 60-day ODPC statutory submission window elapses.')
    process.exit(1)
  }
}
