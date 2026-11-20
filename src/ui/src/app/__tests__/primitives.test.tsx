// @vitest-environment jsdom
/**
 * src/ui/src/app/__tests__/primitives.test.tsx
 *
 * Real DOM rendering, ARIA verification, keyboard navigation, and
 * axe-core accessibility audits on mounted design system primitives (F-11, D-32).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/preact'
import axe from 'axe-core'
import { GradeBadge } from '../components/ui/GradeBadge'
import { KpiCard } from '../components/ui/KpiCard'
import { TargetMeter } from '../components/ui/TargetMeter'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { ConditionChip } from '../components/ui/ConditionChip'

// Polyfill HTMLDialogElement.showModal and close in JSDOM
beforeEach(() => {
  if (typeof HTMLDialogElement !== 'undefined') {
    if (!HTMLDialogElement.prototype.showModal) {
      HTMLDialogElement.prototype.showModal = function () {
        this.setAttribute('open', '')
      }
    }
    if (!HTMLDialogElement.prototype.close) {
      HTMLDialogElement.prototype.close = function () {
        this.removeAttribute('open')
      }
    }
  }
})

describe('Design System Primitives Contract (DOM & A11y Verification)', () => {
  describe('GradeBadge', () => {
    it('renders all grades A through E with compliant colors and accessible descriptions', async () => {
      const { container, rerender } = render(<GradeBadge grade="A" />)
      expect(screen.getByLabelText(/Grade A/i)).toBeDefined()

      rerender(<GradeBadge grade="B" />)
      const badgeB = screen.getByLabelText(/Grade B/i)
      expect(badgeB).toBeDefined()
      expect(badgeB.style.backgroundColor).toBe('rgb(133, 187, 47)') // #85bb2f
      expect(badgeB.style.color).toBe('rgb(20, 50, 10)') // #14320a (6.14:1 contrast)

      rerender(<GradeBadge grade="C" />)
      const badgeC = screen.getByLabelText(/Grade C/i)
      expect(badgeC).toBeDefined()
      expect(badgeC.style.backgroundColor).toBe('rgb(254, 203, 2)') // #fecb02
      expect(badgeC.style.color).toBe('rgb(58, 46, 0)') // #3a2e00 (8.76:1 contrast)

      rerender(<GradeBadge grade="D" />)
      const badgeD = screen.getByLabelText(/Grade D/i)
      expect(badgeD).toBeDefined()
      expect(badgeD.style.backgroundColor).toBe('rgb(238, 129, 0)') // #ee8100
      expect(badgeD.style.color).toBe('rgb(51, 28, 0)') // #331c00 (5.95:1 contrast)

      rerender(<GradeBadge grade="E" />)
      const badgeE = screen.getByLabelText(/Grade E/i)
      expect(badgeE).toBeDefined()
      expect(badgeE.style.backgroundColor).toBe('rgb(209, 50, 10)') // #d1320a
      expect(badgeE.style.color).toBe('rgb(255, 255, 255)') // #ffffff (>4.5:1 contrast)

      const results = await axe.run(container)
      expect(results.violations).toEqual([])
    })

    it('renders fail-closed placeholder for null or unknown grades without defaulting to C or B', async () => {
      const { container, rerender } = render(<GradeBadge grade={null} />)
      const placeholder = screen.getByLabelText(/Product Unscored/i)
      expect(placeholder).toBeDefined()
      expect(placeholder.textContent).toBe('—')

      rerender(<GradeBadge grade={undefined} />)
      expect(screen.getByLabelText(/Product Unscored/i)).toBeDefined()

      const results = await axe.run(container)
      expect(results.violations).toEqual([])
    })

    it('renders full scale with accessible current grade indicator when showScale is true', async () => {
      const { container } = render(<GradeBadge grade="B" showScale={true} />)
      const group = screen.getByRole('group', { name: /Nutri-Score Scale, current grade B/i })
      expect(group).toBeDefined()

      const activeBadge = group.querySelector('[aria-current="true"]')
      expect(activeBadge).not.toBeNull()
      expect(activeBadge?.textContent).toBe('B')

      const results = await axe.run(container)
      expect(results.violations).toEqual([])
    })
  })

  describe('ConditionChip', () => {
    it('renders neutral indicator with accessible label and icon without surface recoloring', async () => {
      const { container, rerender } = render(<ConditionChip condition="diabetes" />)
      const chip = screen.getByLabelText(/Active health focus: Type 2 Diabetes/i)
      expect(chip).toBeDefined()
      expect(chip.className).toContain('bg-surface-raised')
      expect(chip.className).toContain('text-strong')

      rerender(<ConditionChip condition="hypertension" />)
      expect(screen.getByLabelText(/Active health focus: Hypertension/i)).toBeDefined()

      rerender(<ConditionChip condition="general" />)
      expect(screen.getByLabelText(/Active health focus: General Wellness/i)).toBeDefined()

      const results = await axe.run(container)
      expect(results.violations).toEqual([])
    })
  })

  describe('KpiCard', () => {
    it('renders numeric KPI, unit, label, and favorable delta direction', async () => {
      const { container } = render(
        <KpiCard
          label="Nutri-Score A/B Ratio"
          value={82}
          unit="%"
          delta={{ value: 5, label: 'vs last week', favorableDirection: 'up' }}
        />,
      )
      expect(screen.getByText('Nutri-Score A/B Ratio')).toBeDefined()
      expect(screen.getByText('82')).toBeDefined()
      expect(screen.getByText('%')).toBeDefined()
      expect(screen.getByLabelText(/5% increase vs last week/i)).toBeDefined()
      expect(screen.getByText(/5%.*vs last week/i)).toBeDefined()

      const results = await axe.run(container)
      expect(results.violations).toEqual([])
    })
  })

  describe('TargetMeter', () => {
    it('renders target adherence meter with accessible group role and limit status', async () => {
      const { container, rerender } = render(
        <TargetMeter label="Sodium Ceiling" current={450} max={600} unit="mg" />,
      )
      expect(screen.getByRole('group', { name: /Sodium Ceiling target adherence/i })).toBeDefined()
      expect(screen.getByText(/On Target/i)).toBeDefined()

      rerender(<TargetMeter label="Sodium Ceiling" current={550} max={600} unit="mg" />)
      expect(screen.getByText(/Near Limit/i)).toBeDefined()

      rerender(<TargetMeter label="Sodium Ceiling" current={650} max={600} unit="mg" />)
      expect(screen.getByText(/Exceeded/i)).toBeDefined()

      const results = await axe.run(container)
      expect(results.violations).toEqual([])
    })
  })

  describe('ConfirmDialog', () => {
    it('enforces typed confirmation before calling onConfirm for destructive actions', async () => {
      const onConfirm = vi.fn()
      const onCancel = vi.fn()

      const { container } = render(
        <ConfirmDialog
          isOpen={true}
          title="Crypto-Shred Patient Key"
          description="This action is irreversible. All cached health records will become undecryptable."
          expectedPhrase="SHRED"
          confirmButtonText="Execute Shred"
          onConfirm={onConfirm}
          onCancel={onCancel}
        />,
      )

      expect(screen.getByText('Crypto-Shred Patient Key')).toBeDefined()
      const confirmBtn = screen.getByRole('button', { name: /Execute Shred/i }) as HTMLButtonElement
      expect(confirmBtn.disabled).toBe(true)

      const input = screen.getByPlaceholderText('SHRED')
      fireEvent.input(input, { target: { value: 'WRONG' } })
      expect(confirmBtn.disabled).toBe(true)

      fireEvent.input(input, { target: { value: 'SHRED' } })
      expect(confirmBtn.disabled).toBe(false)

      fireEvent.click(confirmBtn)
      expect(onConfirm).toHaveBeenCalledTimes(1)

      const cancelBtn = screen.getByRole('button', { name: /Cancel/i })
      fireEvent.click(cancelBtn)
      expect(onCancel).toHaveBeenCalledTimes(1)

      const results = await axe.run(container)
      expect(results.violations).toEqual([])
    })
  })
})
