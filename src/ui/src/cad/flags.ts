/**
 * src/ui/src/cad/flags.ts
 *
 * Feature flag evaluation for Clinic Admin Dashboard (CAD).
 * Reference: Blueprint §3.5, §5.1 (Appendix B)
 * Flags: ns.cad.strict_states, ns.cad.bff_client
 */

export const CAD_FLAG_DEFAULTS: Record<string, boolean> = {
  'ns.cad.strict_states': false,
  'ns.cad.bff_client': false,
  'ns.sse': false,
}

let inMemoryOverrides: Record<string, boolean> = {}

/**
 * Checks whether a named CAD feature flag is currently active.
 * Precedence:
 *   1. Explicit in-memory override (test runner / developer toggle)
 *   2. Global window/globalThis.__NUTRI_FLAGS__ injected manifest
 *   3. sessionStorage 'ns_flags' JSON cache
 *   4. Safe bundle default (false)
 */
export function isCadFlagEnabled(flagName: string): boolean {
  if (flagName in inMemoryOverrides) {
    return inMemoryOverrides[flagName]
  }

  if (typeof globalThis !== 'undefined' && (globalThis as any).__NUTRI_FLAGS__?.[flagName] !== undefined) {
    return Boolean((globalThis as any).__NUTRI_FLAGS__[flagName])
  }

  if (typeof sessionStorage !== 'undefined') {
    try {
      const stored = sessionStorage.getItem('ns_flags')
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed && typeof parsed[flagName] === 'boolean') {
          return parsed[flagName]
        }
      }
    } catch (err) {
      console.warn('[Flags] Failed to parse sessionStorage ns_flags:', err)
    }
  }

  return CAD_FLAG_DEFAULTS[flagName] ?? false
}

/** Set or clear in-memory test overrides */
export function setCadFlagOverride(flagName: string, value: boolean | null): void {
  if (value === null) {
    delete inMemoryOverrides[flagName]
  } else {
    inMemoryOverrides[flagName] = value
  }
}

/** Reset all test overrides */
export function resetCadFlagOverrides(): void {
  inMemoryOverrides = {}
}
