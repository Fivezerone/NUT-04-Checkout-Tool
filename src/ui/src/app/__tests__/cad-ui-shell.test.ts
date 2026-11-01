import { describe, expect, it } from 'vitest'
import { getCadNavigationIds } from '../../cad/navigation'

describe('CAD role-aware application shell', () => {
  it('limits the patient navigation surface to the care summary', () => {
    expect(getCadNavigationIds('patient')).toEqual(['overview'])
  })

  it('gives a writing clinician the clinical workflow but no administrative controls', () => {
    const navigation = getCadNavigationIds('writing_clinician')

    expect(navigation).toEqual(['overview', 'targets', 'modes', 'consent'])
    expect(navigation).not.toContain('users')
    expect(navigation).not.toContain('billing')
  })

  it('keeps commercial reporting aggregate-only', () => {
    expect(getCadNavigationIds('commercial_stakeholder')).toEqual(['overview'])
  })

  it('gives platform administrators the explicit tenant portfolio entry', () => {
    expect(getCadNavigationIds('super_admin')).toContain('platform')
  })
})
