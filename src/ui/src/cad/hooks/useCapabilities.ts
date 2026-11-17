/**
 * src/ui/src/cad/hooks/useCapabilities.ts
 *
 * React Hook for Server-Evaluated Capabilities and Dynamic Navigation.
 * Reference: Blueprint §3.5, §4.1; ADR-004, ADR-008.
 * Flag: ns.cad.bff_client
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { defaultBffClient, BffClient, type CapabilitiesResponse } from '../api/bff-client'
import { deriveNavigationFromCapabilities, getCadNavigationIds, type CadNavigationId } from '../navigation'
import { isCadFlagEnabled } from '../flags'
import type { CadRole } from '../types'

export interface UseCapabilitiesOptions {
  client?: BffClient
  role?: CadRole
  enabled?: boolean
}

export interface UseCapabilitiesResult {
  caps: string[]
  capsHash: string | null
  stepUpRequired: string[]
  tenant: { id: string; label: string } | null
  can: (capability: string) => boolean
  nav: CadNavigationId[]
  isLoading: boolean
  error: Error | null
  refresh: () => Promise<void>
}

export function useCapabilities({
  client = defaultBffClient,
  role = 'patient',
  enabled = true,
}: UseCapabilitiesOptions = {}): UseCapabilitiesResult {
  const [caps, setCaps] = useState<string[]>([])
  const [capsHash, setCapsHash] = useState<string | null>(null)
  const [stepUpRequired, setStepUpRequired] = useState<string[]>([])
  const [tenant, setTenant] = useState<{ id: string; label: string } | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<Error | null>(null)

  const isBffActive = isCadFlagEnabled('ns.cad.bff_client') && enabled

  const refresh = useCallback(async () => {
    if (!isBffActive) {
      setCaps([])
      setCapsHash(null)
      setStepUpRequired([])
      setTenant(null)
      setError(null)
      return
    }

    setIsLoading(true)
    setError(null)
    try {
      const res: CapabilitiesResponse = await client.getCapabilities()
      setCaps(res.caps || [])
      setCapsHash(res.caps_hash || null)
      setStepUpRequired(res.step_up_required || [])
      setTenant(res.tenant || null)
    } catch (err: any) {
      setError(err)
      setCaps([])
      setCapsHash(null)
      setStepUpRequired([])
      setTenant(null)
    } finally {
      setIsLoading(false)
    }
  }, [client, isBffActive])

  useEffect(() => {
    if (isBffActive) {
      void refresh()
    }
  }, [isBffActive, refresh])

  const can = useCallback(
    (capability: string): boolean => {
      if (!isBffActive) {
        // Fallback for legacy mode without BFF
        return false
      }
      return caps.includes(capability)
    },
    [isBffActive, caps],
  )

  const nav = useMemo<CadNavigationId[]>(() => {
    if (isBffActive && caps.length > 0) {
      return deriveNavigationFromCapabilities(can)
    }
    // Static fallback to role-based mapping
    return getCadNavigationIds(role)
  }, [isBffActive, caps, can, role])

  return {
    caps,
    capsHash,
    stepUpRequired,
    tenant,
    can,
    nav,
    isLoading,
    error,
    refresh,
  }
}
